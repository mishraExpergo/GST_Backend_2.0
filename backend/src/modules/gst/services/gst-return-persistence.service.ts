import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Gstr2bComplianceRecord } from '../schemas/gst-gstr2b-compliance.schema';
import { Gstr3bComplianceRecord } from '../schemas/gst-gstr3b-compliance.schema';
import {
  extractCoveredMonthsFromGstr2b,
  extractCoveredMonthsFromGstr3b,
  getMissingMonths,
  getRequiredMonthsForYear,
} from './gst-return-month-coverage.util';

export type GstReturnType = 'GSTR-2B' | 'GSTR-3B';
export type GstEntityType = 'PRIMARY' | 'CONSIDERED_ENTITY';

export interface ReturnPersistenceContext {
  customerId: string;
  associatedLoanId: string;
  gstin: string;
  username: string;
  dataSource?: string | null;
  sourceTable?: string | null;
}

export interface ResolvedUploadUnit {
  customerId: string;
  loanId: string;
  gstin: string;
  pan: string | null;
  entityType: GstEntityType;
}

const DEFAULT_SOURCE_TABLE = 'gst_uploaded_file_data';

@Injectable()
export class GstReturnPersistenceService {
  constructor(
    private readonly config: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Optional()
    @InjectModel(Gstr2bComplianceRecord.name)
    private readonly gstr2bModel?: Model<Gstr2bComplianceRecord>,
    @Optional()
    @InjectModel(Gstr3bComplianceRecord.name)
    private readonly gstr3bModel?: Model<Gstr3bComplianceRecord>,
  ) {}

  assertMongoEnabled(): void {
    if (!this.gstr2bModel || !this.gstr3bModel) {
      throw new BadRequestException(
        'MongoDB is not enabled. Set ENABLE_MONGO=true to store GSTR-2B/3B return data.',
      );
    }
  }

  validatePersistenceContext(
    tracking: {
      customerId?: string | null;
      associatedLoanId?: string | null;
    },
  ): { customerId: string; associatedLoanId: string } {
    const customerId = String(tracking.customerId ?? '').trim();
    const associatedLoanId = String(tracking.associatedLoanId ?? '').trim();

    if (!customerId) {
      throw new BadRequestException(
        '"customerId" query parameter is required to store return data in MongoDB.',
      );
    }
    if (!associatedLoanId) {
      throw new BadRequestException(
        '"associatedLoanId" query parameter is required to store return data in MongoDB.',
      );
    }

    return { customerId, associatedLoanId };
  }

  resolveSourceTable(raw?: string | null): string {
    const tableName =
      String(raw ?? '').trim() ||
      this.config.get<string>('GST_AGGREGATION_SOURCE_TABLE', DEFAULT_SOURCE_TABLE);
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
      throw new BadRequestException(`Invalid table name "${tableName}".`);
    }
    return tableName;
  }

  async findExisting(
    returnType: GstReturnType,
    loanId: string,
    gstin: string,
    year: number,
    month: number,
  ): Promise<Record<string, any> | null> {
    this.assertMongoEnabled();
    const normalizedGstin = gstin.trim().toUpperCase();
    const doc = await this.findDocumentForMonth(
      returnType,
      loanId,
      normalizedGstin,
      year,
      month,
    );
    if (!doc) {
      return null;
    }

    const covered = this.extractCoveredMonthsFromDocument(returnType, doc, year);
    if (!covered.has(month)) {
      return null;
    }

    return this.toCachedPayload(returnType, doc);
  }

  async getCoveredMonthsForYear(
    returnType: GstReturnType,
    loanId: string,
    gstin: string,
    year: number,
  ): Promise<Set<number>> {
    this.assertMongoEnabled();
    const normalizedGstin = gstin.trim().toUpperCase();
    const docs = await this.listDocumentsForYear(
      returnType,
      loanId,
      normalizedGstin,
      year,
    );

    const covered = new Set<number>();
    for (const doc of docs) {
      for (const month of this.extractCoveredMonthsFromDocument(returnType, doc, year)) {
        covered.add(month);
      }
    }
    return covered;
  }

  async getMissingMonthsForYear(
    returnType: GstReturnType,
    loanId: string,
    gstin: string,
    year: number,
  ): Promise<number[]> {
    const requiredMonths = getRequiredMonthsForYear(year);
    const coveredMonths = await this.getCoveredMonthsForYear(
      returnType,
      loanId,
      gstin,
      year,
    );
    return getMissingMonths(requiredMonths, coveredMonths);
  }

  async storeIfAbsent(
    returnType: GstReturnType,
    context: ReturnPersistenceContext,
    year: number,
    month: number,
    sandboxPayload: Record<string, any>,
  ): Promise<{ stored: boolean; reason: string }> {
    this.assertMongoEnabled();

    const loanId = context.associatedLoanId;
    const gstin = context.gstin.trim().toUpperCase();
    const sourceTable = this.resolveSourceTable(context.sourceTable);
    const unit = await this.resolveUnitFromUpload(
      context.customerId,
      loanId,
      gstin,
      sourceTable,
    );

    const existing = await this.findExisting(returnType, loanId, gstin, year, month);
    if (existing) {
      return { stored: false, reason: 'already_exists' };
    }

    const legalName = String(
      sandboxPayload?.data?.data?.lgnm ?? sandboxPayload?.data?.lgnm ?? '',
    );
    const status = String(
      sandboxPayload?.data?.data?.status ??
        sandboxPayload?.data?.data?.sts ??
        sandboxPayload?.data?.status ??
        'FETCHED',
    );
    const pan =
      (unit?.pan ?? '').trim().toUpperCase() ||
      (gstin.length >= 12 ? gstin.substring(2, 12) : '');
    const entityType = unit?.entityType ?? 'PRIMARY';
    const systemMetadata = {
      fetchedAt: new Date().toISOString(),
      month,
      username: context.username,
      dataSource: context.dataSource ?? 'sandbox',
      fetchMode: 'taxpayer-single-gst',
    };

    if (returnType === 'GSTR-2B') {
      const payload = {
        loanId,
        customerId: context.customerId,
        entityType,
        gstin,
        gstNo: gstin,
        pan,
        year,
        month,
        sourceTable,
        legalName,
        status,
        gstr2bResponse: sandboxPayload,
        systemMetadata,
      };
      const hadDoc = Boolean(
        await this.findDocumentForMonth(returnType, loanId, gstin, year, month),
      );
      await this.gstr2bModel!.updateOne(
        { loanId, gstin, year, month },
        { $set: payload },
        { upsert: true },
      );
      return { stored: true, reason: hadDoc ? 'updated' : 'inserted' };
    }

    const payload = {
      loanId,
      customerId: context.customerId,
      entityType,
      gstin,
      gstNo: gstin,
      pan,
      year,
      month,
      sourceTable,
      legalName,
      status,
      gstr3bResponse: sandboxPayload,
      systemMetadata,
    };
    const hadDoc = Boolean(
      await this.findDocumentForMonth(returnType, loanId, gstin, year, month),
    );
    await this.gstr3bModel!.updateOne(
      { loanId, gstin, year, month },
      { $set: payload },
      { upsert: true },
    );
    return { stored: true, reason: hadDoc ? 'updated' : 'inserted' };
  }

  async getExpectedUnitsForLoan(
    customerId: string,
    loanId: string,
    sourceTable: string,
  ): Promise<ResolvedUploadUnit[]> {
    const dbRows: Array<{
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
        WHERE customer_id = $1 AND associated_loan_id = $2`,
      [customerId, loanId],
    );

    const units: ResolvedUploadUnit[] = [];
    for (const row of dbRows) {
      const primaryGst = (row.primary_gst_no ?? '').trim().toUpperCase();
      if (primaryGst) {
        units.push({
          customerId,
          loanId,
          gstin: primaryGst,
          pan: row.primary_pan ?? null,
          entityType: 'PRIMARY',
        });
      }

      const secondaryGst = (row.considered_entity_gst_no ?? '').trim().toUpperCase();
      if (secondaryGst) {
        units.push({
          customerId,
          loanId,
          gstin: secondaryGst,
          pan: row.considered_entity_pan ?? null,
          entityType: 'CONSIDERED_ENTITY',
        });
      }
    }

    return units;
  }

  async listLoanPairs(sourceTable: string): Promise<Array<{ customerId: string; loanId: string }>> {
    const rows: Array<{
      customer_id: string | null;
      associated_loan_id: string | null;
    }> = await this.dataSource.query(
      `SELECT DISTINCT customer_id, associated_loan_id
         FROM "${sourceTable}"
        WHERE customer_id IS NOT NULL
          AND TRIM(customer_id) <> ''
          AND associated_loan_id IS NOT NULL
          AND TRIM(associated_loan_id) <> ''`,
    );

    return rows
      .map((row) => ({
        customerId: String(row.customer_id ?? '').trim(),
        loanId: String(row.associated_loan_id ?? '').trim(),
      }))
      .filter((row) => row.customerId && row.loanId);
  }

  async hasMonthStored(
    returnType: GstReturnType,
    loanId: string,
    gstin: string,
    year: number,
    month: number,
  ): Promise<boolean> {
    const existing = await this.findExisting(
      returnType,
      loanId,
      gstin,
      year,
      month,
    );
    return existing !== null;
  }

  /**
   * True if Mongo has at least one document for this loan + GSTIN
   * (any year/month). Used by the aggregation scheduler completeness check.
   */
  async hasAnyDataForGstin(
    returnType: GstReturnType,
    loanId: string,
    gstin: string,
  ): Promise<boolean> {
    this.assertMongoEnabled();
    const normalizedGstin = gstin.trim().toUpperCase();

    if (returnType === 'GSTR-2B') {
      const count = await this.gstr2bModel!
        .countDocuments({ loanId, gstin: normalizedGstin })
        .exec();
      return count > 0;
    }

    const count = await this.gstr3bModel!
      .countDocuments({ loanId, gstin: normalizedGstin })
      .exec();
    return count > 0;
  }

  async isGstinYearComplete(
    returnType: GstReturnType,
    loanId: string,
    gstin: string,
    year: number,
  ): Promise<boolean> {
    const missingMonths = await this.getMissingMonthsForYear(
      returnType,
      loanId,
      gstin,
      year,
    );
    return missingMonths.length === 0;
  }

  private async listDocumentsForYear(
    returnType: GstReturnType,
    loanId: string,
    gstin: string,
    year: number,
  ): Promise<Array<Record<string, any>>> {
    if (returnType === 'GSTR-2B') {
      return this.gstr2bModel!.find({ loanId, gstin, year }).lean().exec();
    }

    return this.gstr3bModel!.find({ loanId, gstin, year }).lean().exec();
  }

  private async findDocumentForMonth(
    returnType: GstReturnType,
    loanId: string,
    gstin: string,
    year: number,
    month: number,
  ): Promise<Record<string, any> | null> {
    if (returnType === 'GSTR-2B') {
      return this.gstr2bModel!
        .findOne({ loanId, gstin, year, month })
        .lean()
        .exec();
    }

    return this.gstr3bModel!
      .findOne({ loanId, gstin, year, month })
      .lean()
      .exec();
  }

  private extractCoveredMonthsFromDocument(
    returnType: GstReturnType,
    doc: Record<string, any>,
    year: number,
  ): Set<number> {
    if (returnType === 'GSTR-2B') {
      return extractCoveredMonthsFromGstr2b(doc, year);
    }
    return extractCoveredMonthsFromGstr3b(doc, year);
  }

  private async resolveUnitFromUpload(
    customerId: string,
    loanId: string,
    gstin: string,
    sourceTable: string,
  ): Promise<ResolvedUploadUnit | null> {
    const units = await this.getExpectedUnitsForLoan(customerId, loanId, sourceTable);
    return units.find((unit) => unit.gstin === gstin.trim().toUpperCase()) ?? null;
  }

  private toCachedPayload(
    returnType: GstReturnType,
    doc: Record<string, any>,
  ): Record<string, any> {
    if (returnType === 'GSTR-2B') {
      return doc.gstr2bResponse ?? doc;
    }
    return doc.gstr3bResponse ?? doc;
  }
}
