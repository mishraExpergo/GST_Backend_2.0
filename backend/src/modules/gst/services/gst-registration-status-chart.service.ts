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
import { GstComplianceRecord } from '../schemas/gst-compliance.schema';
import { GstComplianceService } from './gst-compliance.service';
import {
  buildDrilldownRows,
  buildFyPeriodSpecs,
  buildNetChange,
  buildSankeyFlows,
  buildStatusMatrix,
  buildYearlySeries,
  complianceDocToRegistrationRecord,
  findMissingRegistrationSlots,
  parseFinancialYearFilter,
  parseRegistrationStatusFilter,
  type ChartEntityType,
  type ChartRangeKey,
  type GstRegistrationRecord,
  type RegistrationStatusChartResponse,
} from './gst-registration-status-chart.util';
import { formatFinancialYear, formatPeriodLabel } from './gst-tax-payment-chart.util';

const DEFAULT_SOURCE_TABLE = 'gst_uploaded_file_data';

export interface ChartEntityUnit {
  gstin: string;
  loanId: string;
  customerId: string;
  pan: string | null;
  entityType: 'PRIMARY' | 'CONSIDERED_ENTITY';
}

@Injectable()
export class GstRegistrationStatusChartService {
  private readonly logger = new Logger(GstRegistrationStatusChartService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly gstComplianceService: GstComplianceService,
    @Optional()
    @InjectModel(GstComplianceRecord.name)
    private readonly complianceModel?: Model<GstComplianceRecord>,
  ) {}

  async getChart(params: {
    entityType: string;
    entityId: string;
    range: string;
    tableName?: string;
    financialYear?: string;
    status?: string;
    fetchMissing?: boolean | string;
  }): Promise<RegistrationStatusChartResponse> {
    this.assertMongoEnabled();
    const entityType = this.parseEntityType(params.entityType);
    const entityId = this.requireEntityId(params.entityId);
    const range = this.parseRange(params.range);
    const sourceTable = this.resolveSourceTable(params.tableName);
    const shouldFetch = this.parseBooleanFlag(params.fetchMissing);

    const units = await this.resolveEntityUnits(
      entityType,
      entityId,
      sourceTable,
    );
    const gstins = [...new Set(units.map((u) => u.gstin))];
    const specs = buildFyPeriodSpecs(range);
    const recordsByGstin = await this.loadRegistrationRecords(units);
    const statusMatrix = buildStatusMatrix(gstins, specs, recordsByGstin);
    const series = buildYearlySeries(gstins, specs, statusMatrix);
    const flows = buildSankeyFlows(gstins, specs, statusMatrix);
    const missing = findMissingRegistrationSlots(
      gstins,
      specs,
      recordsByGstin,
    );

    const response: RegistrationStatusChartResponse = {
      series,
      flows,
      netChange: buildNetChange(series),
      incomplete: missing.length > 0,
      missing,
    };

    const fyRaw = String(params.financialYear ?? '').trim();
    const statusFilter = parseRegistrationStatusFilter(params.status);
    if (fyRaw && statusFilter) {
      try {
        const fyStartYear = parseFinancialYearFilter(fyRaw);
        const spec =
          specs.find((s) => s.fyStartYear === fyStartYear) ?? {
            financialYear: formatFinancialYear(fyStartYear),
            fyStartYear,
            period: formatPeriodLabel(fyStartYear, null),
          };
        response.drilldown = {
          period: spec.period,
          financialYear: spec.financialYear,
          status: statusFilter,
          rows: buildDrilldownRows(
            spec,
            gstins,
            recordsByGstin,
            statusMatrix,
            statusFilter,
          ),
        };
      } catch (err) {
        throw new BadRequestException(
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    if (shouldFetch && missing.length > 0) {
      response.fetch = await this.enqueueMissingFetches(sourceTable);
    }

    return response;
  }

  private async enqueueMissingFetches(
    sourceTable: string,
  ): Promise<NonNullable<RegistrationStatusChartResponse['fetch']>> {
    const job = await this.gstComplianceService.startVerifyAndFetch(sourceTable);
    this.logger.log(
      `Registration-status fetch queued GSTREG1 verify job ${job.id} for table ${sourceTable}.`,
    );
    return {
      jobs: [
        {
          jobId: job.id,
          status: job.status,
          checkStatusUrl: `/gst/status/${job.id}`,
        },
      ],
    };
  }

  private async loadRegistrationRecords(
    units: ChartEntityUnit[],
  ): Promise<Map<string, GstRegistrationRecord>> {
    if (units.length === 0 || !this.complianceModel) {
      return new Map();
    }

    const loanIds = [...new Set(units.map((u) => u.loanId))];
    const gstins = [...new Set(units.map((u) => u.gstin))];
    const unitKey = new Set(units.map((u) => `${u.loanId}|${u.gstin}`));

    const docs = await this.complianceModel
      .find({ loanId: { $in: loanIds }, gstin: { $in: gstins } })
      .lean()
      .exec();

    const byGstin = new Map<string, GstRegistrationRecord>();
    for (const doc of docs) {
      const gstin = String(doc.gstin ?? '')
        .trim()
        .toUpperCase();
      const loanId = String(doc.loanId ?? '').trim();
      if (!unitKey.has(`${loanId}|${gstin}`)) {
        continue;
      }
      const record = complianceDocToRegistrationRecord(doc);
      if (!record) {
        continue;
      }
      if (!byGstin.has(gstin)) {
        byGstin.set(gstin, record);
      }
    }
    return byGstin;
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
    if (!this.complianceModel) {
      throw new ServiceUnavailableException(
        'MongoDB is not enabled. Set ENABLE_MONGO=true to serve registration status charts.',
      );
    }
  }
}
