import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Connection } from 'mongoose';
import { DataSource, QueryRunner, Repository } from 'typeorm';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import { Job, JobStatus, JobType } from '../../entities/job.entity';
import { JobTask, TaskStatus } from '../../entities/job-task.entity';
import { FileStorageService } from '../shared/services/file-storage.service';

type PgType = 'INTEGER' | 'NUMERIC' | 'TIMESTAMP' | 'BOOLEAN' | 'TEXT';

interface ColumnDef {
  raw: string;
  name: string;
  type: PgType;
}

export const GST_UPLOAD_TABLE = 'gst_uploaded_file_data';

export interface AggregationRow {
  outputField: string;
  output: string;
}

export interface GstrStatusCounts {
  updated: number;
  pending: number;
  failed: number;
}

export interface CustomerGstrStatusSummary {
  GSTREG1: GstrStatusCounts;
  GSTR1: GstrStatusCounts;
  GSTR2B: GstrStatusCounts;
  GSTR3B: GstrStatusCounts;
}

export interface ApiRequestLogsBatchItem {
  loanId?: string;
  gstin?: string;
}

export interface PublicComplianceBatchItem {
  loanId: string;
  pan?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class GstService {
  private readonly logger = new Logger(GstService.name);
  private readonly mongoConnection?: Connection;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Job) private readonly jobRepo: Repository<Job>,
    @InjectRepository(JobTask) private readonly taskRepo: Repository<JobTask>,
    private readonly fileStorageService: FileStorageService,
    @Optional() @InjectConnection() mongoConnection?: Connection,
  ) {
    this.mongoConnection = mongoConnection;
  }

  // ------------------ Dashboard / read APIs (from feature/getApisAmishaBackend) ------------------

  async getPublicComplianceData(loanId: string) {
    if (!this.mongoConnection) {
      throw new ServiceUnavailableException('MongoDB not configured.');
    }

    try {
      const data = await this.mongoConnection
        .collection('gst_compliance_data')
        .aggregate([
          { $match: { loanId } },
          {
            $addFields: {
              _normalizedGstin: {
                $toUpper: {
                  $trim: {
                    input: {
                      $ifNull: ['$gstin', ''],
                    },
                  },
                },
              },
            },
          },
          {
            $lookup: {
              from: 'gst_return_filing_track',
              let: { gstin: '$_normalizedGstin' },
              pipeline: [
                {
                  $addFields: {
                    _normalizedGstin: {
                      $toUpper: {
                        $trim: {
                          input: { $ifNull: ['$gstin', ''] },
                        },
                      },
                    },
                  },
                },
                {
                  $match: {
                    $expr: { $eq: ['$_normalizedGstin', '$$gstin'] },
                  },
                },
                { $project: { _normalizedGstin: 0 } },
              ],
              as: 'filingHistory',
            },
          },
          { $project: { _normalizedGstin: 0 } },
        ])
        .toArray();

      return {
        loanId,
        count: data.length,
        data,
      };
    } catch (err) {
      this.logger.error('Error fetching compliance data', err);
      throw new InternalServerErrorException('Error fetching data');
    }
  }

  async getPublicComplianceDataBatch(requests: PublicComplianceBatchItem[]) {
    if (!this.mongoConnection) {
      throw new ServiceUnavailableException('MongoDB not configured.');
    }

    const normalizedRequests = requests
      .map((request) => ({
        loanId: String(request?.loanId ?? '').trim(),
        pan: String(request?.pan ?? '').trim(),
        page: request?.page ?? 1,
        limit: request?.limit ?? 50,
      }))
      .filter((request) => request.loanId);

    if (normalizedRequests.length === 0) {
      throw new BadRequestException('At least one valid loanId is required.');
    }
    if (normalizedRequests.length > 1000) {
      throw new BadRequestException('A maximum of 1000 requests is allowed.');
    }

    const loanIds = Array.from(
      new Set(normalizedRequests.map((request) => request.loanId)),
    );

    try {
      const data = await this.mongoConnection
        .collection('gst_compliance_data')
        .aggregate([
          { $match: { loanId: { $in: loanIds } } },
          {
            $addFields: {
              _normalizedGstin: {
                $toUpper: {
                  $trim: {
                    input: {
                      $ifNull: ['$gstin', ''],
                    },
                  },
                },
              },
            },
          },
          {
            $lookup: {
              from: 'gst_return_filing_track',
              let: { gstin: '$_normalizedGstin' },
              pipeline: [
                {
                  $addFields: {
                    _normalizedGstin: {
                      $toUpper: {
                        $trim: {
                          input: { $ifNull: ['$gstin', ''] },
                        },
                      },
                    },
                  },
                },
                {
                  $match: {
                    $expr: { $eq: ['$_normalizedGstin', '$$gstin'] },
                  },
                },
                { $project: { _normalizedGstin: 0 } },
              ],
              as: 'filingHistory',
            },
          },
          { $project: { _normalizedGstin: 0 } },
        ])
        .toArray();

      const rowsByLoanId = new Map<string, Record<string, any>[]>();
      for (const row of data) {
        const loanId = String(row?.loanId ?? '').trim();
        if (!rowsByLoanId.has(loanId)) rowsByLoanId.set(loanId, []);
        rowsByLoanId.get(loanId)!.push(row);
        }
      
      return {
        items: normalizedRequests.map((params) => {
          const rows = rowsByLoanId.get(params.loanId) ?? [];
          return {
            params,
            response: {
              loanId: params.loanId,
              count: rows.length,
              data: rows,
            },
          };
        }),
      };
    } catch (err) {
      this.logger.error('Error fetching compliance data batch', err);
      throw new InternalServerErrorException('Error fetching data');
    }
  }

  /**
   * Reads GSTR-2B and GSTR-3B compliance docs for a customer in parallel,
   * filtered by the requested years and months.
   */
  async getGstr2bAnd3bByCustomer(params: {
    customerId: string;
    years: number[];
    months: number[];
  }): Promise<{ GST2B: Record<string, any>[]; GST3B: Record<string, any>[] }> {
    if (!this.mongoConnection) {
      throw new ServiceUnavailableException('MongoDB not configured.');
    }

    const customerId = String(params.customerId ?? '').trim();
    if (!customerId) {
      throw new BadRequestException('customerId is required.');
    }

    const years = Array.from(
      new Set(
        (params.years ?? []).filter(
          (y) => Number.isInteger(y) && y >= 2000 && y <= 2100,
        ),
      ),
    );
    const months = Array.from(
      new Set(
        (params.months ?? []).filter(
          (m) => Number.isInteger(m) && m >= 1 && m <= 12,
        ),
      ),
    );

    if (years.length === 0) {
      throw new BadRequestException(
        'At least one valid year (2000–2100) is required.',
      );
    }
    if (months.length === 0) {
      throw new BadRequestException(
        'At least one valid month (1–12) is required.',
      );
    }

    const filter = {
      customerId,
      year: { $in: years },
      month: { $in: months },
    };

    try {
      const [GST2B, GST3B] = await Promise.all([
        this.mongoConnection
          .collection('gst_2b_compliance_data')
          .find(filter)
          .project({ __v: 0 })
          .toArray(),
        this.mongoConnection
          .collection('gst_3b_compliance_data')
          .find(filter)
          .project({ __v: 0 })
          .toArray(),
      ]);

      return { GST2B, GST3B };
    } catch (err) {
      this.logger.error(
        `Error fetching GSTR-2B/3B data for customerId=${customerId}`,
        err,
      );
      throw new InternalServerErrorException(
        'Error fetching GSTR-2B and GSTR-3B data',
      );
    }
  }

  async getPrimaryAggregation(loanId: string) {
    const query = 'SELECT * FROM public.primary_gst_aggregation WHERE associated_loan_id = $1';
    const result = await this.dataSource.query(query, [loanId]);
    return result;
  }

  async getSecondaryAggregation(loanId: string) {
    const query = 'SELECT * FROM public.secondary_gst_aggregation WHERE associated_loan_id = $1';
    const result = await this.dataSource.query(query, [loanId]);
    return result;
  }

  /**
   * Backs GET /gst/api-request-logs?loanId=...
   */
  async getApiRequestLogs(params: { loanId?: string; gstin?: string }) {
    const loanId = params.loanId?.trim();
    const gstin = params.gstin?.trim();

    if (!loanId && !gstin) {
      throw new BadRequestException('loanId or gstin is required.');
    }

    const conditions: string[] = [];
    const values: string[] = [];

    if (loanId) {
      values.push(loanId);
      conditions.push(`TRIM(associated_loan_id) = TRIM($${values.length})`);
    }

    if (gstin) {
      values.push(gstin);
      conditions.push(
        `UPPER(TRIM(gst_number)) = UPPER(TRIM($${values.length}))`,
      );
    }

    const timestampColumns = await this.dataSource.query<
      { column_name: string }[]
    >(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public'
       AND table_name = 'api_request_logs'
       AND column_name IN ('updated_at', 'created_at')`,
    );

    const availableColumns = new Set(
      (timestampColumns ?? []).map((c) => c.column_name),
    );
    const timestampColumn = availableColumns.has('updated_at')
      ? 'updated_at'
      : availableColumns.has('created_at')
        ? 'created_at'
        : null;

    const rows = await this.dataSource.query(
      `SELECT * FROM public.api_request_logs
     WHERE ${conditions.join(' OR ')}
     ${timestampColumn ? `ORDER BY "${timestampColumn}" DESC` : 'ORDER BY id DESC'}`,
      values,
    );

    const lastUpdatedAt =
      timestampColumn && rows?.length ? rows[0][timestampColumn] : null;

    return {
      loanId: loanId ?? null,
      gstin: gstin ?? null,
      count: rows?.length ?? 0,
      lastUpdatedAt,
      data: rows ?? [],
    };
  }

  async getApiRequestLogsBatch(requests: ApiRequestLogsBatchItem[]) {
    const normalizedRequests = requests
      .map((request) => ({
        loanId: String(request?.loanId ?? '').trim() || undefined,
        gstin:
          String(request?.gstin ?? '').trim().toUpperCase() || undefined,
      }))
      .filter((request) => request.loanId || request.gstin);

    if (normalizedRequests.length === 0) {
      throw new BadRequestException(
        'At least one valid loanId or gstin is required.',
      );
    }
    if (normalizedRequests.length > 2000) {
      throw new BadRequestException('A maximum of 2000 requests is allowed.');
    }

    const uniqueRequests = Array.from(
      new Map(
        normalizedRequests.map((request) => [
          `${request.loanId ?? ''}|${request.gstin ?? ''}`,
          request,
        ]),
      ).values(),
    );
    const loanIds = Array.from(
      new Set(
        uniqueRequests
          .map((request) => request.loanId)
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const gstins = Array.from(
      new Set(
        uniqueRequests
          .map((request) => request.gstin)
          .filter((value): value is string => Boolean(value)),
      ),
    );

    const timestampColumns = await this.dataSource.query<
      { column_name: string }[]
    >(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'api_request_logs'
         AND column_name IN ('updated_at', 'created_at')`,
    );
    const availableColumns = new Set(
      (timestampColumns ?? []).map((column) => column.column_name),
    );
    const timestampColumn = availableColumns.has('updated_at')
      ? 'updated_at'
      : availableColumns.has('created_at')
        ? 'created_at'
        : null;

    const conditions: string[] = [];
    const values: string[][] = [];
    if (loanIds.length > 0) {
      values.push(loanIds);
      conditions.push(
        `TRIM(associated_loan_id) = ANY($${values.length}::text[])`,
      );
    }
    if (gstins.length > 0) {
      values.push(gstins);
      conditions.push(
        `UPPER(TRIM(gst_number)) = ANY($${values.length}::text[])`,
      );
    }

    const rows = await this.dataSource.query(
      `SELECT * FROM public.api_request_logs
       WHERE ${conditions.join(' OR ')}
       ${timestampColumn ? `ORDER BY "${timestampColumn}" DESC NULLS LAST, id DESC` : 'ORDER BY id DESC'}`,
      values,
    );

    return {
      items: uniqueRequests.map((params) => {
        const matchingRows = (rows ?? []).filter((row: Record<string, any>) => {
          const loanMatches =
            Boolean(params.loanId) &&
            String(row.associated_loan_id ?? '').trim() === params.loanId;
          const gstinMatches =
            Boolean(params.gstin) &&
            String(row.gst_number ?? '').trim().toUpperCase() === params.gstin;
          return loanMatches || gstinMatches;
        });

        return {
          params,
          response: {
            loanId: params.loanId ?? null,
            gstin: params.gstin ?? null,
            count: matchingRows.length,
            lastUpdatedAt:
              timestampColumn && matchingRows.length
                ? matchingRows[0][timestampColumn]
                : null,
            data: matchingRows,
          },
        };
      }),
    };
  }

  /**
   * Backs GET /gst/customer-gstr-status-counts
   */
  async getCustomerGstrStatusCounts(): Promise<
    Record<string, CustomerGstrStatusSummary>
  > {
    const timestampColumns = await this.dataSource.query<
      { column_name: string }[]
    >(
      `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'api_request_logs'
       AND column_name IN ('updated_at', 'created_at')`,
    );

    const availableColumns = new Set(
      (timestampColumns ?? []).map((c) => c.column_name),
    );
    const timestampColumn = availableColumns.has('updated_at')
      ? 'updated_at'
      : availableColumns.has('created_at')
        ? 'created_at'
        : 'id';

    const uploadedUnits = await this.dataSource.query<
      { customer_id: string; loan_id: string; gst_number: string }[]
    >(
      `SELECT DISTINCT
       TRIM(customer_id) AS customer_id,
       TRIM(associated_loan_id) AS loan_id,
       UPPER(TRIM(gst_number)) AS gst_number
     FROM (
       SELECT customer_id, associated_loan_id, primary_gst_no AS gst_number
       FROM public."${GST_UPLOAD_TABLE}"
       UNION
       SELECT customer_id, associated_loan_id, considered_entity_gst_no AS gst_number
       FROM public."${GST_UPLOAD_TABLE}"
     ) uploaded
     WHERE customer_id IS NOT NULL
       AND TRIM(customer_id) <> ''
       AND associated_loan_id IS NOT NULL
       AND TRIM(associated_loan_id) <> ''
       AND gst_number IS NOT NULL
       AND TRIM(gst_number) <> ''`,
    );

    const latestLogs = await this.dataSource.query<
      {
        customer_id: string;
        loan_id: string;
        gst_number: string;
        gstr_type: string;
        status: string;
      }[]
    >(
      `SELECT DISTINCT ON (
       TRIM(customer_id),
       TRIM(associated_loan_id),
       UPPER(TRIM(gst_number)),
       UPPER(TRIM(gstr_type))
     )
       TRIM(customer_id) AS customer_id,
       TRIM(associated_loan_id) AS loan_id,
       UPPER(TRIM(gst_number)) AS gst_number,
       UPPER(TRIM(gstr_type)) AS gstr_type,
       UPPER(TRIM(status)) AS status
     FROM public.api_request_logs
     WHERE customer_id IS NOT NULL
       AND TRIM(customer_id) <> ''
       AND associated_loan_id IS NOT NULL
       AND TRIM(associated_loan_id) <> ''
       AND gst_number IS NOT NULL
       AND TRIM(gst_number) <> ''
       AND UPPER(TRIM(gstr_type)) IN ('GSTR-1', 'GSTR-2B', 'GSTR-3B', 'GSTREG-1', 'GSTREG1')
     ORDER BY
       TRIM(customer_id),
       TRIM(associated_loan_id),
       UPPER(TRIM(gst_number)),
       UPPER(TRIM(gstr_type)),
       "${timestampColumn}" DESC NULLS LAST,
       id DESC`,
    );

    const gstrTypeMap: Record<string, keyof CustomerGstrStatusSummary> = {
      'GSTR-1': 'GSTR1',
      'GSTR-2B': 'GSTR2B',
      'GSTR-3B': 'GSTR3B',
      'GSTREG-1': 'GSTREG1',
      'GSTREG1': 'GSTREG1',
    };

    const createEmptyCounts = (): GstrStatusCounts => ({
      updated: 0,
      pending: 0,
      failed: 0,
    });

    const createEmptySummary = (): CustomerGstrStatusSummary => ({
      GSTREG1: createEmptyCounts(),
      GSTR1: createEmptyCounts(),
      GSTR2B: createEmptyCounts(),
      GSTR3B: createEmptyCounts(),
    });

    const unitsByCustomer = new Map<
      string,
      Array<{ loanId: string; gstNumber: string }>
    >();
    for (const row of uploadedUnits ?? []) {
      if (!unitsByCustomer.has(row.customer_id)) {
        unitsByCustomer.set(row.customer_id, []);
      }
      unitsByCustomer.get(row.customer_id)!.push({
        loanId: row.loan_id,
        gstNumber: row.gst_number,
      });
    }

    const statusByCustomerLoanGstinType = new Map<string, string>();
    for (const row of latestLogs ?? []) {
      const summaryKey = gstrTypeMap[row.gstr_type];
      if (!summaryKey) continue;
      statusByCustomerLoanGstinType.set(
        `${row.customer_id}|${row.loan_id}|${row.gst_number}|${summaryKey}`,
        row.status,
      );
    }

    const result: Record<string, CustomerGstrStatusSummary> = {};

    for (const [customerId, units] of unitsByCustomer) {
      const summary = createEmptySummary();

      for (const gstrKey of ['GSTREG1', 'GSTR1', 'GSTR2B', 'GSTR3B'] as const) {
        for (const unit of units) {
          const status = statusByCustomerLoanGstinType.get(
            `${customerId}|${unit.loanId}|${unit.gstNumber}|${gstrKey}`,
          );

          if (!status) {
            summary[gstrKey].pending += 1;
          } else if (status === 'SUCCESS') {
            summary[gstrKey].updated += 1;
          } else if (status === 'FAILED') {
            summary[gstrKey].failed += 1;
          } else {
            summary[gstrKey].pending += 1;
          }
        }
      }

      result[customerId] = summary;
    }

    return result;
  }

  async getAggregationTable(
    loanId: string,
    type: 'primary' | 'secondary' = 'primary',
  ): Promise<{ rows: AggregationRow[]; debug: Record<string, unknown> }> {
    const trimmedLoanId = loanId?.trim();

    if (!trimmedLoanId) {
      throw new BadRequestException('loanId is required.');
    }

    const debug: Record<string, unknown> = {
      receivedLoanId: trimmedLoanId,
      requestedType: type,
    };

    let rows: any[] = [];

    if (type === 'primary') {
      rows = await this.dataSource.query(
        'SELECT * FROM public.primary_gst_aggregation WHERE TRIM(associated_loan_id) = TRIM($1)',
        [trimmedLoanId],
      );
      debug.source = 'primary_gst_aggregation';
    } else {
      rows = await this.dataSource.query(
        'SELECT * FROM public.secondary_gst_aggregation WHERE TRIM(associated_loan_id) = TRIM($1)',
        [trimmedLoanId],
      );
      debug.source = 'secondary_gst_aggregation';
    }

    debug.rowCount = rows?.length ?? 0;

    const result: AggregationRow[] = [];
    const hasMultipleRows = (rows ?? []).length > 1;

    for (const row of rows ?? []) {
      const parsed = this.parseAggregationVariable(row.aggregation_variable);

      for (const [key, value] of Object.entries(parsed)) {
        const outputField =
          type === 'secondary' && hasMultipleRows && row.customer_id
            ? `${key} (${row.customer_id})`
            : key;

        result.push({
          outputField,
          output: this.formatOutputValue(value),
        });
      }
    }

    debug.parsedEntryCount = result.length;

    return { rows: result, debug };
  }

  private formatOutputValue(value: unknown): string {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  }

  private parseAggregationVariable(raw: unknown): Record<string, unknown> {
    if (raw === null || raw === undefined) return {};

    if (typeof raw === 'object') {
      return raw as Record<string, unknown>;
    }

    const str = String(raw).trim();
    if (!str || str === '{}') return {};

    const jsonLike = str
      .replace(/'/g, '"')
      .replace(/\bNone\b/g, 'null')
      .replace(/\bTrue\b/g, 'true')
      .replace(/\bFalse\b/g, 'false');

    try {
      const parsed = JSON.parse(jsonLike);
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch {
      this.logger.warn(
        `Failed to parse aggregation_variable as JSON. Raw (first 200 chars): ${str.slice(0, 200)}`,
      );
      return {};
    }
  }

  async getTableData(rawTableName: string, page = 1, limit = 50) {
    const tableName = this.sanitizeIdentifier(rawTableName);
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), 500);
    const offset = (safePage - 1) * safeLimit;

    const exists = await this.dataSource.query<{ exists: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = $1
       ) AS "exists"`,
      [tableName],
    );

    if (!exists[0]?.exists) {
      return {
        table: tableName,
        total: 0,
        page: safePage,
        limit: safeLimit,
        data: [],
      };
    }

    try {
      const countResult = await this.dataSource.query<{ total: number }[]>(
        `SELECT COUNT(*)::int AS total FROM "${tableName}"`,
      );
      const total = countResult[0]?.total ?? 0;

      const rows = await this.dataSource.query(
        `SELECT * FROM "${tableName}" ORDER BY id ASC LIMIT $1 OFFSET $2`,
        [safeLimit, offset],
      );

      return {
        table: tableName,
        total,
        page: safePage,
        limit: safeLimit,
        data: rows,
      };
    } catch (err) {
      this.logger.error(
        `Failed to fetch data from "${tableName}"`,
        err as Error,
      );
      throw new InternalServerErrorException(
        `Failed to fetch data: ${(err as Error).message}`,
      );
    }
  }

  getDebugConnectionInfo() {
    const opts = this.dataSource.options as any;
    return {
      type: opts.type,
      database: opts.database,
      host: opts.host,
      port: opts.port,
      schema: opts.schema ?? 'public',
    };
  }


  // -------------------- Job Tracking Helpers ------------------

  async createJob(type: JobType, metadata: Record<string, any>): Promise<Job> {
    const job = this.jobRepo.create({
      type,
      status: 'PENDING',
      metadata,
    });
    return this.jobRepo.save(job);
  }

  async getJobStatus(jobId: string): Promise<Job | null> {
    return this.jobRepo.findOne({
      where: { id: jobId },
      relations: { tasks: true },
    });
  }

  async updateJobStatus(
    jobId: string,
    status: JobStatus,
    errorMessage?: string,
  ): Promise<void> {
    await this.jobRepo.update(jobId, { status, errorMessage });
    this.logger.log(`Job ${jobId} status updated to ${status}`);
  }

  async setJobTotalChunks(jobId: string, totalChunks: number): Promise<void> {
    await this.jobRepo.update(jobId, { totalChunks });
  }

  async setJobProgress(jobId: string, completedChunks: number): Promise<void> {
    await this.jobRepo.update(jobId, { completedChunks });
  }

  async finishJob(
    jobId: string,
    metadata: Record<string, any>,
  ): Promise<void> {
    const job = await this.jobRepo.findOne({ where: { id: jobId } });
    await this.jobRepo.update(jobId, {
      status: 'COMPLETED',
      metadata: { ...(job?.metadata ?? {}), ...metadata },
    });
    this.logger.log(`Job ${jobId} completed`);
  }

  /** Merge a partial object into the job's existing metadata. */
  async mergeJobMetadata(
    jobId: string,
    patch: Record<string, any>,
  ): Promise<void> {
    const job = await this.jobRepo.findOne({ where: { id: jobId } });
    await this.jobRepo.update(jobId, {
      metadata: { ...(job?.metadata ?? {}), ...patch },
    });
  }

  // ------------------ Task Helpers ------------------

  async createTask(
    jobId: string,
    payload: Record<string, any>,
  ): Promise<JobTask> {
    const task = this.taskRepo.create({ jobId, status: 'PENDING', payload });
    return this.taskRepo.save(task);
  }

  async getJobTasks(jobId: string): Promise<JobTask[]> {
    return this.taskRepo.find({ where: { jobId } });
  }

  /** Update a task's status and merge a result object into its payload. */
  async markTask(
    taskId: string,
    status: TaskStatus,
    patch: {
      result?: Record<string, any>;
      errorMessage?: string;
      attempts?: number;
    } = {},
  ): Promise<void> {
    const task = await this.taskRepo.findOne({ where: { id: taskId } });
    const payload = { ...(task?.payload ?? {}) };
    if (patch.result !== undefined) payload.result = patch.result;

    await this.taskRepo.update(taskId, {
      status,
      payload,
      ...(patch.errorMessage !== undefined
        ? { errorMessage: patch.errorMessage }
        : {}),
      ...(patch.attempts !== undefined ? { attempts: patch.attempts } : {}),
    });
  }

  /**
   * Atomically increment completedChunks and report whether this call was the
   * one that completed the job (race-safe across concurrent workers).
   */
  async incrementCompletedChunks(
    jobId: string,
  ): Promise<{ completed: number; total: number; justCompleted: boolean }> {
    const result = await this.jobRepo
      .createQueryBuilder()
      .update(Job)
      .set({ completedChunks: () => '"completedChunks" + 1' })
      .where('id = :id', { id: jobId })
      .returning(['completedChunks', 'totalChunks'])
      .execute();

    const raw = (result.raw?.[0] ?? {}) as Record<string, any>;
    const completed = Number(raw.completedChunks ?? raw.completedchunks ?? 0);
    const total = Number(raw.totalChunks ?? raw.totalchunks ?? 0);
    const justCompleted = total > 0 && completed === total;
    return { completed, total, justCompleted };
  }

  // ------------------ Asynchronous Workers ------------------

  /**
   * Worker method to process Excel/CSV import from disk (append or migrate schema).
   */
  async processExcel(filePath: string, rawTableName: string, jobId: string) {
    await this.jobRepo.update(jobId, { status: 'PROCESSING' });
    const tableName = this.sanitizeIdentifier(rawTableName);

    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`Cached file not found at path: ${filePath}`);
      }

      const job = await this.jobRepo.findOne({ where: { id: jobId } });
      const meta = (job?.metadata ?? {}) as {
        originalName?: string;
        mimetype?: string;
      };
      const originalName = meta.originalName ?? filePath;
      const mimetype = meta.mimetype;
      const isCsv = this.isCsvFile(originalName, mimetype);

      const buffer = fs.readFileSync(filePath);
      const workbook = isCsv
        ? XLSX.read(buffer.toString('utf8'), { type: 'string', cellDates: true })
        : XLSX.read(buffer, { type: 'buffer', cellDates: true });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        throw new BadRequestException('Uploaded file contains no sheets.');
      }
      const sheet = workbook.Sheets[sheetName];

      const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, {
        defval: null,
        raw: !isCsv,
      });

      if (rows.length === 0) {
        throw new BadRequestException(
          'Uploaded sheet is empty. Need at least one data row.',
        );
      }

      const headerSet = new Set<string>();
      for (const row of rows) {
        Object.keys(row).forEach((k) => headerSet.add(k));
      }
      const rawHeaders = Array.from(headerSet);
      if (rawHeaders.length === 0) {
        throw new BadRequestException('No columns detected in the uploaded file.');
      }

      const columns: ColumnDef[] = rawHeaders.map((header) => ({
        raw: header,
        name: this.sanitizeIdentifier(header),
        type: this.inferColumnType(rows, header),
      }));

      const seen = new Set<string>();
      for (const col of columns) {
        if (seen.has(col.name)) {
          throw new BadRequestException(
            `Duplicate column name "${col.name}" after sanitization. Rename headers in the file.`,
          );
        }
        seen.add(col.name);
      }

      await this.jobRepo.update(jobId, { totalChunks: 1 });

      const rowsInserted = await this.appendRowsToTable(tableName, rows, columns);

      const completedMetadata: Record<string, any> = {
        ...meta,
        rowsInserted,
        sheet: sheetName,
      };
      await this.jobRepo.update(jobId, {
        status: 'COMPLETED',
        completedChunks: 1,
        metadata: completedMetadata,
      });
    } catch (err) {
      await this.updateJobStatus(jobId, 'FAILED', (err as Error).message);
      throw err;
    } finally {
      await this.fileStorageService.deleteFile(filePath);
    }
  }

  // ------------------ DB import (append / schema migrate) ------------------

  private async appendRowsToTable(
    tableName: string,
    rows: Record<string, unknown>[],
    columns: ColumnDef[],
  ): Promise<number> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    const insertColumns: ColumnDef[] = columns.map((c) => ({ ...c }));

    try {
      await this.ensureTableSchema(queryRunner, tableName, insertColumns);

      const colList = insertColumns.map((c) => `"${c.name}"`).join(', ');
      const batchSize = 500;
      let inserted = 0;

      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const params: unknown[] = [];
        const valueRows: string[] = [];

        for (const row of batch) {
          const rowPlaceholders: string[] = [];
          for (const col of insertColumns) {
            rowPlaceholders.push(`$${params.length + 1}`);
            params.push(this.coerceValue(row[col.raw], col.type));
          }
          valueRows.push(`(${rowPlaceholders.join(', ')})`);
        }

        const insertSql = `INSERT INTO "${tableName}" (${colList}) VALUES ${valueRows.join(', ')}`;
        await queryRunner.query(insertSql, params);
        inserted += batch.length;
      }

      await queryRunner.commitTransaction();
      return inserted;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  private async ensureTableSchema(
    queryRunner: QueryRunner,
    tableName: string,
    insertColumns: ColumnDef[],
  ): Promise<void> {
    const tableExists = await this.tableExists(queryRunner, tableName);

    if (!tableExists) {
      const createSql = this.buildCreateTableSql(tableName, insertColumns);
      this.logger.log(`Creating table: ${createSql}`);
      await queryRunner.query(createSql);
      return;
    }

    const existingCols = await this.getExistingColumnTypes(queryRunner, tableName);

    for (const col of insertColumns) {
      const existingType = existingCols.get(col.name);

      if (existingType === undefined) {
        const alterSql = `ALTER TABLE "${tableName}" ADD COLUMN "${col.name}" ${col.type} NULL`;
        this.logger.log(`Adding column: ${alterSql}`);
        await queryRunner.query(alterSql);
        continue;
      }

      const mergedType = this.mergeType(existingType, col.type);
      if (mergedType !== existingType) {
        const alterSql = `ALTER TABLE "${tableName}" ALTER COLUMN "${col.name}" TYPE ${mergedType} USING "${col.name}"::${this.pgCastTarget(mergedType)}`;
        this.logger.log(`Widening column: ${alterSql}`);
        await queryRunner.query(alterSql);
      }
      col.type = mergedType;
    }
  }

  private async tableExists(
    queryRunner: QueryRunner,
    tableName: string,
  ): Promise<boolean> {
    const result: Array<{ exists: boolean }> = await queryRunner.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = current_schema() AND table_name = $1
       ) AS "exists"`,
      [tableName],
    );
    return Boolean(result?.[0]?.exists);
  }

  private async getExistingColumnTypes(
    queryRunner: QueryRunner,
    tableName: string,
  ): Promise<Map<string, PgType>> {
    const rows: Array<{ column_name: string; data_type: string }> =
      await queryRunner.query(
        `SELECT column_name, data_type FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = $1`,
        [tableName],
      );
    const map = new Map<string, PgType>();
    for (const r of rows) {
      map.set(r.column_name, this.mapPgDataType(r.data_type));
    }
    return map;
  }

  private mapPgDataType(dataType: string): PgType {
    const t = dataType.toLowerCase();
    if (
      t === 'integer' ||
      t === 'smallint' ||
      t === 'bigint' ||
      t === 'serial' ||
      t === 'bigserial'
    )
      return 'INTEGER';
    if (
      t === 'numeric' ||
      t === 'decimal' ||
      t === 'real' ||
      t === 'double precision'
    )
      return 'NUMERIC';
    if (t.startsWith('timestamp') || t === 'date') return 'TIMESTAMP';
    if (t === 'boolean') return 'BOOLEAN';
    return 'TEXT';
  }

  private mergeType(a: PgType, b: PgType): PgType {
    if (a === b) return a;
    if (
      (a === 'INTEGER' && b === 'NUMERIC') ||
      (a === 'NUMERIC' && b === 'INTEGER')
    )
      return 'NUMERIC';
    return 'TEXT';
  }

  private pgCastTarget(type: PgType): string {
    switch (type) {
      case 'INTEGER':
        return 'integer';
      case 'NUMERIC':
        return 'numeric';
      case 'TIMESTAMP':
        return 'timestamp';
      case 'BOOLEAN':
        return 'boolean';
      case 'TEXT':
      default:
        return 'text';
    }
  }

  // ----------------------- helpers -----------------------

  private sanitizeIdentifier(name: string): string {
    const cleaned = String(name ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '');

    if (!cleaned) {
      throw new BadRequestException(`Invalid identifier: "${name}"`);
    }
    const safe = /^\d/.test(cleaned) ? `_${cleaned}` : cleaned;
    return safe.slice(0, 63);
  }

  private inferColumnType(
    rows: Record<string, unknown>[],
    header: string,
  ): PgType {
    let allInt = true;
    let allNumber = true;
    let allDate = true;
    let allBool = true;
    let hasValue = false;

    for (const row of rows) {
      const v = row[header];
      if (v === null || v === undefined || v === '') continue;
      hasValue = true;

      const boolStr =
        typeof v === 'string' && ['true', 'false'].includes(v.toLowerCase());
      if (typeof v !== 'boolean' && !boolStr) allBool = false;

      let asNumber: number | null = null;
      if (typeof v === 'number' && Number.isFinite(v)) {
        asNumber = v;
      } else if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v);
        if (Number.isFinite(n)) asNumber = n;
      }
      if (asNumber === null) {
        allInt = false;
        allNumber = false;
      } else if (!Number.isInteger(asNumber)) {
        allInt = false;
      }

      if (v instanceof Date) {
        // ok
      } else if (typeof v === 'string') {
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) allDate = false;
      } else {
        allDate = false;
      }
    }

    if (!hasValue) return 'TEXT';
    if (allBool) return 'BOOLEAN';
    if (allInt) return 'INTEGER';
    if (allNumber) return 'NUMERIC';
    if (allDate) return 'TIMESTAMP';
    return 'TEXT';
  }

  private isCsvFile(
    originalName: string | undefined,
    mimetype: string | undefined,
  ): boolean {
    const ext = (originalName || '').toLowerCase().split('.').pop();
    if (ext === 'csv') return true;
    const csvMimes = ['text/csv', 'application/csv'];
    return !!mimetype && csvMimes.includes(mimetype);
  }

  private coerceValue(value: unknown, type: PgType): unknown {
    if (value === null || value === undefined || value === '') return null;

    switch (type) {
      case 'INTEGER':
      case 'NUMERIC': {
        const n = typeof value === 'number' ? value : Number(value);
        return Number.isFinite(n) ? n : null;
      }
      case 'TIMESTAMP': {
        if (value instanceof Date) return value.toISOString();
        const d = new Date(String(value));
        return Number.isNaN(d.getTime()) ? null : d.toISOString();
      }
      case 'BOOLEAN': {
        if (typeof value === 'boolean') return value;
        const s = String(value).trim().toLowerCase();
        if (['true', '1', 'yes', 'y'].includes(s)) return true;
        if (['false', '0', 'no', 'n'].includes(s)) return false;
        return Boolean(value);
      }
      case 'TEXT':
      default:
        return String(value);
    }
  }

  private buildCreateTableSql(tableName: string, columns: ColumnDef[]): string {
    const cols = columns.map((c) => `"${c.name}" ${c.type} NULL`).join(', ');
    return `CREATE TABLE "${tableName}" (id SERIAL PRIMARY KEY, ${cols})`;
  }
}
