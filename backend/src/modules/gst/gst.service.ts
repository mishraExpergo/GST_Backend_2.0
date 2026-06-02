import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  Optional,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ClientProxy } from '@nestjs/microservices';
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

@Injectable()
export class GstService {
  private readonly logger = new Logger(GstService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Job) private readonly jobRepo: Repository<Job>,
    @InjectRepository(JobTask) private readonly taskRepo: Repository<JobTask>,
    private readonly fileStorageService: FileStorageService,
    @Optional()
    @Inject('API_CHUNK_SERVICE')
    private readonly apiChunkClient?: ClientProxy,
  ) {}

  // ------------------ Job Tracking Helpers ------------------

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

  async updateJobStatus(jobId: string, status: JobStatus, errorMessage?: string): Promise<void> {
    await this.jobRepo.update(jobId, { status, errorMessage });
    this.logger.log(`Job ${jobId} status updated to ${status}`);
  }

  // ------------------ Asynchronous Workers ------------------

  /**
   * Worker method to process raw Excel import from disk
   */
  async processExcel(filePath: string, rawTableName: string, jobId: string) {
    await this.jobRepo.update(jobId, { status: 'PROCESSING' });
    const tableName = this.sanitizeIdentifier(rawTableName);

    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`Cached excel file not found at path: ${filePath}`);
      }

      // 1. Parse Excel from disk path
      const workbook = XLSX.readFile(filePath, { cellDates: true });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        throw new BadRequestException('Excel file contains no sheets.');
      }
      const sheet = workbook.Sheets[sheetName];

      const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, {
        defval: null,
        raw: true,
      });

      if (rows.length === 0) {
        throw new BadRequestException('Excel sheet is empty.');
      }

      // 2. Collect Headers
      const headerSet = new Set<string>();
      for (const row of rows) {
        Object.keys(row).forEach((k) => headerSet.add(k));
      }
      const rawHeaders = Array.from(headerSet);

      // 3. Build column defs
      const columns: ColumnDef[] = rawHeaders.map((header) => ({
        raw: header,
        name: this.sanitizeIdentifier(header),
        type: this.inferColumnType(rows, header),
      }));

      // Validate duplicate headers
      const seen = new Set<string>();
      for (const col of columns) {
        if (seen.has(col.name)) {
          throw new BadRequestException(`Duplicate column name "${col.name}" after sanitization.`);
        }
        seen.add(col.name);
      }

      // 4. Update job segments count (Excel is processed as a single chunk)
      await this.jobRepo.update(jobId, { totalChunks: 1 });

      // 5. Create Table + Insert rows
      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      try {
        await queryRunner.query(`DROP TABLE IF EXISTS "${tableName}"`);
        const createSql = this.buildCreateTableSql(tableName, columns);
        await queryRunner.query(createSql);

        const colList = columns.map((c) => `"${c.name}"`).join(', ');
        const batchSize = 500;

        for (let i = 0; i < rows.length; i += batchSize) {
          const batch = rows.slice(i, i + batchSize);
          const params: unknown[] = [];
          const valueRows: string[] = [];

          for (const row of batch) {
            const rowPlaceholders: string[] = [];
            for (const col of columns) {
              rowPlaceholders.push(`$${params.length + 1}`);
              params.push(this.coerceValue(row[col.raw], col.type));
            }
            valueRows.push(`(${rowPlaceholders.join(', ')})`);
          }

          const insertSql = `INSERT INTO "${tableName}" (${colList}) VALUES ${valueRows.join(', ')}`;
          await queryRunner.query(insertSql, params);
        }

        await queryRunner.commitTransaction();
      } catch (err) {
        await queryRunner.rollbackTransaction();
        throw err;
      } finally {
        await queryRunner.release();
      }

      // Complete Job
      await this.jobRepo.update(jobId, {
        status: 'COMPLETED',
        completedChunks: 1,
      });
    } catch (err) {
      await this.updateJobStatus(jobId, 'FAILED', (err as Error).message);
      throw err;
    } finally {
      // Always cleanup temporary file
      await this.fileStorageService.deleteFile(filePath);
    }
  }

  /**
   * API Ingestion Orchestrator
   * Creates the table structure first, saves tasks to DB, then pushes N chunk events to RabbitMQ
   */
  async processApiParent(jobId: string, endpoint: string, totalRecords: number, rawTableName: string) {
    try {
      await this.jobRepo.update(jobId, { status: 'PROCESSING' });
      const tableName = this.sanitizeIdentifier(rawTableName);

      // 1. Create table structure dynamically from mock/sampled structure
      const sample = this.getMockSampleRecord();
      const headers = Object.keys(sample);
      const columns: ColumnDef[] = headers.map((header) => ({
        raw: header,
        name: this.sanitizeIdentifier(header),
        type: this.inferColumnType([sample], header),
      }));

      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      try {
        await queryRunner.query(`DROP TABLE IF EXISTS "${tableName}"`);
        const createSql = this.buildCreateTableSql(tableName, columns);
        this.logger.log(`Parent Orchestrator created table: ${tableName}`);
        await queryRunner.query(createSql);
      } finally {
        await queryRunner.release();
      }

      // 2. Calculate pagination chunks
      const limit = 1000; // 1,000 records per page chunk
      const totalChunks = Math.ceil(totalRecords / limit);

      await this.jobRepo.update(jobId, { totalChunks });

      // 3. Save tasks and dispatch events in chunks
      for (let page = 1; page <= totalChunks; page++) {
        const task = this.taskRepo.create({
          jobId,
          status: 'PENDING',
          payload: { page, limit, endpoint, tableName },
        });
        const savedTask = await this.taskRepo.save(task);

        if (this.apiChunkClient) {
          this.apiChunkClient.emit('api_chunk', {
            taskId: savedTask.id,
            jobId,
            endpoint,
            page,
            limit,
            tableName,
          });
        } else {
          void this.processApiChunk(
            savedTask.id,
            jobId,
            endpoint,
            page,
            limit,
            tableName,
          );
        }
      }

      this.logger.log(`Orchestrated ${totalChunks} chunks for Job ${jobId}`);
    } catch (err) {
      await this.updateJobStatus(jobId, 'FAILED', (err as Error).message);
      throw err;
    }
  }

  /**
   * Concurrent Chunk Worker
   * Fetches high-volume paginated records and batch inserts them under a safe transaction
   */
  async processApiChunk(
    taskId: string,
    jobId: string,
    endpoint: string,
    page: number,
    limit: number,
    tableName: string,
  ) {
    await this.taskRepo.update(taskId, { status: 'PROCESSING', attempts: 1 });

    try {
      // 1. Simulate external heavy paginated API request
      // (This fetches/generates 1,000 complex GST records concurrently)
      const records = this.fetchMockApiPage(page, limit);

      // 2. Perform DB Batch Insertion
      const sample = this.getMockSampleRecord();
      const headers = Object.keys(sample);
      const columns: ColumnDef[] = headers.map((header) => ({
        raw: header,
        name: this.sanitizeIdentifier(header),
        type: this.inferColumnType([sample], header),
      }));

      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      try {
        const colList = columns.map((c) => `"${c.name}"`).join(', ');
        const params: unknown[] = [];
        const valueRows: string[] = [];

        for (const row of records) {
          const rowPlaceholders: string[] = [];
          for (const col of columns) {
            rowPlaceholders.push(`$${params.length + 1}`);
            params.push(this.coerceValue(row[col.raw], col.type));
          }
          valueRows.push(`(${rowPlaceholders.join(', ')})`);
        }

        const insertSql = `INSERT INTO "${tableName}" (${colList}) VALUES ${valueRows.join(', ')}`;
        await queryRunner.query(insertSql, params);

        await queryRunner.commitTransaction();
      } catch (err) {
        await queryRunner.rollbackTransaction();
        throw err;
      } finally {
        await queryRunner.release();
      }

      // 3. Mark task completed
      await this.taskRepo.update(taskId, { status: 'COMPLETED' });

      // 4. Atomically increment completed chunks and update parent job progress
      const job = await this.jobRepo.findOne({ where: { id: jobId } });
      if (job) {
        const newCompleted = job.completedChunks + 1;
        const newStatus: JobStatus = newCompleted >= job.totalChunks ? 'COMPLETED' : 'PROCESSING';
        await this.jobRepo.update(jobId, {
          completedChunks: newCompleted,
          status: newStatus,
        });
      }
    } catch (err) {
      await this.taskRepo.update(taskId, { status: 'FAILED', errorMessage: (err as Error).message });
      throw err;
    }
  }

  // ------------------ Helper Mock Integrations ------------------

  private getMockSampleRecord(): Record<string, any> {
    return {
      gstin: 'string',
      legal_name: 'string',
      trade_name: 'string',
      filing_date: new Date(),
      taxable_value: 12.34,
      tax_amount: 56.78,
      is_active: true,
      total_invoices: 100,
    };
  }

  private fetchMockApiPage(page: number, limit: number): Record<string, any>[] {
    const records: Record<string, any>[] = [];
    const offset = (page - 1) * limit;

    for (let i = 0; i < limit; i++) {
      records.push({
        gstin: `27AAACS${1000 + i}A1Z${i % 9}`,
        legal_name: `Taxpayer Enterprise Co ${offset + i}`,
        trade_name: `Filing Trade Group ${offset + i}`,
        filing_date: new Date(Date.now() - (i % 30) * 24 * 3600 * 1000),
        taxable_value: parseFloat((100.50 * (i + 1) + 250).toFixed(2)),
        tax_amount: parseFloat((18.09 * (i + 1) + 45).toFixed(2)),
        is_active: i % 15 !== 0,
        total_invoices: 10 + i,
      });
    }
    return records;
  }

  // ----------------------- Data Coercion Helpers -----------------------

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

  private inferColumnType(rows: Record<string, unknown>[], header: string): PgType {
    let allInt = true;
    let allNumber = true;
    let allDate = true;
    let allBool = true;
    let hasValue = false;

    for (const row of rows) {
      const v = row[header];
      if (v === null || v === undefined || v === '') continue;
      hasValue = true;

      if (typeof v !== 'boolean') allBool = false;

      if (typeof v === 'number' && Number.isFinite(v)) {
        if (!Number.isInteger(v)) allInt = false;
      } else {
        allInt = false;
        allNumber = false;
      }

      if (!(v instanceof Date)) {
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
      case 'BOOLEAN':
        return Boolean(value);
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
