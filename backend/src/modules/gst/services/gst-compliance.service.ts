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

type GstEntityType = 'PRIMARY' | 'CONSIDERED_ENTITY';

interface SourceRow {
  loan_id: string;
  customer_id: string | null;
  gst_no: string | null;
  pan: string | null;
  entity_type: GstEntityType;
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
    private readonly gstAggregationService: GstAggregationService,
    private readonly config: ConfigService,
    @Optional()
    @InjectModel(GstComplianceRecord.name)
    private readonly complianceModel?: Model<GstComplianceRecord>,
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

  async processVerifyParent(jobId: string, tableName: string): Promise<void> {
    try {
      await this.gstService.updateJobStatus(jobId, 'PROCESSING');

      const allRows = await this.fetchSourceRows(tableName);
      const { pending: rows, skippedExisting } =
        await this.partitionUnprocessedRows(allRows, this.complianceModel!);

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
      const { justCompleted } =
        await this.gstService.incrementCompletedChunks(jobId);
      if (justCompleted) {
        await this.finalizeJob(jobId);
        void this.maybeTriggerComplianceAggregation(jobId);
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

  private async maybeTriggerComplianceAggregation(jobId: string): Promise<void> {
    try {
      await this.gstAggregationService.triggerAfterVerifyFetchJob(jobId);
    } catch (err) {
      this.logger.error(
        `Compliance aggregation trigger failed for job ${jobId}: ${(err as Error).message}`,
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
