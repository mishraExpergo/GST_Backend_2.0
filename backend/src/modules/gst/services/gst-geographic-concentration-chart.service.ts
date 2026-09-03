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
import { Gstr2bComplianceRecord } from '../schemas/gst-gstr2b-compliance.schema';
import { Gstr3bComplianceRecord } from '../schemas/gst-gstr3b-compliance.schema';
import { Gstr1ReturnsComplianceRecord } from '../schemas/gst-gstr1-returns-compliance.schema';
import { GstNoticeRecord } from '../schemas/gst-notice.schema';
import { GstComplianceService } from './gst-compliance.service';
import { GstTaxpayerReturnsService } from './gst-taxpayer-returns.service';
import { computePrimaryGstr3bAggregationMetrics } from './gst-gstr3b-aggregation.util';
import { extractGstrTrackReturnPeriodRows } from './gst-gstr-track-aggregation.util';
import { extractSupplierPurchases } from './gst-supplier-concentration-chart.util';
import {
  complianceDocToRegistrationRecord,
} from './gst-registration-status-chart.util';
import {
  extractNoticeItems,
  flattenNoticeItem,
  toDdMmYyyy,
} from './gst-legal-risk-chart.util';
import {
  monthKey,
  type ChartEntityType,
} from './gst-tax-payment-chart.util';
import {
  buildStateRows,
  extractOutwardTaxLiability,
  isClosedNoticeStatus,
  normalizeStateQuery,
  normalizeTrackFinancialYear,
  outstandingTax,
  parseRangeKey,
  resolveMapFinancialYear,
  returnPeriodInMonths,
  stateCodeFromGstin,
  type GeographicConcentrationChartResponse,
  type GeographicGstinFacts,
} from './gst-geographic-concentration-chart.util';

const DEFAULT_SOURCE_TABLE = 'gst_uploaded_file_data';

export interface ChartEntityUnit {
  gstin: string;
  loanId: string;
  customerId: string;
  pan: string | null;
  entityType: 'PRIMARY' | 'CONSIDERED_ENTITY';
}

@Injectable()
export class GstGeographicConcentrationChartService {
  private readonly logger = new Logger(
    GstGeographicConcentrationChartService.name,
  );

  constructor(
    private readonly config: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly gstComplianceService: GstComplianceService,
    private readonly gstTaxpayerReturnsService: GstTaxpayerReturnsService,
    @Optional()
    @InjectModel(GstComplianceRecord.name)
    private readonly complianceModel?: Model<GstComplianceRecord>,
    @Optional()
    @InjectModel(Gstr2bComplianceRecord.name)
    private readonly gstr2bModel?: Model<Gstr2bComplianceRecord>,
    @Optional()
    @InjectModel(Gstr3bComplianceRecord.name)
    private readonly gstr3bModel?: Model<Gstr3bComplianceRecord>,
    @Optional()
    @InjectModel(Gstr1ReturnsComplianceRecord.name)
    private readonly gstr1Model?: Model<Gstr1ReturnsComplianceRecord>,
    @Optional()
    @InjectModel(GstNoticeRecord.name)
    private readonly noticeModel?: Model<GstNoticeRecord>,
  ) {}

  async getChart(params: {
    entityType: string;
    entityId: string;
    range: string;
    tableName?: string;
    state?: string;
    fetchMissing?: boolean | string;
    username?: string;
  }): Promise<GeographicConcentrationChartResponse> {
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
    const units = await this.resolveEntityUnits(
      entityType,
      entityId,
      sourceTable,
    );
    const mapFy = resolveMapFinancialYear(range);
    const loaded = await this.loadGstinFacts(units, mapFy);
    const series = buildStateRows(
      loaded.facts,
      loaded.hasPurchaseData,
      loaded.hasRevenueData,
      loaded.hasDelayedData,
      loaded.hasNoticeData,
    );
    const response: GeographicConcentrationChartResponse = {
      range,
      financialYear: mapFy.financialYear,
      series,
      incomplete: loaded.missing.length > 0,
      missing: loaded.missing,
    };

    if (params.state) {
      const stateCode = normalizeStateQuery(params.state);
      if (!stateCode) {
        throw new BadRequestException(
          `Unknown state "${params.state}". Use a GST state code (e.g. 27) or name.`,
        );
      }
      const row = series.find((item) => item.stateCode === stateCode);
      response.drilldown = {
        stateCode,
        stateName: row?.stateName ?? stateCode,
        compositeScore: row?.compositeScore ?? null,
        riskLevel: row?.riskLevel ?? null,
        factors: row?.factors ?? {
          taxStress: emptyCell(0.3),
          revenue: emptyCell(0.3),
          delayedFiling: emptyCell(0.15),
          legalNotices: emptyCell(0.15),
          purchase: emptyCell(0.05),
          gstinCancelled: emptyCell(0.05),
          gstinSuspended: emptyCell(0.05),
        },
        gstins: loaded.facts.filter((fact) => fact.stateCode === stateCode),
      };
    }

    if (shouldFetch) {
      response.fetch = await this.enqueueMissingFetches(
        units,
        mapFy,
        loaded,
        sourceTable,
        params.username,
      );
    }
    return response;
  }

  private async loadGstinFacts(
    units: ChartEntityUnit[],
    mapFy: ReturnType<typeof resolveMapFinancialYear>,
  ) {
    const registrations = await this.loadRegistrations(units);
    const purchaseByGstin = new Map<string, number>();
    const present2b = new Set<string>();
    const revenueByGstin = new Map<
      string,
      { revenue: number; outstanding: number }
    >();
    const present3b = new Set<string>();
    const delayedByGstin = new Map<string, number>();
    const presentTrack = new Set<string>();
    const noticesByGstin = new Map<string, number>();
    const presentNotices = new Set<string>();

    await this.loadPurchases(units, mapFy, purchaseByGstin, present2b);
    await this.loadRevenue(units, mapFy, revenueByGstin, present3b);
    await this.loadDelayed(units, mapFy, delayedByGstin, presentTrack);
    await this.loadNotices(
      units,
      mapFy.financialYear,
      noticesByGstin,
      presentNotices,
    );

    const missing: GeographicConcentrationChartResponse['missing'] = [];
    const missing2bMonthSet = new Set<string>();
    const missing3bMonthSet = new Set<string>();
    const missingNoticeGstins: string[] = [];
    let missingReg1 = false;
    let missingTrack = false;
    const facts: GeographicGstinFacts[] = [];

    for (const unit of units) {
      const gstin = unit.gstin;
      const registration = registrations.get(gstin);
      const fromReg = String(registration?.state ?? '');
      const stateCode =
        stateCodeFromGstin(gstin) ??
        (/^\d{2}/.test(fromReg) ? fromReg.slice(0, 2) : null) ??
        '00';

      if (!registration) {
        missingReg1 = true;
        missing.push({
          gstin,
          source: 'GSTREG1',
          financialYear: mapFy.financialYear,
        });
      }

      let purchaseComplete = true;
      let revenueComplete = true;
      for (const slot of mapFy.months) {
        const key = `${gstin}|${monthKey(slot.year, slot.month)}`;
        if (!present2b.has(key)) {
          purchaseComplete = false;
          missing2bMonthSet.add(monthKey(slot.year, slot.month));
        }
        if (!present3b.has(key)) {
          revenueComplete = false;
          missing3bMonthSet.add(monthKey(slot.year, slot.month));
        }
      }
      if (!purchaseComplete) {
        missing.push({
          gstin,
          source: 'GSTR-2B',
          financialYear: mapFy.financialYear,
        });
      }
      if (!revenueComplete) {
        missing.push({
          gstin,
          source: 'GSTR-3B',
          financialYear: mapFy.financialYear,
        });
      }
      if (!presentTrack.has(gstin)) {
        missingTrack = true;
        missing.push({
          gstin,
          source: 'GSTR-1',
          financialYear: mapFy.financialYear,
        });
      }
      if (!presentNotices.has(gstin)) {
        missingNoticeGstins.push(gstin);
        missing.push({
          gstin,
          source: 'NOTICES',
          financialYear: mapFy.financialYear,
        });
      }

      const revenue = revenueByGstin.get(gstin);
      facts.push({
        gstin,
        stateCode,
        status: registration?.currentStatus ?? null,
        purchaseValue: purchaseByGstin.has(gstin)
          ? purchaseByGstin.get(gstin)!
          : null,
        revenue: revenue ? revenue.revenue : null,
        outstandingTax: revenue ? revenue.outstanding : null,
        delayedReturnCount: delayedByGstin.has(gstin)
          ? delayedByGstin.get(gstin)!
          : null,
        activeNoticeCount: presentNotices.has(gstin)
          ? noticesByGstin.get(gstin) ?? 0
          : null,
      });
    }

    return {
      facts,
      missing,
      hasPurchaseData: purchaseByGstin.size > 0,
      hasRevenueData: revenueByGstin.size > 0,
      hasDelayedData: presentTrack.size > 0,
      hasNoticeData: presentNotices.size > 0,
      missing2bMonths: [...missing2bMonthSet].map((key) => {
        const [year, month] = key.split('-').map(Number);
        return { year, month };
      }),
      missing3bMonths: [...missing3bMonthSet].map((key) => {
        const [year, month] = key.split('-').map(Number);
        return { year, month };
      }),
      missingReg1,
      missingTrack,
      missingNoticeGstins,
    };
  }

  private async loadRegistrations(units: ChartEntityUnit[]) {
    const byGstin = new Map<
      string,
      NonNullable<ReturnType<typeof complianceDocToRegistrationRecord>>
    >();
    if (!this.complianceModel || units.length === 0) {
      return byGstin;
    }
    const loanIds = [...new Set(units.map((u) => u.loanId))];
    const gstins = [...new Set(units.map((u) => u.gstin))];
    const unitKey = new Set(units.map((u) => `${u.loanId}|${u.gstin}`));
    const docs = await this.complianceModel
      .find({ loanId: { $in: loanIds }, gstin: { $in: gstins } })
      .lean()
      .exec();
    for (const doc of docs) {
      const gstin = String(doc.gstin ?? '')
        .trim()
        .toUpperCase();
      const loanId = String(doc.loanId ?? '').trim();
      if (!unitKey.has(`${loanId}|${gstin}`)) {
        continue;
      }
      const record = complianceDocToRegistrationRecord(doc);
      if (record && !byGstin.has(gstin)) {
        byGstin.set(gstin, record);
      }
    }
    return byGstin;
  }

  private async loadPurchases(
    units: ChartEntityUnit[],
    mapFy: ReturnType<typeof resolveMapFinancialYear>,
    purchaseByGstin: Map<string, number>,
    present2b: Set<string>,
  ): Promise<void> {
    if (!this.gstr2bModel || units.length === 0) {
      return;
    }
    const docs = await this.findMonthlyDocs(this.gstr2bModel, units, mapFy);
    const unitKey = new Set(units.map((u) => `${u.loanId}|${u.gstin}`));
    for (const doc of docs) {
      const gstin = String(doc.gstin ?? doc.gstNo ?? '')
        .trim()
        .toUpperCase();
      const loanId = String(doc.loanId ?? '').trim();
      if (!unitKey.has(`${loanId}|${gstin}`)) {
        continue;
      }
      present2b.add(`${gstin}|${monthKey(Number(doc.year), Number(doc.month))}`);
      const value = extractSupplierPurchases(doc.gstr2bResponse ?? doc).reduce(
        (sum, line) => sum + line.taxableValue,
        0,
      );
      purchaseByGstin.set(
        gstin,
        Math.round(((purchaseByGstin.get(gstin) ?? 0) + value) * 100) / 100,
      );
    }
  }

  private async loadRevenue(
    units: ChartEntityUnit[],
    mapFy: ReturnType<typeof resolveMapFinancialYear>,
    revenueByGstin: Map<string, { revenue: number; outstanding: number }>,
    present3b: Set<string>,
  ): Promise<void> {
    if (!this.gstr3bModel || units.length === 0) {
      return;
    }
    const docs = await this.findMonthlyDocs(this.gstr3bModel, units, mapFy);
    const unitKey = new Set(units.map((u) => `${u.loanId}|${u.gstin}`));
    for (const doc of docs) {
      const gstin = String(doc.gstin ?? doc.gstNo ?? '')
        .trim()
        .toUpperCase();
      const loanId = String(doc.loanId ?? '').trim();
      if (!unitKey.has(`${loanId}|${gstin}`)) {
        continue;
      }
      present3b.add(`${gstin}|${monthKey(Number(doc.year), Number(doc.month))}`);
      const metrics = computePrimaryGstr3bAggregationMetrics([doc]);
      const liability = extractOutwardTaxLiability(doc.gstr3bResponse ?? doc);
      const outstanding = outstandingTax(
        liability,
        metrics.PRIMARY_TOTAL_ITC_UTILISED,
        metrics.PRIMARY_TOTAL_CASH_TAX_PAID,
      );
      const current = revenueByGstin.get(gstin) ?? {
        revenue: 0,
        outstanding: 0,
      };
      current.revenue =
        Math.round(
          (current.revenue + metrics.PRIMARY_TOTAL_TAXABLE_TURNOVER) * 100,
        ) / 100;
      current.outstanding =
        Math.round((current.outstanding + outstanding) * 100) / 100;
      revenueByGstin.set(gstin, current);
    }
  }

  private async loadDelayed(
    units: ChartEntityUnit[],
    mapFy: ReturnType<typeof resolveMapFinancialYear>,
    delayedByGstin: Map<string, number>,
    presentTrack: Set<string>,
  ): Promise<void> {
    if (!this.gstr1Model || units.length === 0) {
      return;
    }
    const loanIds = [...new Set(units.map((u) => u.loanId))];
    const gstins = [...new Set(units.map((u) => u.gstin))];
    const unitKey = new Set(units.map((u) => `${u.loanId}|${u.gstin}`));
    const docs = await this.gstr1Model
      .find({ loanId: { $in: loanIds }, gstin: { $in: gstins } })
      .lean()
      .exec();
    for (const doc of docs) {
      const gstin = String(doc.gstin ?? doc.gstNo ?? '')
        .trim()
        .toUpperCase();
      const loanId = String(doc.loanId ?? '').trim();
      if (!unitKey.has(`${loanId}|${gstin}`)) {
        continue;
      }
      const rows = extractGstrTrackReturnPeriodRows(doc).filter((row) =>
        returnPeriodInMonths(row.returnPeriod, mapFy.months),
      );
      const docFy = normalizeTrackFinancialYear(String(doc.financialYear ?? ''));
      if (rows.length === 0 && docFy !== mapFy.financialYear) {
        continue;
      }
      presentTrack.add(gstin);
      const delayed = new Set(
        rows
          .filter(
            (row) => row.filingDelayDays !== null && row.filingDelayDays > 0,
          )
          .map((row) => row.returnPeriod),
      );
      delayedByGstin.set(gstin, (delayedByGstin.get(gstin) ?? 0) + delayed.size);
    }
  }

  private async loadNotices(
    units: ChartEntityUnit[],
    financialYear: string,
    noticesByGstin: Map<string, number>,
    presentNotices: Set<string>,
  ): Promise<void> {
    if (!this.noticeModel || units.length === 0) {
      return;
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
    for (const doc of docs) {
      const gstin = String(doc.gstin ?? '')
        .trim()
        .toUpperCase();
      const loanId = String(doc.associatedLoanId ?? '').trim();
      if (!unitKey.has(`${loanId}|${gstin}`)) {
        continue;
      }
      presentNotices.add(gstin);
      const customerId = String(doc.customerId ?? '').trim();
      let active = 0;
      for (const item of extractNoticeItems(doc.response)) {
        const notice = flattenNoticeItem(gstin, loanId, customerId, item);
        if (notice.financialYear !== financialYear) {
          continue;
        }
        if (
          isClosedNoticeStatus(notice.currentStatus) ||
          isClosedNoticeStatus(notice.status)
        ) {
          continue;
        }
        active += 1;
      }
      noticesByGstin.set(gstin, (noticesByGstin.get(gstin) ?? 0) + active);
    }
  }

  private async findMonthlyDocs(
    model: Model<any>,
    units: ChartEntityUnit[],
    mapFy: ReturnType<typeof resolveMapFinancialYear>,
  ): Promise<any[]> {
    const loanIds = [...new Set(units.map((u) => u.loanId))];
    const gstins = [...new Set(units.map((u) => u.gstin))];
    const years = [...new Set(mapFy.months.map((m) => m.year))];
    const monthNums = [...new Set(mapFy.months.map((m) => m.month))];
    const allowed = new Set(mapFy.months.map((m) => monthKey(m.year, m.month)));
    const docs = await model
      .find({
        loanId: { $in: loanIds },
        gstin: { $in: gstins },
        year: { $in: years },
        month: { $in: monthNums },
      })
      .lean()
      .exec();
    return docs.filter((doc) =>
      allowed.has(monthKey(Number(doc.year), Number(doc.month))),
    );
  }

  private async enqueueMissingFetches(
    units: ChartEntityUnit[],
    mapFy: ReturnType<typeof resolveMapFinancialYear>,
    loaded: Awaited<
      ReturnType<GstGeographicConcentrationChartService['loadGstinFacts']>
    >,
    sourceTable: string,
    username?: string,
  ): Promise<NonNullable<GeographicConcentrationChartResponse['fetch']>> {
    const jobs: Array<{
      jobId: string;
      status: string;
      checkStatusUrl: string;
    }> = [];

    if (loaded.missingReg1) {
      const job =
        await this.gstComplianceService.startVerifyAndFetch(sourceTable);
      jobs.push({
        jobId: job.id,
        status: job.status,
        checkStatusUrl: `/gst/status/${job.id}`,
      });
    }
    for (const slot of loaded.missing2bMonths) {
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
    for (const slot of loaded.missing3bMonths) {
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
    if (loaded.missingTrack) {
      const job = await this.gstComplianceService.startGstrTrackVerifyAndFetch(
        mapFy.financialYear,
        sourceTable,
      );
      jobs.push({
        jobId: job.id,
        status: job.status,
        checkStatusUrl: `/gst/status/${job.id}`,
      });
    }
    if (loaded.missingNoticeGstins.length > 0) {
      const user = String(username ?? '').trim();
      if (!user) {
        throw new BadRequestException(
          'Query parameter "username" is required when fetchMissing=true and notice lists are missing.',
        );
      }
      const date = toDdMmYyyy();
      const unitByGstin = new Map(units.map((u) => [u.gstin, u]));
      for (const gstin of loaded.missingNoticeGstins) {
        const unit = unitByGstin.get(gstin);
        if (!unit) {
          continue;
        }
        try {
          await this.gstTaxpayerReturnsService.fetchNotices(
            { username: user, gstin },
            date,
            {
              associatedLoanId: unit.loanId,
              customerId: unit.customerId,
              requireTracking: true,
            },
          );
          jobs.push({
            jobId: `notice-list-${gstin}-${date}`,
            status: 'COMPLETED',
            checkStatusUrl: `/gst/taxpayer/notices/stored?associatedLoanId=${encodeURIComponent(unit.loanId)}&gstin=${encodeURIComponent(gstin)}`,
          });
        } catch (err) {
          this.logger.warn(
            `Geographic notice fetch failed for gstin=${gstin}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          jobs.push({
            jobId: `notice-list-${gstin}-${date}`,
            status: 'FAILED',
            checkStatusUrl: `/gst/taxpayer/notices/stored?associatedLoanId=${encodeURIComponent(unit.loanId)}&gstin=${encodeURIComponent(gstin)}`,
          });
        }
      }
    }
    this.logger.log(
      `Geographic-concentration fetch queued ${jobs.length} job(s).`,
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

  private async resolveLoanUnits(loanId: string, sourceTable: string) {
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

  private async resolvePanUnits(pan: string, sourceTable: string) {
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
  ) {
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
      throw new BadRequestException('Query parameter "entityId" is required.');
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
    if (!this.complianceModel || !this.gstr2bModel || !this.gstr3bModel) {
      throw new ServiceUnavailableException(
        'MongoDB is not enabled. Set ENABLE_MONGO=true to serve geographic concentration charts.',
      );
    }
  }
}

function emptyCell(weight: number) {
  return {
    rawPct: null,
    riskScore: null,
    riskLabel: null,
    weight,
    contribution: null,
  };
}
