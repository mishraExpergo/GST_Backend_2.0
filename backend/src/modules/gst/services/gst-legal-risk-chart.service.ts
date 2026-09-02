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
import { GstNoticeRecord } from '../schemas/gst-notice.schema';
import { GstTaxpayerReturnsService } from './gst-taxpayer-returns.service';
import {
  buildDonutCounts,
  buildDrilldownRows,
  buildInterpretation,
  extractNoticeItems,
  findMissingNoticeGstins,
  flattenNoticeItem,
  parseFinancialYearParam,
  parseLegalRiskFilter,
  uniqueNotices,
  toDdMmYyyy,
  type FlattenedLegalNotice,
  type LegalRiskChartResponse,
} from './gst-legal-risk-chart.util';

const DEFAULT_SOURCE_TABLE = 'gst_uploaded_file_data';

export interface ChartEntityUnit {
  gstin: string;
  loanId: string;
  customerId: string;
  pan: string | null;
  entityType: 'PRIMARY' | 'CONSIDERED_ENTITY';
}

@Injectable()
export class GstLegalRiskChartService {
  private readonly logger = new Logger(GstLegalRiskChartService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly gstTaxpayerReturnsService: GstTaxpayerReturnsService,
    @Optional()
    @InjectModel(GstNoticeRecord.name)
    private readonly noticeModel?: Model<GstNoticeRecord>,
  ) {}

  async getChart(params: {
    entityType: string;
    entityId: string;
    tableName?: string;
    financialYear?: string;
    risk?: string;
    fetchMissing?: boolean | string;
    username?: string;
  }): Promise<LegalRiskChartResponse> {
    this.assertMongoEnabled();
    const entityType = this.parseEntityType(params.entityType);
    const entityId = this.requireEntityId(params.entityId);
    const sourceTable = this.resolveSourceTable(params.tableName);
    const shouldFetch = this.parseBooleanFlag(params.fetchMissing);

    let financialYear: string;
    try {
      financialYear = parseFinancialYearParam(params.financialYear);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : String(err),
      );
    }

    const units = await this.resolveEntityUnits(
      entityType,
      entityId,
      sourceTable,
    );
    const gstins = [...new Set(units.map((u) => u.gstin))];
    const { notices, gstinsWithListRecord } = await this.loadNotices(units);

    const missing = findMissingNoticeGstins(
      gstins,
      gstinsWithListRecord,
      financialYear,
    );

    let fetch: LegalRiskChartResponse['fetch'];
    if (shouldFetch && missing.length > 0) {
      fetch = await this.enqueueMissingFetches(units, missing, params.username);
      const reloaded = await this.loadNotices(units);
      notices.splice(0, notices.length, ...reloaded.notices);
      gstinsWithListRecord.clear();
      for (const gstin of reloaded.gstinsWithListRecord) {
        gstinsWithListRecord.add(gstin);
      }
    }

    const refreshedMissing = findMissingNoticeGstins(
      gstins,
      gstinsWithListRecord,
      financialYear,
    );
    const counts = buildDonutCounts(notices, financialYear);
    const response: LegalRiskChartResponse = {
      financialYear,
      total: counts.total,
      high: counts.high,
      medium: counts.medium,
      low: counts.low,
      pctHigh: counts.pctHigh,
      pctMedium: counts.pctMedium,
      pctLow: counts.pctLow,
      previousYearTotal: counts.previousYearTotal,
      interpretation: buildInterpretation(
        notices,
        financialYear,
        counts.previousYearTotal,
      ),
      incomplete: refreshedMissing.length > 0,
      missing: refreshedMissing,
    };

    const riskFilter = parseLegalRiskFilter(params.risk);
    if (riskFilter) {
      response.drilldown = {
        financialYear,
        risk: riskFilter,
        rows: buildDrilldownRows(notices, financialYear, riskFilter),
      };
    }

    if (fetch) {
      response.fetch = fetch;
    }

    return response;
  }

  private async loadNotices(units: ChartEntityUnit[]): Promise<{
    notices: FlattenedLegalNotice[];
    gstinsWithListRecord: Set<string>;
  }> {
    const gstinsWithListRecord = new Set<string>();
    if (units.length === 0 || !this.noticeModel) {
      return { notices: [], gstinsWithListRecord };
    }

    const loanIds = [...new Set(units.map((u) => u.loanId))];
    const gstins = [...new Set(units.map((u) => u.gstin))];
    const unitKey = new Set(units.map((u) => `${u.loanId}|${u.gstin}`));

    const docs = await this.noticeModel
      .find({
        recordType: 'LIST',
        associatedLoanId: { $in: loanIds },
        gstin: { $in: gstins },
      })
      .lean()
      .exec();

    const flattened: FlattenedLegalNotice[] = [];
    for (const doc of docs) {
      const gstin = String(doc.gstin ?? '')
        .trim()
        .toUpperCase();
      const loanId = String(doc.associatedLoanId ?? '').trim();
      if (!unitKey.has(`${loanId}|${gstin}`)) {
        continue;
      }
      gstinsWithListRecord.add(gstin);
      const customerId = String(doc.customerId ?? '').trim();
      const items = extractNoticeItems(doc.response);
      for (const item of items) {
        flattened.push(flattenNoticeItem(gstin, loanId, customerId, item));
      }
    }

    return {
      notices: uniqueNotices(flattened),
      gstinsWithListRecord,
    };
  }

  private async enqueueMissingFetches(
    units: ChartEntityUnit[],
    missing: Array<{ gstin: string }>,
    username?: string,
  ): Promise<NonNullable<LegalRiskChartResponse['fetch']>> {
    const user = String(username ?? '').trim();
    if (!user) {
      throw new BadRequestException(
        'Query parameter "username" is required when fetchMissing=true.',
      );
    }

    const unitByGstin = new Map(units.map((u) => [u.gstin, u]));
    const date = toDdMmYyyy();
    const jobs: Array<{
      jobId: string;
      status: string;
      checkStatusUrl: string;
    }> = [];

    for (const row of missing) {
      const unit = unitByGstin.get(row.gstin);
      if (!unit) {
        continue;
      }
      try {
        await this.gstTaxpayerReturnsService.fetchNotices(
          { username: user, gstin: row.gstin },
          date,
          {
            associatedLoanId: unit.loanId,
            customerId: unit.customerId,
            requireTracking: true,
          },
        );
        jobs.push({
          jobId: `notice-list-${row.gstin}-${date}`,
          status: 'COMPLETED',
          checkStatusUrl: `/gst/taxpayer/notices/stored?associatedLoanId=${encodeURIComponent(unit.loanId)}&customerId=${encodeURIComponent(unit.customerId)}&gstin=${encodeURIComponent(row.gstin)}`,
        });
      } catch (err) {
        this.logger.warn(
          `Legal-risk notice fetch failed for gstin=${row.gstin}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        jobs.push({
          jobId: `notice-list-${row.gstin}-${date}`,
          status: 'FAILED',
          checkStatusUrl: `/gst/taxpayer/notices/stored?associatedLoanId=${encodeURIComponent(unit.loanId)}&customerId=${encodeURIComponent(unit.customerId)}&gstin=${encodeURIComponent(row.gstin)}`,
        });
      }
    }

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
    entityType: 'PAN' | 'LOAN',
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

  private parseEntityType(raw: string): 'PAN' | 'LOAN' {
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
    if (!this.noticeModel) {
      throw new ServiceUnavailableException(
        'MongoDB is not enabled. Set ENABLE_MONGO=true to serve legal risk charts.',
      );
    }
  }
}
