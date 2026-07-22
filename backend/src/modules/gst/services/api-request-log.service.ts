import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  ApiRequestLog,
  ApiRequestStatus,
} from '../../../entities/api-request-log.entity';

export type ApiLogGstrType =
  | 'GST-RETURN'
  | 'GST-NOTICES'
  | 'GSTR'
  | 'GSTR-2'
  | 'GSTR-3'
  | 'GSTR-2B'
  | 'GSTR-3B';

export interface ApiLogContext {
  gstrFamily: 'GSTIN' | 'GSTR';
  gstrType: ApiLogGstrType;
  apiName: string;
  associatedLoanId?: string | null;
  customerId?: string | null;
  gstNumber?: string | null;
  dataSource?: string | null;
  metadata?: Record<string, any>;
}

export interface ApiLogQuery {
  gstrType?: ApiLogGstrType;
  status?: ApiRequestStatus;
  customerId?: string;
  associatedLoanId?: string;
  gstNumber?: string;
  dataSource?: string;
  apiName?: string;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  offset?: number;
}

@Injectable()
export class ApiRequestLogService implements OnModuleInit {
  private readonly logger = new Logger(ApiRequestLogService.name);

  
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(ApiRequestLog)
    private readonly logRepo: Repository<ApiRequestLog>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureTable();
    } catch (err) {
      this.logger.error(
        `Failed to ensure "api_request_logs" table during startup: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Starts a request log. Reuses an existing row for the same API identity
   * (apiName + gstrType + gstNumber + loan/customer + year/month) and bumps
   * retry_count instead of inserting a duplicate row.
   */
  async createProcessingLog(context: ApiLogContext): Promise<ApiRequestLog> {
    const normalizedCustomerId =
      this.normalizeNullableText(context.customerId) ??
      this.normalizeNullableText(context.metadata?.username);
    const normalizedGstNumber = this.normalizeNullableText(context.gstNumber);
    const normalizedAssociatedLoanId =
      this.normalizeNullableText(context.associatedLoanId) ??
      (normalizedCustomerId && normalizedGstNumber
        ? `${normalizedCustomerId}:${normalizedGstNumber}`
        : null);
    const normalizedDataSource = this.normalizeNullableText(context.dataSource);
    const metadata = context.metadata ?? null;

    const existing = await this.findExistingLog({
      gstrType: context.gstrType,
      apiName: context.apiName,
      gstNumber: normalizedGstNumber,
      associatedLoanId: normalizedAssociatedLoanId,
      customerId: normalizedCustomerId,
      metadata,
    });

    if (existing) {
      existing.retryCount = (existing.retryCount ?? 0) + 1;
      existing.status = 'PENDING';
      existing.responseStatusCode = null;
      existing.errorMessage = null;
      existing.gstrFamily = context.gstrFamily;
      existing.dataSource = normalizedDataSource ?? existing.dataSource;
      existing.metadata = {
        ...(existing.metadata ?? {}),
        ...(metadata ?? {}),
      };
      return this.logRepo.save(existing);
    }

    const log = this.logRepo.create({
      gstrFamily: context.gstrFamily,
      gstrType: context.gstrType,
      apiName: context.apiName,
      retryCount: 0,
      status: 'PENDING',
      associatedLoanId: normalizedAssociatedLoanId,
      customerId: normalizedCustomerId,
      gstNumber: normalizedGstNumber,
      dataSource: normalizedDataSource,
      metadata,
    });
    return this.logRepo.save(log);
  }

  async incrementRetry(logId: string): Promise<void> {
    await this.logRepo
      .createQueryBuilder()
      .update(ApiRequestLog)
      .set({ retryCount: () => '"retry_count" + 1' })
      .where('id = :id', { id: logId })
      .execute();
  }

  async markSuccess(
    logId: string,
    statusCode: number,
    metadata?: Record<string, any>,
  ) {
    const existing = await this.logRepo.findOne({ where: { id: logId } });
    await this.logRepo.update(logId, {
      status: 'SUCCESS',
      responseStatusCode: statusCode,
      errorMessage: null,
      metadata: metadata
        ? { ...(existing?.metadata ?? {}), ...metadata }
        : (existing?.metadata ?? null),
    });
  }

  async markFailure(
    logId: string,
    statusCode: number | null,
    errorMessage: string,
    metadata?: Record<string, any>,
  ): Promise<void> {
    const existing = await this.logRepo.findOne({ where: { id: logId } });
    await this.logRepo.update(logId, {
      status: 'FAILED',
      responseStatusCode: statusCode,
      errorMessage,
      metadata: metadata
        ? { ...(existing?.metadata ?? {}), ...metadata }
        : (existing?.metadata ?? null),
    });
  }

  async getLogs(query: ApiLogQuery): Promise<{
    items: ApiRequestLog[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const offset = Math.max(query.offset ?? 0, 0);

    const qb = this.logRepo
      .createQueryBuilder('log')
      .orderBy('log.createdAt', 'DESC')
      .take(limit)
      .skip(offset);

    if (query.gstrType)
      qb.andWhere('log.gstrType = :gstrType', { gstrType: query.gstrType });
    if (query.status)
      qb.andWhere('log.status = :status', { status: query.status });
    if (query.customerId)
      qb.andWhere('log.customerId = :customerId', {
        customerId: query.customerId,
      });
    if (query.associatedLoanId) {
      qb.andWhere('log.associatedLoanId = :associatedLoanId', {
        associatedLoanId: query.associatedLoanId,
      });
    }
    if (query.gstNumber)
      qb.andWhere('log.gstNumber = :gstNumber', { gstNumber: query.gstNumber });
    if (query.dataSource)
      qb.andWhere('log.dataSource = :dataSource', {
        dataSource: query.dataSource,
      });
    if (query.apiName)
      qb.andWhere('log.apiName = :apiName', { apiName: query.apiName });
    if (query.fromDate)
      qb.andWhere('log.createdAt >= :fromDate', { fromDate: query.fromDate });
    if (query.toDate)
      qb.andWhere('log.createdAt <= :toDate', { toDate: query.toDate });

    const [items, total] = await qb.getManyAndCount();
    return { items, total, limit, offset };
  }

  private async findExistingLog(params: {
    gstrType: string;
    apiName: string;
    gstNumber: string | null;
    associatedLoanId: string | null;
    customerId: string | null;
    metadata: Record<string, any> | null;
  }): Promise<ApiRequestLog | null> {
    const qb = this.logRepo
      .createQueryBuilder('log')
      .where('log.gstrType = :gstrType', { gstrType: params.gstrType })
      .andWhere('log.apiName = :apiName', { apiName: params.apiName })
      .orderBy('log.updatedAt', 'DESC')
      .take(1);

    if (params.gstNumber) {
      qb.andWhere('log.gstNumber = :gstNumber', {
        gstNumber: params.gstNumber,
      });
    } else {
      qb.andWhere('log.gstNumber IS NULL');
    }

    if (params.associatedLoanId) {
      qb.andWhere('log.associatedLoanId = :associatedLoanId', {
        associatedLoanId: params.associatedLoanId,
      });
    } else if (params.customerId) {
      qb.andWhere('log.customerId = :customerId', {
        customerId: params.customerId,
      });
    }

    const year = params.metadata?.year;
    const month = params.metadata?.month;
    const financialYear = params.metadata?.financialYear;
    const date = params.metadata?.date;
    const referenceId = params.metadata?.referenceId;
    if (year !== undefined && year !== null && String(year).trim() !== '') {
      qb.andWhere(`log.metadata->>'year' = :year`, { year: String(year) });
    }
    if (month !== undefined && month !== null && String(month).trim() !== '') {
      qb.andWhere(`log.metadata->>'month' = :month`, { month: String(month) });
    }
    if (
      financialYear !== undefined &&
      financialYear !== null &&

      String(financialYear).trim() !== ''
    ) {
      qb.andWhere(`log.metadata->>'financialYear' = :financialYear`, {
        financialYear: String(financialYear),
      });
    }
    if (date !== undefined && date !== null && String(date).trim() !== '') {
      qb.andWhere(`log.metadata->>'date' = :date`, { date: String(date) });
    }
    if (
      referenceId !== undefined &&
      referenceId !== null &&
      String(referenceId).trim() !== ''
    ) {
      qb.andWhere(`log.metadata->>'referenceId' = :referenceId`, {
        referenceId: String(referenceId),
      });
    }

    return qb.getOne();
  }

  private async ensureTable(): Promise<void> {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS api_request_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        gstr_family text NOT NULL,
        gstr_type text NOT NULL,
        
        api_name text NOT NULL,
        retry_count int NOT NULL DEFAULT 0,
        status character varying(32) NOT NULL DEFAULT 'PENDING',
        associated_loan_id text NULL,
        customer_id text NULL,
        gst_number text NULL,
        data_source text NULL,
        response_status_code int NULL,
        error_message text NULL,
        metadata jsonb NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  private normalizeNullableText(value: unknown): string | null {
    const normalized = String(value ?? '').trim();
    return normalized ? normalized : null;
  }
}

