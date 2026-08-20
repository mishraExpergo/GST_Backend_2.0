import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Gstr3bComplianceRecord } from '../schemas/gst-gstr3b-compliance.schema';
import { computePrimaryGstr3bAggregationMetrics } from './gst-gstr3b-aggregation.util';
import { GstComplianceService } from './gst-compliance.service';
import {
  buildChartSeries,
  buildDrilldownRows,
  buildPeriodSpecs,
  defaultGranularityForRange,
  findMissingSlots,
  monthKey,
  resolvePeriodSpec,
  type ChartEntityType,
  type ChartGranularity,
  type ChartRangeKey,
  type MonthlyTaxPayment,
  type TaxPaymentChartResponse,
  type TaxPaymentMissingRow,
} from './gst-tax-payment-chart.util';

const DEFAULT_SOURCE_TABLE = 'gst_uploaded_file_data';

export interface ChartEntityUnit {
  gstin: string;
  loanId: string;
  customerId: string;
  pan: string | null;
  entityType: 'PRIMARY' | 'CONSIDERED_ENTITY';
}

@Injectable()
export class GstTaxPaymentChartService {
  private readonly logger = new Logger(GstTaxPaymentChartService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly gstComplianceService: GstComplianceService,
    @Optional()
    @InjectModel(Gstr3bComplianceRecord.name)
    private readonly gstr3bModel?: Model<Gstr3bComplianceRecord>,
  ) {}

  /**
   * Tax Payment chart API (GSTR-3B only).
   *
   * Graph: stacked bars ITC Utilised + Cash Tax Paid, dotted line = Total.
   * - range 1y|3y|5y
   * - granularity monthly|quarterly|half-yearly|annual
   *   (default: half-yearly for 1y/3y, annual for 5y)
   * - financialYear (+ half|quarter) or year+month → GSTIN drilldown
   * - fetchMissing=true → enqueue GSTR-3B jobs for missing months
   */
  async getChart(params: {
    entityType: string;
    entityId: string;
    range: string;
    granularity?: string;
    tableName?: string;
    financialYear?: string;
    half?: string;
    quarter?: string;
    year?: string;
    month?: string;
    fetchMissing?: boolean | string;
    username?: string;
  }): Promise<TaxPaymentChartResponse> {
    this.assertMongoEnabled();
    const entityType = this.parseEntityType(params.entityType);
    const entityId = this.requireEntityId(params.entityId);
    const range = this.parseRange(params.range);
    const granularity = this.parseGranularity(params.granularity, range);
    const sourceTable = this.resolveSourceTable(params.tableName);
    const shouldFetch = this.parseBooleanFlag(params.fetchMissing);

    const units = await this.resolveEntityUnits(
      entityType,
      entityId,
      sourceTable,
    );
    const specs = buildPeriodSpecs(range, { granularity });
    const payments = await this.loadMonthlyPayments(
      units,
      specs.flatMap((s) => s.months),
    );
    const gstins = [...new Set(units.map((u) => u.gstin))];
    const series = buildChartSeries(specs, gstins, payments);
    const missing = findMissingSlots(specs, units, payments);
    const incomplete = missing.length > 0;

    const response: TaxPaymentChartResponse = {
      series,
      incomplete,
      missing,
    };

    const fyRaw = String(params.financialYear ?? '').trim();
    const hasMonthDrilldown =
      String(params.year ?? '').trim() !== '' &&
      String(params.month ?? '').trim() !== '';
    if (fyRaw || hasMonthDrilldown) {
      try {
        const drillSpec = resolvePeriodSpec({
          financialYear: fyRaw || undefined,
          half: params.half,
          quarter: params.quarter,
          year: params.year,
          month: params.month,
        });
        response.drilldown = {
          period: drillSpec.period,
          financialYear: drillSpec.financialYear,
          half: drillSpec.half,
          rows: buildDrilldownRows(drillSpec, units, payments),
        };
      } catch (err) {
        throw new BadRequestException(
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    if (shouldFetch) {
      let fetchScope = specs;
      if (fyRaw || hasMonthDrilldown) {
        try {
          fetchScope = [
            resolvePeriodSpec({
              financialYear: fyRaw || undefined,
              half: params.half,
              quarter: params.quarter,
              year: params.year,
              month: params.month,
            }),
          ];
        } catch (err) {
          throw new BadRequestException(
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      const fetchMissingRows = findMissingSlots(fetchScope, units, payments);
      response.fetch = await this.enqueueMissingFetches(
        entityType,
        entityId,
        fetchMissingRows,
        sourceTable,
        params.username,
      );
    }

    return response;
  }

  private async enqueueMissingFetches(
    entityType: ChartEntityType,
    entityId: string,
    missing: TaxPaymentMissingRow[],
    sourceTable: string,
    username?: string,
  ): Promise<NonNullable<TaxPaymentChartResponse['fetch']>> {
    if (missing.length === 0) {
      return { jobs: [] };
    }

    const uniqueJobs = new Map<string, { year: number; month: number }>();
    for (const row of missing) {
      uniqueJobs.set(monthKey(row.year, row.month), {
        year: row.year,
        month: row.month,
      });
    }

    const jobs: Array<{
      jobId: string;
      status: string;
      checkStatusUrl: string;
    }> = [];

    for (const slot of uniqueJobs.values()) {
      const job = await this.gstComplianceService.startGstr3bVerifyAndFetch(
        slot.year,
        slot.month,
        sourceTable,
        username,
      );
      jobs.push({
        jobId: job.id,
        status: job.status,
        checkStatusUrl: `/gst/status/${job.id}`,
      });
    }

    this.logger.log(
      `Tax-payment fetch queued ${jobs.length} GSTR-3B job(s) for ${entityType}=${entityId} (${missing.length} missing slots).`,
    );

    return { jobs };
  }

  private parseBooleanFlag(raw?: boolean | string): boolean {
    if (typeof raw === 'boolean') {
      return raw;
    }
    const value = String(raw ?? '')
      .trim()
      .toLowerCase();
    return value === '1' || value === 'true' || value === 'yes';
  }

  private async resolveEntityUnits(
    entityType: ChartEntityType,
    entityId: string,
    sourceTable: string,
  ): Promise<ChartEntityUnit[]> {
    if (entityType === 'LOAN') {
      return this.resolveLoanUnits(entityId, sourceTable);
    }
    return this.resolvePanUnits(entityId, sourceTable);
  }

  private async resolveLoanUnits(
    loanId: string,
    sourceTable: string,
  ): Promise<ChartEntityUnit[]> {
    const rows: Array<{
      customer_id: string | null;
      associated_loan_id: string | null;
      primary_pan: string | null;
      primary_gst_no: string | null;
      considered_entity_pan: string | null;
      considered_entity_gst_no: string | null;
    }> = await this.dataSource.query(
      `SELECT customer_id, associated_loan_id, primary_pan, primary_gst_no,
              considered_entity_pan, considered_entity_gst_no
         FROM "${sourceTable}"
        WHERE TRIM(associated_loan_id) = TRIM($1)`,
      [loanId],
    );

    if (rows.length === 0) {
      throw new BadRequestException(
        `No upload rows found for associated_loan_id="${loanId}".`,
      );
    }

    return this.rowsToUnits(rows);
  }

  private async resolvePanUnits(
    pan: string,
    sourceTable: string,
  ): Promise<ChartEntityUnit[]> {
    const normalizedPan = pan.trim().toUpperCase();
    const rows: Array<{
      customer_id: string | null;
      associated_loan_id: string | null;
      primary_pan: string | null;
      primary_gst_no: string | null;
      considered_entity_pan: string | null;
      considered_entity_gst_no: string | null;
    }> = await this.dataSource.query(
      `SELECT customer_id, associated_loan_id, primary_pan, primary_gst_no,
              considered_entity_pan, considered_entity_gst_no
         FROM "${sourceTable}"
        WHERE UPPER(TRIM(primary_pan)) = $1`,
      [normalizedPan],
    );

    if (rows.length === 0) {
      throw new BadRequestException(
        `No upload rows found for primary_pan="${normalizedPan}".`,
      );
    }

    return this.rowsToUnits(rows);
  }

  private rowsToUnits(
    rows: Array<{
      customer_id: string | null;
      associated_loan_id: string | null;
      primary_pan: string | null;
      primary_gst_no: string | null;
      considered_entity_pan: string | null;
      considered_entity_gst_no: string | null;
    }>,
  ): ChartEntityUnit[] {
    const byGstin = new Map<string, ChartEntityUnit>();

    for (const row of rows) {
      const customerId = String(row.customer_id ?? '').trim();
      const loanId = String(row.associated_loan_id ?? '').trim();
      if (!customerId || !loanId) {
        continue;
      }

      const primaryGst = String(row.primary_gst_no ?? '')
        .trim()
        .toUpperCase();
      if (primaryGst && !byGstin.has(primaryGst)) {
        byGstin.set(primaryGst, {
          gstin: primaryGst,
          loanId,
          customerId,
          pan: row.primary_pan
            ? String(row.primary_pan).trim().toUpperCase()
            : null,
          entityType: 'PRIMARY',
        });
      }

      const consideredGst = String(row.considered_entity_gst_no ?? '')
        .trim()
        .toUpperCase();
      if (consideredGst && !byGstin.has(consideredGst)) {
        byGstin.set(consideredGst, {
          gstin: consideredGst,
          loanId,
          customerId,
          pan: row.considered_entity_pan
            ? String(row.considered_entity_pan).trim().toUpperCase()
            : null,
          entityType: 'CONSIDERED_ENTITY',
        });
      }
    }

    const units = [...byGstin.values()];
    if (units.length === 0) {
      throw new BadRequestException(
        'No GSTINs found for the requested entity in the upload table.',
      );
    }
    return units;
  }

  private async loadMonthlyPayments(
    units: ChartEntityUnit[],
    months: Array<{ year: number; month: number }>,
  ): Promise<MonthlyTaxPayment[]> {
    if (units.length === 0 || months.length === 0) {
      return [];
    }

    const loanIds = [...new Set(units.map((u) => u.loanId))];
    const gstins = [...new Set(units.map((u) => u.gstin))];
    const years = [...new Set(months.map((m) => m.year))];
    const monthNums = [...new Set(months.map((m) => m.month))];
    const allowedMonthKeys = new Set(
      months.map((m) => monthKey(m.year, m.month)),
    );
    const unitKey = new Set(units.map((u) => `${u.loanId}|${u.gstin}`));
    const unitByKey = new Map(
      units.map((u) => [`${u.loanId}|${u.gstin}`, u] as const),
    );

    const docs3b = await this.gstr3bModel!
      .find({
        loanId: { $in: loanIds },
        gstin: { $in: gstins },
        year: { $in: years },
        month: { $in: monthNums },
      })
      .lean()
      .exec();

    const merged = new Map<string, MonthlyTaxPayment>();

    for (const doc of docs3b) {
      const gstin = String(doc.gstin ?? doc.gstNo ?? '')
        .trim()
        .toUpperCase();
      const loanId = String(doc.loanId ?? '').trim();
      const year = Number(doc.year);
      const month = Number(doc.month);
      if (
        !gstin ||
        !loanId ||
        !Number.isInteger(year) ||
        !Number.isInteger(month)
      ) {
        continue;
      }
      if (!unitKey.has(`${loanId}|${gstin}`)) {
        continue;
      }
      if (!allowedMonthKeys.has(monthKey(year, month))) {
        continue;
      }

      const key = `${loanId}|${gstin}|${monthKey(year, month)}`;
      const unit = unitByKey.get(`${loanId}|${gstin}`);
      const metrics = computePrimaryGstr3bAggregationMetrics([doc]);
      merged.set(key, {
        gstin,
        loanId,
        customerId: String(doc.customerId ?? '').trim() || unit?.customerId || '',
        year,
        month,
        itcUtilised: metrics.PRIMARY_TOTAL_ITC_UTILISED,
        cashTaxPaid: metrics.PRIMARY_TOTAL_CASH_TAX_PAID,
      });
    }

    return [...merged.values()];
  }

  private parseEntityType(raw: string): ChartEntityType {
    const value = String(raw ?? '')
      .trim()
      .toUpperCase();
    if (value === 'PAN' || value === 'LOAN') {
      return value;
    }
    throw new BadRequestException(
      'Query parameter "entityType" must be PAN or LOAN.',
    );
  }

  private parseRange(raw: string): ChartRangeKey {
    const value = String(raw ?? '')
      .trim()
      .toLowerCase();
    if (value === '1y' || value === '3y' || value === '5y') {
      return value;
    }
    throw new BadRequestException(
      'Query parameter "range" must be one of: 1y, 3y, 5y.',
    );
  }

  private parseGranularity(
    raw: string | undefined,
    range: ChartRangeKey,
  ): ChartGranularity {
    const value = String(raw ?? '')
      .trim()
      .toLowerCase();
    if (!value) {
      return defaultGranularityForRange(range);
    }
    if (
      value === 'monthly' ||
      value === 'quarterly' ||
      value === 'half-yearly' ||
      value === 'halfyearly' ||
      value === 'half_yearly' ||
      value === 'annual' ||
      value === 'yearly'
    ) {
      if (value === 'halfyearly' || value === 'half_yearly') {
        return 'half-yearly';
      }
      if (value === 'yearly') {
        return 'annual';
      }
      return value as ChartGranularity;
    }
    throw new BadRequestException(
      'Query parameter "granularity" must be one of: monthly, quarterly, half-yearly, annual.',
    );
  }

  private requireEntityId(raw: string): string {
    const value = String(raw ?? '').trim();
    if (!value) {
      throw new BadRequestException(
        'Query parameter "entityId" is required.',
      );
    }
    return value;
  }

  private resolveSourceTable(raw?: string | null): string {
    const tableName =
      String(raw ?? '').trim() ||
      this.config.get<string>(
        'GST_AGGREGATION_SOURCE_TABLE',
        DEFAULT_SOURCE_TABLE,
      );
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
      throw new BadRequestException(`Invalid table name "${tableName}".`);
    }
    return tableName;
  }

  private assertMongoEnabled(): void {
    if (!this.gstr3bModel) {
      throw new ServiceUnavailableException(
        'MongoDB is not enabled. Set ENABLE_MONGO=true to serve tax payment charts.',
      );
    }
  }
}
