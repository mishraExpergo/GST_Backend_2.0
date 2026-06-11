import {
  Injectable,
  Logger,
  Optional,
  Inject,
  ServiceUnavailableException,
  BadRequestException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ClientProxy } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { Job } from '../../../entities/job.entity';
import { GstService } from '../gst.service';
import { GstApiService } from './gst-api.service';
import { GstComplianceRecord } from '../schemas/gst-compliance.schema';
import { GstrComplianceRecord } from '../schemas/gst-gstr-compliance.schema';
import { Gstr2bComplianceRecord } from '../schemas/gst-2b-compliance.schema';

interface SourceRow {
  loan_id: string;
  gst_no: string | null;
  pan: string | null;
}

interface Gstr2bParams {
  year: number;
  month: number;
  filingPreference: string;
  reconciliationCriteria: string;
}

interface BatchResult {
  totalRows: number;
  verified: number;
  stored: number;
  skippedNoGstin: number;
  skippedInvalidGstin: number;
  skippedNoStatus: number;
  failed: number;
}

const DEFAULT_SOURCE_TABLE = 'gst_uploaded_file_data';
const GSTIN_PATTERN =
  /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

@Injectable()
export class GstComplianceService {
  private readonly logger = new Logger(GstComplianceService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly gstService: GstService,
    private readonly gstApiService: GstApiService,
    private readonly config: ConfigService,
    @Optional()
    @InjectModel(GstComplianceRecord.name)
    private readonly complianceModel?: Model<GstComplianceRecord>,
    @Optional()
    @InjectModel(GstrComplianceRecord.name)
    private readonly gstrComplianceModel?: Model<GstrComplianceRecord>,
    @Optional()
    @InjectModel(Gstr2bComplianceRecord.name)
    private readonly gstr2bComplianceModel?: Model<Gstr2bComplianceRecord>,
    @Optional()
    @Inject('VERIFY_PARENT_SERVICE')
    private readonly verifyParentClient?: ClientProxy,
    @Optional()
    @Inject('VERIFY_CHUNK_SERVICE')
    private readonly verifyChunkClient?: ClientProxy,
    @Optional()
    @Inject('VERIFY_GSTR_PARENT_SERVICE')
    private readonly verifyGstrParentClient?: ClientProxy,
    @Optional()
    @Inject('VERIFY_GSTR_CHUNK_SERVICE')
    private readonly verifyGstrChunkClient?: ClientProxy,
    @Optional()
    @Inject('VERIFY_2B_PARENT_SERVICE')
    private readonly verify2bParentClient?: ClientProxy,
    @Optional()
    @Inject('VERIFY_2B_CHUNK_SERVICE')
    private readonly verify2bChunkClient?: ClientProxy,
  ) {}

  private get batchSize(): number {
    return Math.max(1, Number(this.config.get('GST_VERIFY_BATCH_SIZE', '50')));
  }

  private get concurrency(): number {
    return Math.max(1, Number(this.config.get('GST_VERIFY_CONCURRENCY', '5')));
  }

  /**
   * Entry point: creates the parent job and dispatches it (RabbitMQ if enabled,
   * otherwise inline). Returns immediately; poll GET /gst/status/:jobId.
   */
  async startVerifyAndFetch(rawTableName?: string): Promise<Job> {
    if (!this.complianceModel) {
      throw new ServiceUnavailableException(
        'MongoDB is not enabled. Set ENABLE_MONGO=true and configure MONGO_URI to store GST compliance data.',
      );
    }

    const tableName = this.sanitizeTableName(rawTableName);

    const job = await this.gstService.createJob('API', {
      operation: 'GSTIN_VERIFY_AND_FETCH',
      sourceTable: tableName,
    });

    if (this.verifyParentClient) {
      this.verifyParentClient.emit('verify_parent', {
        jobId: job.id,
        tableName,
      });
    } else {
      void this.processVerifyParent(job.id, tableName);
    }

    return job;
  }

  /**
   * Parent/orchestrator: reads the source rows, splits them into batches,
   * persists one JobTask per batch and dispatches each batch.
   */
  async processVerifyParent(jobId: string, tableName: string): Promise<void> {
    try {
      await this.gstService.updateJobStatus(jobId, 'PROCESSING');

      const rows = await this.fetchSourceRows(tableName);
      const batches = this.chunk(rows, this.batchSize);

      await this.gstService.setJobTotalChunks(jobId, batches.length);

      if (batches.length === 0) {
        await this.gstService.finishJob(jobId, {
          totalRows: 0,
          verified: 0,
          stored: 0,
          skippedNoGstin: 0,
          skippedInvalidGstin: 0,
          skippedNoStatus: 0,
          failed: 0,
          note: 'No rows found in source table.',
        });
        return;
      }

      for (let i = 0; i < batches.length; i++) {
        const task = await this.gstService.createTask(jobId, {
          tableName,
          batchIndex: i,
          totalBatches: batches.length,
          rows: batches[i],
        });

        if (this.verifyChunkClient) {
          this.verifyChunkClient.emit('verify_chunk', {
            taskId: task.id,
            jobId,
            tableName,
            rows: batches[i],
          });
        } else {
          await this.processVerifyChunk(task.id, jobId, tableName, batches[i]);
        }
      }

      this.logger.log(
        `Dispatched ${batches.length} verify batches for Job ${jobId}`,
      );
    } catch (err) {
      await this.gstService.updateJobStatus(
        jobId,
        'FAILED',
        (err as Error).message,
      );
      this.logger.error(
        `verify-parent job ${jobId} failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Chunk worker: processes one batch of rows with bounded concurrency,
   * then atomically advances job progress and finalizes the job if last.
   */
  async processVerifyChunk(
    taskId: string,
    jobId: string,
    tableName: string,
    rows: SourceRow[],
  ): Promise<void> {
    await this.gstService.markTask(taskId, 'PROCESSING', { attempts: 1 });

    const result: BatchResult = {
      totalRows: rows.length,
      verified: 0,
      stored: 0,
      skippedNoGstin: 0,
      skippedInvalidGstin: 0,
      skippedNoStatus: 0,
      failed: 0,
    };

    try {
      await this.runWithConcurrency(rows, this.concurrency, async (row) => {
        await this.processRow(row, tableName, result);
      });

      await this.gstService.markTask(taskId, 'COMPLETED', { result });
    } catch (err) {
      await this.gstService.markTask(taskId, 'FAILED', {
        result,
        errorMessage: (err as Error).message,
      });
      this.logger.error(
        `verify-chunk task ${taskId} failed: ${(err as Error).message}`,
      );
    } finally {
      // Always advance progress so a failed batch doesn't stall the job.
      const { justCompleted } =
        await this.gstService.incrementCompletedChunks(jobId);
      if (justCompleted) {
        await this.finalizeJob(jobId);
      }
    }
  }

  /** Verify a single GSTIN, conditionally search, and persist. */
  private async processRow(
    row: SourceRow,
    tableName: string,
    result: BatchResult,
  ): Promise<void> {
    const gstin = (row.gst_no ?? '').trim().toUpperCase();
    if (!gstin) {
      result.skippedNoGstin++;
      return;
    }
    if (!this.isValidGstin(gstin)) {
      result.skippedInvalidGstin++;
      await this.markRowStatus(tableName, row.loan_id, 'INVALID_GSTIN');
      this.logger.warn(
        `Skipping invalid GSTIN for loanId=${row.loan_id}: ${gstin}`,
      );
      return;
    }

    try {
      const verify = await this.gstApiService.verifyGstin(gstin);
      const status = verify?.data?.data?.status;

      // Only continue to the search step when the verify response has a status.
      if (status === undefined || status === null || status === '') {
        result.skippedNoStatus++;
        await this.markRowStatus(tableName, row.loan_id, 'NO_STATUS');
        return;
      }
      result.verified++;

      const search = await this.gstApiService.searchGstin(gstin);

      // Idempotent upsert so retries/re-runs don't create duplicates.
      await this.complianceModel!.updateOne(
        { loanId: row.loan_id, gstin },
        {
          $set: {
            loanId: row.loan_id,
            gstin,
            pan: row.pan ?? verify?.data?.data?.pan ?? null,
            legalName: verify?.data?.data?.legalName ?? null,
            status,
            sourceTable: tableName,
            verifyResponse: verify,
            searchResponse: search,
          },
        },
        { upsert: true },
      );
      result.stored++;

      await this.markRowStatus(tableName, row.loan_id, 'FETCHED');
    } catch (err) {
      result.failed++;
      this.logger.error(
        `Failed verify/fetch for loanId=${row.loan_id} gstin=${gstin}: ${(err as Error).message}`,
      );
      await this.markRowStatus(tableName, row.loan_id, 'FAILED');
    }
  }

  // ==================== GSTR verify-and-track flow ====================

  /**
   * Entry point for the GSTR flow: verifies each GSTIN then tracks GSTR filing
   * status for the given financial year, storing results in a separate Mongo
   * collection. Returns the job immediately; poll GET /gst/status/:jobId.
   */
  async startVerifyAndFetchGstr(
    financialYear: string,
    rawTableName?: string,
  ): Promise<Job> {
    if (!this.gstrComplianceModel) {
      throw new ServiceUnavailableException(
        'MongoDB is not enabled. Set ENABLE_MONGO=true and configure MONGO_URI to store GSTR compliance data.',
      );
    }

    const fy = this.sanitizeFinancialYear(financialYear);
    const tableName = this.sanitizeTableName(rawTableName);

    const job = await this.gstService.createJob('API', {
      operation: 'GSTIN_VERIFY_AND_FETCH_GSTR',
      sourceTable: tableName,
      financialYear: fy,
    });

    if (this.verifyGstrParentClient) {
      this.verifyGstrParentClient.emit('verify_gstr_parent', {
        jobId: job.id,
        tableName,
        financialYear: fy,
      });
    } else {
      void this.processVerifyGstrParent(job.id, tableName, fy);
    }

    return job;
  }

  /**
   * Parent/orchestrator for the GSTR flow: reads source rows, splits into
   * batches, persists one JobTask per batch and dispatches each batch.
   */
  async processVerifyGstrParent(
    jobId: string,
    tableName: string,
    financialYear: string,
  ): Promise<void> {
    try {
      await this.gstService.updateJobStatus(jobId, 'PROCESSING');

      const rows = await this.fetchSourceRows(tableName);
      const batches = this.chunk(rows, this.batchSize);

      await this.gstService.setJobTotalChunks(jobId, batches.length);

      if (batches.length === 0) {
        await this.gstService.finishJob(jobId, {
          totalRows: 0,
          verified: 0,
          stored: 0,
          skippedNoGstin: 0,
          skippedInvalidGstin: 0,
          skippedNoStatus: 0,
          failed: 0,
          note: 'No rows found in source table.',
        });
        return;
      }

      for (let i = 0; i < batches.length; i++) {
        const task = await this.gstService.createTask(jobId, {
          tableName,
          financialYear,
          batchIndex: i,
          totalBatches: batches.length,
          rows: batches[i],
        });

        if (this.verifyGstrChunkClient) {
          this.verifyGstrChunkClient.emit('verify_gstr_chunk', {
            taskId: task.id,
            jobId,
            tableName,
            financialYear,
            rows: batches[i],
          });
        } else {
          await this.processVerifyGstrChunk(
            task.id,
            jobId,
            tableName,
            financialYear,
            batches[i],
          );
        }
      }

      this.logger.log(
        `Dispatched ${batches.length} GSTR verify batches for Job ${jobId}`,
      );
    } catch (err) {
      await this.gstService.updateJobStatus(
        jobId,
        'FAILED',
        (err as Error).message,
      );
      this.logger.error(
        `verify-gstr-parent job ${jobId} failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Chunk worker for the GSTR flow: processes one batch with bounded
   * concurrency, then atomically advances job progress and finalizes if last.
   */
  async processVerifyGstrChunk(
    taskId: string,
    jobId: string,
    tableName: string,
    financialYear: string,
    rows: SourceRow[],
  ): Promise<void> {
    await this.gstService.markTask(taskId, 'PROCESSING', { attempts: 1 });

    const result: BatchResult = {
      totalRows: rows.length,
      verified: 0,
      stored: 0,
      skippedNoGstin: 0,
      skippedInvalidGstin: 0,
      skippedNoStatus: 0,
      failed: 0,
    };

    try {
      await this.runWithConcurrency(rows, this.concurrency, async (row) => {
        await this.processGstrRow(row, tableName, financialYear, result);
      });

      await this.gstService.markTask(taskId, 'COMPLETED', { result });
    } catch (err) {
      await this.gstService.markTask(taskId, 'FAILED', {
        result,
        errorMessage: (err as Error).message,
      });
      this.logger.error(
        `verify-gstr-chunk task ${taskId} failed: ${(err as Error).message}`,
      );
    } finally {
      const { justCompleted } =
        await this.gstService.incrementCompletedChunks(jobId);
      if (justCompleted) {
        await this.finalizeJob(jobId);
      }
    }
  }

  /** Verify a single GSTIN, then track GSTR filings and persist. */
  private async processGstrRow(
    row: SourceRow,
    tableName: string,
    financialYear: string,
    result: BatchResult,
  ): Promise<void> {
    const gstin = (row.gst_no ?? '').trim().toUpperCase();
    if (!gstin) {
      result.skippedNoGstin++;
      return;
    }
    if (!this.isValidGstin(gstin)) {
      result.skippedInvalidGstin++;
      await this.markRowStatus(tableName, row.loan_id, 'INVALID_GSTIN');
      this.logger.warn(
        `Skipping invalid GSTIN for loanId=${row.loan_id}: ${gstin}`,
      );
      return;
    }

    try {
      const verify = await this.gstApiService.verifyGstin(gstin);
      const status = verify?.data?.data?.status;

      // Only continue to the GSTR-track step when verify returns a status.
      if (status === undefined || status === null || status === '') {
        result.skippedNoStatus++;
        await this.markRowStatus(tableName, row.loan_id, 'GSTR_NO_STATUS');
        return;
      }
      result.verified++;

      const gstr = await this.gstApiService.trackGstr(gstin, financialYear);

      // Idempotent upsert keyed on loan + GSTIN + financial year.
      await this.gstrComplianceModel!.updateOne(
        { loanId: row.loan_id, gstin, financialYear },
        {
          $set: {
            loanId: row.loan_id,
            gstin,
            pan: row.pan ?? verify?.data?.data?.pan ?? null,
            legalName: verify?.data?.data?.legalName ?? null,
            status,
            financialYear,
            sourceTable: tableName,
            verifyResponse: verify,
            gstrResponse: gstr,
          },
        },
        { upsert: true },
      );
      result.stored++;

      await this.markRowStatus(tableName, row.loan_id, 'GSTR_FETCHED');
    } catch (err) {
      result.failed++;
      this.logger.error(
        `Failed verify/track-gstr for loanId=${row.loan_id} gstin=${gstin}: ${(err as Error).message}`,
      );
      await this.markRowStatus(tableName, row.loan_id, 'GSTR_FAILED');
    }
  }

  // ================ GSTR-2B verify-and-reconcile flow ================

  /**
   * Entry point for the GSTR-2B flow: verifies each GSTIN then runs GSTR-2B
   * reconciliation for the given year/month, storing results in a separate
   * Mongo collection. Returns the job immediately; poll GET /gst/status/:jobId.
   */
  async startVerifyAndFetch2b(
    params: Gstr2bParams,
    rawTableName?: string,
  ): Promise<Job> {
    if (!this.gstr2bComplianceModel) {
      throw new ServiceUnavailableException(
        'MongoDB is not enabled. Set ENABLE_MONGO=true and configure MONGO_URI to store GSTR-2B compliance data.',
      );
    }

    const reconParams = this.sanitize2bParams(params);
    const tableName = this.sanitizeTableName(rawTableName);

    const job = await this.gstService.createJob('API', {
      operation: 'GSTIN_VERIFY_AND_FETCH_GSTR_2B',
      sourceTable: tableName,
      ...reconParams,
    });

    if (this.verify2bParentClient) {
      this.verify2bParentClient.emit('verify_2b_parent', {
        jobId: job.id,
        tableName,
        params: reconParams,
      });
    } else {
      void this.processVerify2bParent(job.id, tableName, reconParams);
    }

    return job;
  }

  /**
   * Parent/orchestrator for the GSTR-2B flow: reads source rows, splits into
   * batches, persists one JobTask per batch and dispatches each batch.
   */
  async processVerify2bParent(
    jobId: string,
    tableName: string,
    params: Gstr2bParams,
  ): Promise<void> {
    try {
      await this.gstService.updateJobStatus(jobId, 'PROCESSING');

      const rows = await this.fetchSourceRows(tableName);
      const batches = this.chunk(rows, this.batchSize);

      await this.gstService.setJobTotalChunks(jobId, batches.length);

      if (batches.length === 0) {
        await this.gstService.finishJob(jobId, {
          totalRows: 0,
          verified: 0,
          stored: 0,
          skippedNoGstin: 0,
          skippedInvalidGstin: 0,
          skippedNoStatus: 0,
          failed: 0,
          note: 'No rows found in source table.',
        });
        return;
      }

      for (let i = 0; i < batches.length; i++) {
        const task = await this.gstService.createTask(jobId, {
          tableName,
          params,
          batchIndex: i,
          totalBatches: batches.length,
          rows: batches[i],
        });

        if (this.verify2bChunkClient) {
          this.verify2bChunkClient.emit('verify_2b_chunk', {
            taskId: task.id,
            jobId,
            tableName,
            params,
            rows: batches[i],
          });
        } else {
          await this.processVerify2bChunk(
            task.id,
            jobId,
            tableName,
            params,
            batches[i],
          );
        }
      }

      this.logger.log(
        `Dispatched ${batches.length} GSTR-2B verify batches for Job ${jobId}`,
      );
    } catch (err) {
      await this.gstService.updateJobStatus(
        jobId,
        'FAILED',
        (err as Error).message,
      );
      this.logger.error(
        `verify-2b-parent job ${jobId} failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Chunk worker for the GSTR-2B flow: processes one batch with bounded
   * concurrency, then atomically advances job progress and finalizes if last.
   */
  async processVerify2bChunk(
    taskId: string,
    jobId: string,
    tableName: string,
    params: Gstr2bParams,
    rows: SourceRow[],
  ): Promise<void> {
    await this.gstService.markTask(taskId, 'PROCESSING', { attempts: 1 });

    const result: BatchResult = {
      totalRows: rows.length,
      verified: 0,
      stored: 0,
      skippedNoGstin: 0,
      skippedInvalidGstin: 0,
      skippedNoStatus: 0,
      failed: 0,
    };

    try {
      await this.runWithConcurrency(rows, this.concurrency, async (row) => {
        await this.processGstr2bRow(row, tableName, params, result);
      });

      await this.gstService.markTask(taskId, 'COMPLETED', { result });
    } catch (err) {
      await this.gstService.markTask(taskId, 'FAILED', {
        result,
        errorMessage: (err as Error).message,
      });
      this.logger.error(
        `verify-2b-chunk task ${taskId} failed: ${(err as Error).message}`,
      );
    } finally {
      const { justCompleted } =
        await this.gstService.incrementCompletedChunks(jobId);
      if (justCompleted) {
        await this.finalizeJob(jobId);
      }
    }
  }

  /** Verify a single GSTIN, then run GSTR-2B reconciliation and persist. */
  private async processGstr2bRow(
    row: SourceRow,
    tableName: string,
    params: Gstr2bParams,
    result: BatchResult,
  ): Promise<void> {
    const gstin = (row.gst_no ?? '').trim().toUpperCase();
    if (!gstin) {
      result.skippedNoGstin++;
      return;
    }
    if (!this.isValidGstin(gstin)) {
      result.skippedInvalidGstin++;
      await this.markRowStatus(tableName, row.loan_id, 'INVALID_GSTIN');
      this.logger.warn(
        `Skipping invalid GSTIN for loanId=${row.loan_id}: ${gstin}`,
      );
      return;
    }

    try {
      const verify = await this.gstApiService.verifyGstin(gstin);
      const status = verify?.data?.data?.status;

      // Only continue to the reconciliation step when verify returns a status.
      if (status === undefined || status === null || status === '') {
        result.skippedNoStatus++;
        await this.markRowStatus(tableName, row.loan_id, 'GST_2B_NO_STATUS');
        return;
      }
      result.verified++;

      const recon = await this.gstApiService.reconcileGstr2b(gstin, params);

      // Idempotent upsert keyed on loan + GSTIN + year + month.
      await this.gstr2bComplianceModel!.updateOne(
        { loanId: row.loan_id, gstin, year: params.year, month: params.month },
        {
          $set: {
            loanId: row.loan_id,
            gstin,
            pan: row.pan ?? verify?.data?.data?.pan ?? null,
            legalName: verify?.data?.data?.legalName ?? null,
            status,
            year: params.year,
            month: params.month,
            filingPreference: params.filingPreference,
            reconciliationCriteria: params.reconciliationCriteria,
            sourceTable: tableName,
            verifyResponse: verify,
            reconciliationResponse: recon,
          },
        },
        { upsert: true },
      );
      result.stored++;

      await this.markRowStatus(tableName, row.loan_id, 'GST_2B_FETCHED');
    } catch (err) {
      result.failed++;
      this.logger.error(
        `Failed verify/reconcile-2b for loanId=${row.loan_id} gstin=${gstin}: ${(err as Error).message}`,
      );
      await this.markRowStatus(tableName, row.loan_id, 'GST_2B_FAILED');
    }
  }

  /** Aggregate per-batch results into a final job summary. */
  private async finalizeJob(jobId: string): Promise<void> {
    const tasks = await this.gstService.getJobTasks(jobId);
    const summary: BatchResult = {
      totalRows: 0,
      verified: 0,
      stored: 0,
      skippedNoGstin: 0,
      skippedInvalidGstin: 0,
      skippedNoStatus: 0,
      failed: 0,
    };

    for (const task of tasks) {
      const r = task.payload?.result as BatchResult | undefined;
      if (!r) continue;
      summary.totalRows += r.totalRows ?? 0;
      summary.verified += r.verified ?? 0;
      summary.stored += r.stored ?? 0;
      summary.skippedNoGstin += r.skippedNoGstin ?? 0;
      summary.skippedInvalidGstin += r.skippedInvalidGstin ?? 0;
      summary.skippedNoStatus += r.skippedNoStatus ?? 0;
      summary.failed += r.failed ?? 0;
    }

    await this.gstService.finishJob(jobId, summary);
  }

  /**
   * Best-effort update of the source row's processing status. The columns
   * `status` / `last_data_pull_date` exist on the standard upload table; if a
   * custom table lacks them we just log and continue.
   */
  private async markRowStatus(
    tableName: string,
    loanId: string,
    status: string,
  ): Promise<void> {
    try {
      await this.dataSource.query(
        `UPDATE "${tableName}" SET status = $1, last_data_pull_date = NOW() WHERE loan_id = $2`,
        [status, loanId],
      );
    } catch (err) {
      this.logger.debug(
        `Could not update source row status (${tableName}.loan_id=${loanId}): ${(err as Error).message}`,
      );
    }
  }

  private async fetchSourceRows(tableName: string): Promise<SourceRow[]> {
    return this.dataSource.query(
      `SELECT loan_id, gst_no, pan FROM "${tableName}"`,
    );
  }

  private isValidGstin(gstin: string): boolean {
    return GSTIN_PATTERN.test(gstin);
  }

  /** Simple bounded-concurrency pool (no external dependency). */
  private async runWithConcurrency<T>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<void>,
  ): Promise<void> {
    let index = 0;
    const size = Math.min(limit, items.length);
    const runners = Array.from({ length: size }, async () => {
      while (true) {
        const current = index++;
        if (current >= items.length) break;
        await worker(items[current]);
      }
    });
    await Promise.all(runners);
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      out.push(items.slice(i, i + size));
    }
    return out;
  }

  private sanitizeTableName(rawTableName?: string): string {
    const name = (rawTableName ?? '').trim() || DEFAULT_SOURCE_TABLE;
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
      throw new BadRequestException(
        `Invalid table name "${name}". Use lowercase letters, numbers and underscores only.`,
      );
    }
    return name;
  }

  /** Validates the financial year (expects format like "2023-24"). */
  private sanitizeFinancialYear(financialYear?: string): string {
    const fy = (financialYear ?? '').trim();
    if (!fy) {
      throw new BadRequestException(
        '"financial_year" query parameter is required (e.g. 2023-24).',
      );
    }
    if (!/^\d{4}-\d{2}$/.test(fy)) {
      throw new BadRequestException(
        `Invalid financial_year "${fy}". Expected format "YYYY-YY" (e.g. 2023-24).`,
      );
    }
    return fy;
  }

  /** Validates/normalizes the GSTR-2B reconciliation request parameters. */
  private sanitize2bParams(params: Gstr2bParams): Gstr2bParams {
    const year = Number(params?.year);
    const month = Number(params?.month);

    if (!Number.isInteger(year) || year < 2017 || year > 2100) {
      throw new BadRequestException(
        `Invalid "year" "${params?.year}". Expected a 4-digit year (e.g. 2023).`,
      );
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new BadRequestException(
        `Invalid "month" "${params?.month}". Expected a number between 1 and 12.`,
      );
    }

    const filingPreference = (params?.filingPreference ?? '').trim() || 'monthly';
    const reconciliationCriteria =
      (params?.reconciliationCriteria ?? '').trim() || 'strict';

    return { year, month, filingPreference, reconciliationCriteria };
  }
}
