import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryRunner, Repository } from 'typeorm';
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

  /**
   * API Ingestion Orchestrator
   */
  async processApiParent(
    jobId: string,
    endpoint: string,
    totalRecords: number,
    rawTableName: string,
  ) {
    try {
      await this.jobRepo.update(jobId, { status: 'PROCESSING' });
      const tableName = this.sanitizeIdentifier(rawTableName);

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

      const limit = 1000;
      const totalChunks = Math.ceil(totalRecords / limit);

      await this.jobRepo.update(jobId, { totalChunks });

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
      const records = this.fetchMockApiPage(page, limit);

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

      await this.taskRepo.update(taskId, { status: 'COMPLETED' });

      const job = await this.jobRepo.findOne({ where: { id: jobId } });
      if (job) {
        const newCompleted = job.completedChunks + 1;
        const newStatus: JobStatus =
          newCompleted >= job.totalChunks ? 'COMPLETED' : 'PROCESSING';
        await this.jobRepo.update(jobId, {
          completedChunks: newCompleted,
          status: newStatus,
        });
      }
    } catch (err) {
      await this.taskRepo.update(taskId, {
        status: 'FAILED',
        errorMessage: (err as Error).message,
      });
      throw err;
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
        taxable_value: parseFloat((100.5 * (i + 1) + 250).toFixed(2)),
        tax_amount: parseFloat((18.09 * (i + 1) + 45).toFixed(2)),
        is_active: i % 15 !== 0,
        total_invoices: 10 + i,
      });
    }
    return records;
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
