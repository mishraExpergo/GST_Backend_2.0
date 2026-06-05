import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DataSource } from 'typeorm';
import {
  GstComplianceRecord,
  GstComplianceRecordDocument,
} from '../../schemas/gst-compliance-record.schema';
import { GstComplianceClient } from './gst-compliance.client';

export interface LoanGstRecord {
  loanId: string;
  gstNo: string | null;
  panNo: string | null;
}

export interface LoanComplianceResult {
  loanId: string;
  gstNo: string | null;
  panNo: string | null;
  processed: boolean;
  skipped?: boolean;
  skipReason?: string;
  verificationStatus?: string;
  validGstin?: boolean;
  searchFetched?: boolean;
  mongoRecordId?: string;
  errorMessage?: string;
}

@Injectable()
export class GstComplianceService {
  private readonly logger = new Logger(GstComplianceService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly gstComplianceClient: GstComplianceClient,
    @Optional()
    @InjectModel(GstComplianceRecord.name)
    private readonly complianceModel?: Model<GstComplianceRecordDocument>,
  ) {}

  async processAllLoans(tableName?: string): Promise<{
    total: number;
    processed: number;
    skipped: number;
    failed: number;
    results: LoanComplianceResult[];
  }> {
    this.ensureMongoEnabled();

    const loans = await this.fetchLoanRecords(tableName);
    const results: LoanComplianceResult[] = [];
    let processed = 0;
    let skipped = 0;
    let failed = 0;

    for (const loan of loans) {
      try {
        const result = await this.processLoanRecord(loan);
        results.push(result);

        if (result.skipped) {
          skipped += 1;
        } else if (result.errorMessage) {
          failed += 1;
        } else {
          processed += 1;
        }
      } catch (error) {
        failed += 1;
        const message =
          error instanceof Error ? error.message : 'Unknown processing error';
        this.logger.error(`Loan ${loan.loanId} failed: ${message}`);

        const saved = await this.complianceModel!.create({
          loanId: loan.loanId,
          gstNo: loan.gstNo ?? undefined,
          panNo: loan.panNo ?? undefined,
          errorMessage: message,
        });

        results.push({
          loanId: loan.loanId,
          gstNo: loan.gstNo,
          panNo: loan.panNo,
          processed: false,
          errorMessage: message,
          mongoRecordId: String(saved._id),
        });
      }
    }

    return {
      total: loans.length,
      processed,
      skipped,
      failed,
      results,
    };
  }

  private async processLoanRecord(
    loan: LoanGstRecord,
  ): Promise<LoanComplianceResult> {
    const gstNo = loan.gstNo?.trim();

    if (!gstNo) {
      const saved = await this.complianceModel!.create({
        loanId: loan.loanId,
        gstNo: undefined,
        panNo: loan.panNo ?? undefined,
        skipped: true,
        skipReason: 'gst_no is missing',
      });

      return {
        loanId: loan.loanId,
        gstNo: loan.gstNo,
        panNo: loan.panNo,
        processed: false,
        skipped: true,
        skipReason: 'gst_no is missing',
        mongoRecordId: String(saved._id),
      };
    }

    const verifyResponse = await this.gstComplianceClient.verifyGstin(gstNo);
    const verifyData = verifyResponse.data?.data;
    const hasStatusKey =
      verifyData != null &&
      typeof verifyData === 'object' &&
      'status' in verifyData &&
      verifyData.status != null &&
      String(verifyData.status).trim() !== '';

    let searchResponse: Record<string, unknown> | undefined;
    let searchFetched = false;

    if (hasStatusKey) {
      const searchResult = await this.gstComplianceClient.searchGstin(gstNo);
      searchResponse = searchResult as unknown as Record<string, unknown>;
      searchFetched = true;
    }

    const saved = await this.complianceModel!.findOneAndUpdate(
      { loanId: loan.loanId, gstNo },
      {
        loanId: loan.loanId,
        gstNo,
        panNo: loan.panNo ?? verifyData?.pan ?? undefined,
        verifyResponse: verifyResponse,
        searchResponse,
        verificationStatus: verifyData?.status,
        validGstin: verifyData?.validGstin,
        skipped: false,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    return {
      loanId: loan.loanId,
      gstNo: loan.gstNo,
      panNo: loan.panNo ?? verifyData?.pan ?? null,
      processed: true,
      verificationStatus: verifyData?.status,
      validGstin: verifyData?.validGstin,
      searchFetched,
      mongoRecordId: String(saved._id),
    };
  }

  async fetchLoanRecords(tableName?: string): Promise<LoanGstRecord[]> {
    const table = this.sanitizeIdentifier(
      tableName || this.configService.get<string>('LOAN_TABLE_NAME', 'loans'),
    );
    const loanIdColumn = this.sanitizeIdentifier(
      this.configService.get<string>('LOAN_ID_COLUMN', 'loan_id'),
    );
    const gstNoColumn = this.sanitizeIdentifier(
      this.configService.get<string>('GST_NO_COLUMN', 'gst_no'),
    );
    const panNoColumn = this.sanitizeIdentifier(
      this.configService.get<string>('PAN_NO_COLUMN', 'pan_no'),
    );

    await this.assertTableAndColumnsExist(
      table,
      loanIdColumn,
      gstNoColumn,
      panNoColumn,
    );

    const rows = await this.dataSource.query(
      `SELECT "${loanIdColumn}" AS "loanId", "${gstNoColumn}" AS "gstNo", "${panNoColumn}" AS "panNo" FROM "${table}"`,
    );

    return rows
      .map((row) => ({
        loanId: String(row.loanId ?? '').trim(),
        gstNo: row.gstNo == null ? null : String(row.gstNo).trim(),
        panNo: row.panNo == null ? null : String(row.panNo).trim(),
      }))
      .filter((row) => row.loanId.length > 0);
  }

  private async assertTableAndColumnsExist(
    table: string,
    ...columns: string[]
  ): Promise<void> {
    const tableExists = await this.dataSource.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1 LIMIT 1`,
      [table],
    );

    if (!tableExists.length) {
      throw new BadRequestException(
        `Loan table "${table}" was not found in PostgreSQL.`,
      );
    }

    for (const column of columns) {
      const columnExists = await this.dataSource.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2 LIMIT 1`,
        [table, column],
      );

      if (!columnExists.length) {
        throw new BadRequestException(
          `Column "${column}" was not found on table "${table}".`,
        );
      }
    }
  }

  private ensureMongoEnabled(): void {
    if (this.configService.get<string>('ENABLE_MONGO') !== 'true') {
      throw new ServiceUnavailableException(
        'MongoDB is disabled. Set ENABLE_MONGO=true and configure MONGO_URI.',
      );
    }

    if (!this.complianceModel) {
      throw new ServiceUnavailableException(
        'MongoDB model is not registered. Restart the server after enabling MongoDB.',
      );
    }
  }

  private sanitizeIdentifier(name: string): string {
    const cleaned = String(name ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '');

    if (!cleaned) {
      throw new BadRequestException(`Invalid identifier: "${name}"`);
    }

    return cleaned;
  }
}
