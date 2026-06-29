import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  ApiRequestLog,
  ApiRequestStatus,
} from '../../../entities/api-request-log.entity';

export interface ApiLogContext {
  gstrFamily: 'GSTIN' | 'GSTR';
  gstrType: 'GST-RETURN' | 'GSTR-1' | 'GSTR-2' | 'GSTR-3' | 'GSTR-2B' | 'GSTR-3B';
  apiName: string;
  associatedLoanId?: string | null;
  customerId?: string | null;
  gstNumber?: string | null;
  dataSource?: string | null;
  metadata?: Record<string, any>;
}

export interface ApiLogQuery {
  gstrType?:
    | 'GST-RETURN'
    | 'GSTR-1'
    | 'GSTR-2'
    | 'GSTR-3'
    | 'GSTR-2B'
    | 'GSTR-3B';
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
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(ApiRequestLog)
    private readonly logRepo: Repository<ApiRequestLog>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureTable();
  }

  async createProcessingLog(context: ApiLogContext): Promise<ApiRequestLog> {
    const log = this.logRepo.create({
      gstrFamily: context.gstrFamily,
      gstrType: context.gstrType,
      apiName: context.apiName,
      retryCount: 0,
      status: 'PROCESSING',
      associatedLoanId: context.associatedLoanId ?? null,
      customerId: context.customerId ?? null,
      gstNumber: context.gstNumber ?? null,
      dataSource: context.dataSource ?? null,
      metadata: context.metadata ?? null,
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

  async markSuccess(logId: string, statusCode: number, metadata?: Record<string, any>) {
    const existing = await this.logRepo.findOne({ where: { id: logId } });
    await this.logRepo.update(logId, {
      status: 'SUCCESS',
      responseStatusCode: statusCode,
      errorMessage: null,
      metadata: metadata
        ? { ...(existing?.metadata ?? {}), ...metadata }
        : existing?.metadata ?? null,
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
        : existing?.metadata ?? null,
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

    if (query.gstrType) qb.andWhere('log.gstrType = :gstrType', { gstrType: query.gstrType });
    if (query.status) qb.andWhere('log.status = :status', { status: query.status });
    if (query.customerId) qb.andWhere('log.customerId = :customerId', { customerId: query.customerId });
    if (query.associatedLoanId) {
      qb.andWhere('log.associatedLoanId = :associatedLoanId', {
        associatedLoanId: query.associatedLoanId,
      });
    }
    if (query.gstNumber) qb.andWhere('log.gstNumber = :gstNumber', { gstNumber: query.gstNumber });
    if (query.dataSource) qb.andWhere('log.dataSource = :dataSource', { dataSource: query.dataSource });
    if (query.apiName) qb.andWhere('log.apiName = :apiName', { apiName: query.apiName });
    if (query.fromDate) qb.andWhere('log.createdAt >= :fromDate', { fromDate: query.fromDate });
    if (query.toDate) qb.andWhere('log.createdAt <= :toDate', { toDate: query.toDate });

    const [items, total] = await qb.getManyAndCount();
    return { items, total, limit, offset };
  }

  private async ensureTable(): Promise<void> {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS api_request_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        gstr_family text NOT NULL,
        gstr_type text NOT NULL,
        api_name text NOT NULL,
        retry_count int NOT NULL DEFAULT 0,
        status character varying(32) NOT NULL DEFAULT 'PROCESSING',
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
}
