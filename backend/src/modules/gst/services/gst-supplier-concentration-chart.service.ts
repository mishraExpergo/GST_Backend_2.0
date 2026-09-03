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
import { Gstr2bComplianceRecord } from '../schemas/gst-gstr2b-compliance.schema';
import { GstComplianceService } from './gst-compliance.service';
import { monthKey, type ChartEntityType } from './gst-tax-payment-chart.util';
import {
  allWindowMonths,
  buildChurnMetrics,
  buildComparisonRows,
  buildComparisonWindows,
  buildInterpretation,
  extractSupplierPurchases,
  findMissing2bMonths,
  identifiedSupplierTotal,
  monthPresenceKey,
  parseRangeKey,
  rollUpBySupplier,
  top5ConcentrationPct,
  top5Series,
  type SupplierConcentrationChartResponse,
  type SupplierPeriodTotals,
  type SupplierPurchaseLine,
} from './gst-supplier-concentration-chart.util';

const DEFAULT_SOURCE_TABLE = 'gst_uploaded_file_data';

export interface ChartEntityUnit {
  gstin: string;
  loanId: string;
  customerId: string;
  pan: string | null;
  entityType: 'PRIMARY' | 'CONSIDERED_ENTITY';
}

@Injectable()
export class GstSupplierConcentrationChartService {
  private readonly logger = new Logger(
    GstSupplierConcentrationChartService.name,
  );

  constructor(
    private readonly config: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly gstComplianceService: GstComplianceService,
    @Optional()
    @InjectModel(Gstr2bComplianceRecord.name)
    private readonly gstr2bModel?: Model<Gstr2bComplianceRecord>,
  ) {}

  async getChart(params: {
    entityType: string;
    entityId: string;
    range: string;
    tableName?: string;
    view?: string;
    fetchMissing?: boolean | string;
    username?: string;
  }): Promise<SupplierConcentrationChartResponse> {
    this.assertMongoEnabled();
    const entityType = this.parseEntityType(params.entityType);
    const entityId = this.requireEntityId(params.entityId);
    let range;
    try {
      range = parseRangeKey(params.range);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : String(err),
      );
    }
    const sourceTable = this.resolveSourceTable(params.tableName);
    const shouldFetch = this.parseBooleanFlag(params.fetchMissing);
    const includeTable = this.parseViewFlag(params.view);

    const units = await this.resolveEntityUnits(
      entityType,
      entityId,
      sourceTable,
    );
    const windows = buildComparisonWindows(range);
    const gstins = [...new Set(units.map((u) => u.gstin))];
    const { previousMap, currentMap, presentKeys } = await this.loadPurchases(
      units,
      windows,
    );

    const missing = findMissing2bMonths(gstins, windows, presentKeys);
    const rows = buildComparisonRows(previousMap, currentMap);
    const series = top5Series(rows);
    const previousTotal = identifiedSupplierTotal(previousMap);
    const currentTotal = identifiedSupplierTotal(currentMap);
    const previousActiveCount = rows.filter(
      (row) => row.status === 'EXISTING' || row.status === 'LEFT',
    ).length;
    const currentActiveCount = rows.filter(
      (row) => row.status === 'EXISTING' || row.status === 'NEW',
    ).length;
    const previousTop5Pct = top5ConcentrationPct(previousMap);
    const currentTop5Pct = top5ConcentrationPct(currentMap);

    const hasPreviousData = [...presentKeys].some((key) =>
      windows.previous.months.some(
        (m) => key.endsWith(`|${monthKey(m.year, m.month)}`),
      ),
    );
    const hasCurrentData = [...presentKeys].some((key) =>
      windows.current.months.some(
        (m) => key.endsWith(`|${monthKey(m.year, m.month)}`),
      ),
    );

    const response: SupplierConcentrationChartResponse = {
      range,
      comparison: {
        previous: {
          period: windows.previous.period,
          financialYear: windows.previous.financialYear,
          half: windows.previous.half,
        },
        current: {
          period: windows.current.period,
          financialYear: windows.current.financialYear,
          half: windows.current.half,
        },
      },
      totals: {
        previousPurchaseValue: hasPreviousData ? previousTotal : null,
        currentPurchaseValue: hasCurrentData ? currentTotal : null,
        previousActiveSupplierCount: hasPreviousData
          ? previousActiveCount
          : null,
        currentActiveSupplierCount: hasCurrentData ? currentActiveCount : null,
        supplierCountChange:
          hasPreviousData && hasCurrentData
            ? currentActiveCount - previousActiveCount
            : null,
      },
      concentration: {
        previousTop5Pct: hasPreviousData ? previousTop5Pct : null,
        currentTop5Pct: hasCurrentData ? currentTop5Pct : null,
        top5ChangePp:
          hasPreviousData &&
          hasCurrentData &&
          previousTop5Pct !== null &&
          currentTop5Pct !== null
            ? Math.round((currentTop5Pct - previousTop5Pct) * 100) / 100
            : null,
      },
      churn: buildChurnMetrics(
        rows,
        hasPreviousData ? previousTotal : 0,
        hasPreviousData ? previousActiveCount : 0,
      ),
      series,
      interpretation: buildInterpretation(
        series,
        rows,
        hasPreviousData ? previousTop5Pct : null,
        hasCurrentData ? currentTop5Pct : null,
      ),
      incomplete: missing.length > 0,
      missing,
    };

    if (includeTable) {
      response.drilldown = { rows };
    }

    if (shouldFetch) {
      response.fetch = await this.enqueueMissingFetches(
        missing,
        sourceTable,
        params.username,
      );
    }

    return response;
  }

  private async loadPurchases(
    units: ChartEntityUnit[],
    windows: ReturnType<typeof buildComparisonWindows>,
  ): Promise<{
    previousMap: Map<string, SupplierPeriodTotals>;
    currentMap: Map<string, SupplierPeriodTotals>;
    presentKeys: Set<string>;
  }> {
    const presentKeys = new Set<string>();
    const previousLines: SupplierPurchaseLine[] = [];
    const currentLines: SupplierPurchaseLine[] = [];

    if (units.length === 0 || !this.gstr2bModel) {
      return {
        previousMap: rollUpBySupplier(previousLines),
        currentMap: rollUpBySupplier(currentLines),
        presentKeys,
      };
    }

    const months = allWindowMonths(windows);
    const loanIds = [...new Set(units.map((u) => u.loanId))];
    const gstins = [...new Set(units.map((u) => u.gstin))];
    const years = [...new Set(months.map((m) => m.year))];
    const monthNums = [...new Set(months.map((m) => m.month))];
    const allowed = new Set(months.map((m) => monthKey(m.year, m.month)));
    const unitKey = new Set(units.map((u) => `${u.loanId}|${u.gstin}`));
    const previousMonthKeys = new Set(
      windows.previous.months.map((m) => monthKey(m.year, m.month)),
    );
    const currentMonthKeys = new Set(
      windows.current.months.map((m) => monthKey(m.year, m.month)),
    );

    const docs = await this.gstr2bModel
      .find({
        loanId: { $in: loanIds },
        gstin: { $in: gstins },
        year: { $in: years },
        month: { $in: monthNums },
      })
      .lean()
      .exec();

    for (const doc of docs) {
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
      const slot = monthKey(year, month);
      if (!allowed.has(slot)) {
        continue;
      }

      presentKeys.add(monthPresenceKey(gstin, year, month));
      const lines = extractSupplierPurchases(doc.gstr2bResponse ?? doc);
      if (previousMonthKeys.has(slot)) {
        previousLines.push(...lines);
      }
      if (currentMonthKeys.has(slot)) {
        currentLines.push(...lines);
      }
    }

    return {
      previousMap: rollUpBySupplier(previousLines),
      currentMap: rollUpBySupplier(currentLines),
      presentKeys,
    };
  }

  private async enqueueMissingFetches(
    missing: SupplierConcentrationChartResponse['missing'],
    sourceTable: string,
    username?: string,
  ): Promise<NonNullable<SupplierConcentrationChartResponse['fetch']>> {
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
      const job = await this.gstComplianceService.startGstr2bVerifyAndFetch(
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
      `Supplier-concentration fetch queued ${jobs.length} GSTR-2B job(s) (${missing.length} missing slots).`,
    );
    return { jobs };
  }

  private parseViewFlag(raw?: string): boolean {
    const value = String(raw ?? '')
      .trim()
      .toLowerCase();
    return value === 'table' || value === 'true' || value === '1';
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
    const rows = await this.queryUploadRows(
      sourceTable,
      'TRIM(associated_loan_id) = TRIM($1)',
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
    const rows = await this.queryUploadRows(
      sourceTable,
      'UPPER(TRIM(primary_pan)) = $1',
      [normalizedPan],
    );
    if (rows.length === 0) {
      throw new BadRequestException(
        `No upload rows found for primary_pan="${normalizedPan}".`,
      );
    }
    return this.rowsToUnits(rows);
  }

  private async queryUploadRows(
    sourceTable: string,
    whereSql: string,
    params: string[],
  ): Promise<
    Array<{
      customer_id: string | null;
      associated_loan_id: string | null;
      primary_pan: string | null;
      primary_gst_no: string | null;
      considered_entity_pan: string | null;
      considered_entity_gst_no: string | null;
    }>
  > {
    return this.dataSource.query(
      `SELECT customer_id, associated_loan_id, primary_pan, primary_gst_no,
              considered_entity_pan, considered_entity_gst_no
         FROM "${sourceTable}"
        WHERE ${whereSql}`,
      params,
    );
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
    if (!this.gstr2bModel) {
      throw new ServiceUnavailableException(
        'MongoDB is not enabled. Set ENABLE_MONGO=true to serve supplier concentration charts.',
      );
    }
  }
}
