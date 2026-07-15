import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
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
import { GstAggregationService } from './gst-aggregation.service';
import { GstComplianceRecord } from '../schemas/gst-compliance.schema';
import { GstTaxpayerReturnsService } from './gst-taxpayer-returns.service';
import { Gstr2bComplianceRecord } from '../schemas/gst-gstr2b-compliance.schema';
import { Gstr3bComplianceRecord } from '../schemas/gst-gstr3b-compliance.schema';

type GstEntityType = 'PRIMARY' | 'CONSIDERED_ENTITY';

interface SourceRow {
  loan_id: string;
  customer_id: string | null;
  gst_no: string | null;
  pan: string | null;
  entity_type: GstEntityType;
}

type GstrReturnType = 'GSTR-1' | 'GSTR-1A' | 'GSTR-2B' | 'GSTR-3B';

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
const VERIFY_FETCH_OPERATION = 'GSTIN_VERIFY_AND_FETCH';
/* DISABLED: GSTR-1 / GSTR-1A
const VERIFY_GSTR_OPERATION = 'GSTIN_VERIFY_AND_FETCH_GSTR';
const VERIFY_1A_OPERATION = 'GSTIN_VERIFY_AND_FETCH_GSTR_1A';
*/
const VERIFY_2B_OPERATION = 'GSTIN_VERIFY_AND_FETCH_GSTR_2B';
const VERIFY_3B_OPERATION = 'GSTIN_VERIFY_AND_FETCH_GSTR_3B';

@Injectable()
export class GstComplianceService {
  private readonly logger = new Logger(GstComplianceService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly gstService: GstService,
    private readonly gstApiService: GstApiService,
    private readonly gstTaxpayerReturnsService: GstTaxpayerReturnsService,
    private readonly gstAggregationService: GstAggregationService,
    private readonly config: ConfigService,
    @Optional()
    @InjectModel(GstComplianceRecord.name)
    private readonly complianceModel?: Model<GstComplianceRecord>,
    @Optional()
    @InjectModel(Gstr2bComplianceRecord.name)
    private readonly gstr2bComplianceModel?: Model<Gstr2bComplianceRecord>,
    @Optional()
    @InjectModel(Gstr3bComplianceRecord.name)
    private readonly gstr3bComplianceModel?: Model<Gstr3bComplianceRecord>,
    @Optional()
    @Inject('VERIFY_PARENT_SERVICE')
    private readonly verifyParentClient?: ClientProxy,
    @Optional()
    @Inject('VERIFY_CHUNK_SERVICE')
    private readonly verifyChunkClient?: ClientProxy,
  ) {}

  private get batchSize(): number {
    return Math.max(1, Number(this.config.get('GST_VERIFY_BATCH_SIZE', '50')));
  }

  private get concurrency(): number {
    return Math.max(1, Number(this.config.get('GST_VERIFY_CONCURRENCY', '5')));
  }

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

  async startGstr1VerifyAndFetch(
    _year: number,
    _month: number,
    _rawTableName?: string,
    _username?: string,
  ): Promise<Job> {
    /* DISABLED: GSTR-1
    return this.startReturnVerifyAndFetch(
      'GSTR-1',
      VERIFY_GSTR_OPERATION,
      year,
      month,
      rawTableName,
      username,
    );
    */
    throw new ServiceUnavailableException(
      'GSTR-1 / GSTR-1A temporarily disabled.',
    );
  }

  async startGstr1aVerifyAndFetch(
    _year: number,
    _month: number,
    _rawTableName?: string,
    _username?: string,
  ): Promise<Job> {
    /* DISABLED: GSTR-1A
    return this.startReturnVerifyAndFetch(
      'GSTR-1A',
      VERIFY_1A_OPERATION,
      year,
      month,
      rawTableName,
      username,
    );
    */
    throw new ServiceUnavailableException(
      'GSTR-1 / GSTR-1A temporarily disabled.',
    );
  }

  async startGstr2bVerifyAndFetch(
    year: number,
    month: number,
    rawTableName?: string,
    username?: string,
  ): Promise<Job> {
    return this.startReturnVerifyAndFetch(
      'GSTR-2B',
      VERIFY_2B_OPERATION,
      year,
      month,
      rawTableName,
      username,
    );
  }

  async startGstr3bVerifyAndFetch(
    year: number,
    month: number,
    rawTableName?: string,
    username?: string,
  ): Promise<Job> {
    return this.startReturnVerifyAndFetch(
      'GSTR-3B',
      VERIFY_3B_OPERATION,
      year,
      month,
      rawTableName,
      username,
    );
  }

  /**
   * Track filing status job entrypoint (public Sandbox track API).
   * Full Mongo track pipeline is enabled when gst_return_filing_track support
   * is present; until then this returns a clear unavailable error.
   */
  async startGstrTrackVerifyAndFetch(
    _financialYear: string,
    _rawTableName?: string,
  ): Promise<Job> {
    throw new ServiceUnavailableException(
      'GSTR track verify-and-fetch is not configured in this deployment build. Use verify-and-fetch / GSTR-1/2B/3B endpoints.',
    );
  }

  async processVerifyParent(jobId: string, tableName: string): Promise<void> {
    try {
      await this.gstService.updateJobStatus(jobId, 'PROCESSING');
      const job = await this.gstService.getJobStatus(jobId);
      const operation = String(job?.metadata?.operation ?? '').trim();

      const allRows = await this.fetchSourceRows(tableName);
      const { pending: rows, skippedExisting } =
        operation === VERIFY_FETCH_OPERATION
          ? await this.partitionUnprocessedRows(allRows, this.complianceModel!)
          : { pending: allRows, skippedExisting: 0 };

      await this.gstService.mergeJobMetadata(jobId, {
        totalSourceRows: allRows.length,
        skippedAlreadyExists: skippedExisting,
      });

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
          note:
            skippedExisting > 0
              ? 'All rows already present in MongoDB; nothing to fetch.'
              : 'No rows found in source table.',
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

      this.logger.log(`Dispatched ${batches.length} verify batches for Job ${jobId}`);
    } catch (err) {
      await this.gstService.updateJobStatus(jobId, 'FAILED', (err as Error).message);
      this.logger.error(
        `verify-parent job ${jobId} failed: ${(err as Error).message}`,
      );
    }
  }

  async processVerifyChunk(
    taskId: string,
    jobId: string,
    tableName: string,
    rows: SourceRow[],
  ): Promise<void> {
    await this.gstService.markTask(taskId, 'PROCESSING', { attempts: 1 });
    const job = await this.gstService.getJobStatus(jobId);
    const operation = String(job?.metadata?.operation ?? '').trim();
    const returnType = String(job?.metadata?.returnType ?? '').trim() as
      | GstrReturnType
      | '';
    const year = Number(job?.metadata?.year);
    const month = Number(job?.metadata?.month);
    const username = String(job?.metadata?.username ?? '').trim();

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
        if (operation === VERIFY_FETCH_OPERATION) {
          await this.processRow(row, tableName, result);
          return;
        }
        await this.processReturnRow(
          row,
          tableName,
          result,
          returnType,
          year,
          month,
          username,
        );
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
      const { justCompleted } =
        await this.gstService.incrementCompletedChunks(jobId);
      if (justCompleted) {
        await this.finalizeJob(jobId);
        void this.maybeTriggerAggregation(jobId);
      }
    }
  }

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
      if (status === undefined || status === null || status === '') {
        result.skippedNoStatus++;
        await this.markRowStatus(tableName, row.loan_id, 'NO_STATUS');
        return;
      }
      result.verified++;

      const search = await this.gstApiService.searchGstin(gstin);

      await this.complianceModel!.updateOne(
        { loanId: row.loan_id, gstin },
        {
          $set: {
            loanId: row.loan_id,
            customerId: row.customer_id ?? null,
            entityType: row.entity_type,
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

  private async processReturnRow(
    row: SourceRow,
    tableName: string,
    result: BatchResult,
    returnType: GstrReturnType | '',
    year: number,
    month: number,
    usernameFromJob: string,
  ): Promise<void> {
    if (!returnType) {
      result.failed++;
      return;
    }
    if (!Number.isInteger(year) || !Number.isInteger(month)) {
      result.failed++;
      return;
    }

    const gstin = (row.gst_no ?? '').trim().toUpperCase();
    if (!gstin) {
      result.skippedNoGstin++;
      return;
    }
    if (!this.isValidGstin(gstin)) {
      result.skippedInvalidGstin++;
      await this.markRowStatus(tableName, row.loan_id, 'INVALID_GSTIN');
      return;
    }

    const username = usernameFromJob || gstin;
    try {
      let response: Record<string, any>;
      const tracking = {
        associatedLoanId: row.loan_id,
        customerId: row.customer_id ?? null,
        dataSource: 'sandbox',
        sourceTable: tableName,
        skipAutoAggregationTrigger: true,
      };

      if (returnType === 'GSTR-1' || returnType === 'GSTR-1A') {
        /* DISABLED: GSTR-1 / GSTR-1A fetch branches
        if (returnType === 'GSTR-1') {
          response = await this.gstTaxpayerReturnsService.fetchGstr1(...);
        } else if (returnType === 'GSTR-1A') {
          response = await this.gstTaxpayerReturnsService.fetchGstr1a(...);
        }
        */
        result.failed++;
        this.logger.warn(
          `Skipping disabled ${returnType} for loanId=${row.loan_id} gstin=${gstin}`,
        );
        await this.markRowStatus(tableName, row.loan_id, 'FAILED');
        return;
      } else if (returnType === 'GSTR-2B') {
        response = await this.gstTaxpayerReturnsService.fetchGstr2b(
          { username, gstin },
          year,
          month,
          tracking,
        );
      } else {
        response = await this.gstTaxpayerReturnsService.fetchGstr3b(
          { username, gstin },
          year,
          month,
          tracking,
        );
      }

      await this.persistReturnResponse(
        returnType,
        row,
        tableName,
        year,
        month,
        username,
        response.data ?? {},
      );
      result.verified++;
      result.stored++;
      await this.markRowStatus(tableName, row.loan_id, 'FETCHED');
    } catch (err) {
      result.failed++;
      this.logger.error(
        `Failed ${returnType} fetch for loanId=${row.loan_id} gstin=${gstin}: ${(err as Error).message}`,
      );
      await this.markRowStatus(tableName, row.loan_id, 'FAILED');
    }
  }

  private async persistReturnResponse(
    returnType: GstrReturnType,
    row: SourceRow,
    tableName: string,
    year: number,
    month: number,
    username: string,
    payload: Record<string, any>,
  ): Promise<void> {
    const customerId = row.customer_id ?? null;
    const gstin = (row.gst_no ?? '').trim().toUpperCase();
    const pan = (row.pan ?? '').trim().toUpperCase() || gstin.substring(2, 12);
    const legalName = String(payload?.data?.data?.lgnm ?? payload?.data?.lgnm ?? '');
    const status = String(
      payload?.data?.data?.status ??
        payload?.data?.data?.sts ??
        payload?.data?.status ??
        'FETCHED',
    );

    /* DISABLED: GSTR-1 Mongo persist
    if (returnType === 'GSTR-1') {
      return;
    }
    */

    if (returnType === 'GSTR-2B' && this.gstr2bComplianceModel) {
      await this.gstr2bComplianceModel.updateOne(
        { loanId: row.loan_id, gstin, year, month },
        {
          $set: {
            loanId: row.loan_id,
            customerId,
            entityType: row.entity_type,
            gstin,
            gstNo: gstin,
            pan,
            year,
            month,
            sourceTable: tableName,
            legalName,
            status,
            gstr2bResponse: payload,
            systemMetadata: {
              fetchedAt: new Date().toISOString(),
              username,
            },
          },
        },
        { upsert: true },
      );
      return;
    }

    if (returnType === 'GSTR-3B' && this.gstr3bComplianceModel) {
      await this.gstr3bComplianceModel.updateOne(
        { loanId: row.loan_id, gstin, year, month },
        {
          $set: {
            loanId: row.loan_id,
            customerId,
            entityType: row.entity_type,
            gstin,
            gstNo: gstin,
            pan,
            year,
            month,
            sourceTable: tableName,
            legalName,
            status,
            gstr3bResponse: payload,
            systemMetadata: {
              fetchedAt: new Date().toISOString(),
              username,
            },
          },
        },
        { upsert: true },
      );
      return;
    }

    /* DISABLED: GSTR-1A Mongo persist
    if (returnType === 'GSTR-1A') {
      // nothing persisted
    }
    */
  }

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

  private async maybeTriggerAggregation(jobId: string): Promise<void> {
    try {
      const job = await this.gstService.getJobStatus(jobId);
      const operation = String(job?.metadata?.operation ?? '').trim();

      if (operation === VERIFY_FETCH_OPERATION) {
        await this.gstAggregationService.triggerAfterVerifyFetchJob(jobId);
        return;
      }
      /* DISABLED: GSTR-1 aggregation trigger
      if (operation === VERIFY_GSTR_OPERATION) {
        await this.gstAggregationService.triggerAfterGstrJob(jobId);
        return;
      }
      */
      if (operation === VERIFY_2B_OPERATION) {
        await this.gstAggregationService.triggerAfterGstr2bJob(jobId);
        return;
      }
      if (operation === VERIFY_3B_OPERATION) {
        await this.gstAggregationService.triggerAfterGstr3bJob(jobId);
      }
    } catch (err) {
      this.logger.error(
        `Aggregation trigger failed for job ${jobId}: ${(err as Error).message}`,
      );
    }
  }

  private async markRowStatus(
    tableName: string,
    loanId: string,
    status: string,
  ): Promise<void> {
    try {
      await this.dataSource.query(
        `UPDATE "${tableName}" SET status = $1, last_data_pull_date = NOW() WHERE associated_loan_id = $2`,
        [status, loanId],
      );
    } catch (err) {
      this.logger.debug(
        `Could not update source row status (${tableName}.loan_id=${loanId}): ${(err as Error).message}`,
      );
    }
  }

  private async fetchSourceRows(tableName: string): Promise<SourceRow[]> {
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
         FROM "${tableName}"`,
    );

    const rows: SourceRow[] = [];
    for (const r of dbRows) {
      const loanId = (r.associated_loan_id ?? '').trim();
      const customerId = r.customer_id ?? null;

      if ((r.primary_gst_no ?? '').trim()) {
        rows.push({
          loan_id: loanId,
          customer_id: customerId,
          gst_no: r.primary_gst_no,
          pan: r.primary_pan ?? null,
          entity_type: 'PRIMARY',
        });
      }

      if ((r.considered_entity_gst_no ?? '').trim()) {
        rows.push({
          loan_id: loanId,
          customer_id: customerId,
          gst_no: r.considered_entity_gst_no,
          pan: r.considered_entity_pan ?? null,
          entity_type: 'CONSIDERED_ENTITY',
        });
      }
    }

    return rows;
  }

  private async partitionUnprocessedRows(
    rows: SourceRow[],
    model: Model<any>,
  ): Promise<{ pending: SourceRow[]; skippedExisting: number }> {
    const candidates = rows.filter((r) => (r.gst_no ?? '').trim());
    if (candidates.length === 0) {
      return { pending: rows, skippedExisting: 0 };
    }

    const loanIds = Array.from(new Set(candidates.map((r) => r.loan_id)));
    const existing = (await model
      .find({ loanId: { $in: loanIds } })
      .select('loanId gstin')
      .lean()
      .exec()) as Array<{ loanId: string; gstin: string }>;

    const existingSet = new Set<string>(
      existing.map((d) => `${d.loanId}||${d.gstin}`),
    );

    let skippedExisting = 0;
    const pending = rows.filter((r) => {
      const gstin = (r.gst_no ?? '').trim().toUpperCase();
      if (!gstin) return true;
      const alreadyStored = existingSet.has(`${r.loan_id}||${gstin}`);
      if (alreadyStored) skippedExisting++;
      return !alreadyStored;
    });

    return { pending, skippedExisting };
  }

  private isValidGstin(gstin: string): boolean {
    return GSTIN_PATTERN.test(gstin);
  }

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

  private async startReturnVerifyAndFetch(
    returnType: GstrReturnType,
    operation: string,
    year: number,
    month: number,
    rawTableName?: string,
    username?: string,
  ): Promise<Job> {
    if (!this.complianceModel) {
      throw new ServiceUnavailableException(
        'MongoDB is not enabled. Set ENABLE_MONGO=true and configure MONGO_URI to store GST compliance data.',
      );
    }

    const tableName = this.sanitizeTableName(rawTableName);
    const yearNum = Number(year);
    const monthNum = Number(month);
    if (!Number.isInteger(yearNum) || yearNum < 2017 || yearNum > 2100) {
      throw new BadRequestException(
        `Invalid "year" "${year}". Expected a 4-digit year (e.g. 2024).`,
      );
    }
    if (!Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12) {
      throw new BadRequestException(
        `Invalid "month" "${month}". Expected a number between 1 and 12.`,
      );
    }

    const normalizedUsername = String(username ?? '').trim() || null;
    const job = await this.gstService.createJob('API', {
      operation,
      sourceTable: tableName,
      returnType,
      year: yearNum,
      month: monthNum,
      username: normalizedUsername,
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
}
