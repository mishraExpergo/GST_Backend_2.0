import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  getDbQueryLogContext,
  isDbQueryLoggingEnabled,
  runWithoutDbQueryLogging,
  shouldSkipDbQueryLogging,
} from './db-query-log.context';
import {
  DB_QUERY_LOG_TABLE,
  MAX_PARAM_CHARS,
  MAX_STATEMENT_CHARS,
  type DbQueryLogEntry,
  type DbQueryLogQuery,
} from './db-query-log.types';
import { installMongooseDbQueryLogging } from './db-query-log.mongoose';
import { registerDbQueryLogSink } from './db-query-log.sink';

type BufferedRow = {
  db_engine: string;
  operation: string | null;
  statement: string;
  collection_or_table: string | null;
  duration_ms: number | null;
  success: boolean;
  error_message: string | null;
  request_id: string | null;
  job_id: string | null;
  trace_id: string | null;
  source: string | null;
  user_id: string | null;
  customer_id: string | null;
  loan_id: string | null;
  gstin: string | null;
  parameters: string | null;
};

@Injectable()
export class DbQueryLogService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DbQueryLogService.name);
  private readonly buffer: BufferedRow[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private flushing = false;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private uninstallMongoose: (() => void) | null = null;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    this.batchSize = Math.max(
      1,
      Number(process.env.DB_QUERY_LOG_BATCH_SIZE ?? '50'),
    );
    this.flushIntervalMs = Math.max(
      250,
      Number(process.env.DB_QUERY_LOG_FLUSH_MS ?? '1000'),
    );
  }

  async onModuleInit(): Promise<void> {
    if (!isDbQueryLoggingEnabled()) {
      this.logger.log(
        'DB query logging is OFF (set ENABLE_DB_QUERY_LOGS=true to enable).',
      );
      return;
    }

    registerDbQueryLogSink((entry) => this.enqueue(entry));
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
    // Allow process to exit without waiting on the timer.
    this.flushTimer.unref?.();

    if (process.env.ENABLE_MONGO === 'true') {
      this.uninstallMongoose = installMongooseDbQueryLogging((entry) =>
        this.enqueue(entry),
      );
    }

    this.logger.log(
      `DB query logging ON (batch=${this.batchSize}, flushMs=${this.flushIntervalMs}).`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.uninstallMongoose?.();
    this.uninstallMongoose = null;
    registerDbQueryLogSink(null);
    await this.flush();
  }

  enqueue(entry: DbQueryLogEntry): void {
    if (shouldSkipDbQueryLogging()) {
      return;
    }

    const statement = truncate(String(entry.statement ?? ''), MAX_STATEMENT_CHARS);
    if (!statement) {
      return;
    }

    if (isSelfAuditStatement(statement, entry.collectionOrTable)) {
      return;
    }

    const ctx = getDbQueryLogContext();
    this.buffer.push({
      db_engine: entry.dbEngine,
      operation: entry.operation ?? null,
      statement,
      collection_or_table: entry.collectionOrTable ?? null,
      duration_ms: entry.durationMs ?? null,
      success: entry.success !== false,
      error_message: entry.errorMessage
        ? truncate(String(entry.errorMessage), MAX_STATEMENT_CHARS)
        : null,
      request_id: entry.requestId ?? ctx.requestId ?? null,
      job_id: entry.jobId ?? ctx.jobId ?? null,
      trace_id: entry.traceId ?? ctx.traceId ?? ctx.requestId ?? null,
      source: entry.source ?? ctx.source ?? 'unknown',
      user_id: entry.userId ?? ctx.userId ?? null,
      customer_id: entry.customerId ?? ctx.customerId ?? null,
      loan_id: entry.loanId ?? ctx.loanId ?? null,
      gstin: entry.gstin ?? ctx.gstin ?? null,
      parameters: serializeParameters(entry.parameters),
    });

    if (this.buffer.length >= this.batchSize) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0) {
      return;
    }

    this.flushing = true;
    const batch = this.buffer.splice(0, this.buffer.length);

    try {
      await runWithoutDbQueryLogging(async () => {
        const values: unknown[] = [];
        const placeholders: string[] = [];
        let i = 1;

        for (const row of batch) {
          placeholders.push(
            `($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}::jsonb)`,
          );
          values.push(
            row.db_engine,
            row.operation,
            row.statement,
            row.collection_or_table,
            row.duration_ms,
            row.success,
            row.error_message,
            row.request_id,
            row.job_id,
            row.trace_id,
            row.source,
            row.user_id,
            row.customer_id,
            row.loan_id,
            row.gstin,
            row.parameters,
          );
        }

        await this.dataSource.query(
          `
          INSERT INTO ${DB_QUERY_LOG_TABLE} (
            db_engine, operation, statement, collection_or_table, duration_ms,
            success, error_message, request_id, job_id, trace_id, source,
            user_id, customer_id, loan_id, gstin, parameters
          ) VALUES ${placeholders.join(', ')}
          `,
          values,
        );
      });
    } catch (err) {
      this.logger.warn(
        `Failed to flush ${batch.length} db_query_logs rows: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      this.flushing = false;
    }
  }

  async findLogs(query: DbQueryLogQuery): Promise<{
    total: number;
    limit: number;
    offset: number;
    items: Record<string, unknown>[];
  }> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 500);
    const offset = Math.max(query.offset ?? 0, 0);
    const where: string[] = [];
    const params: unknown[] = [];

    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(`${sql} $${params.length}`);
    };

    if (query.requestId) {
      add('request_id =', query.requestId);
    }
    if (query.jobId) {
      add('job_id =', query.jobId);
    }
    if (query.gstin) {
      add('gstin =', query.gstin.toUpperCase());
    }
    if (query.dbEngine) {
      add('db_engine =', query.dbEngine);
    }
    if (query.from) {
      add('created_at >=', query.from);
    }
    if (query.to) {
      add('created_at <=', query.to);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    return runWithoutDbQueryLogging(async () => {
      const countRows = await this.dataSource.query(
        `SELECT COUNT(*)::int AS count FROM ${DB_QUERY_LOG_TABLE} ${whereSql}`,
        params,
      );
      const total = Number(countRows?.[0]?.count ?? 0);

      const limitIdx = params.length + 1;
      const offsetIdx = params.length + 2;
      const items = await this.dataSource.query(
        `
        SELECT
          id, db_engine AS "dbEngine", operation, statement,
          collection_or_table AS "collectionOrTable",
          duration_ms AS "durationMs", success,
          error_message AS "errorMessage",
          request_id AS "requestId", job_id AS "jobId",
          trace_id AS "traceId", source,
          user_id AS "userId", customer_id AS "customerId",
          loan_id AS "loanId", gstin, parameters,
          created_at AS "createdAt"
        FROM ${DB_QUERY_LOG_TABLE}
        ${whereSql}
        ORDER BY created_at DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
        `,
        [...params, limit, offset],
      );

      return { total, limit, offset, items };
    });
  }
}

function isSelfAuditStatement(
  statement: string,
  collectionOrTable?: string | null,
): boolean {
  if (collectionOrTable === DB_QUERY_LOG_TABLE) {
    return true;
  }
  return statement.toLowerCase().includes(DB_QUERY_LOG_TABLE);
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}…[truncated]`;
}

function serializeParameters(
  parameters: DbQueryLogEntry['parameters'],
): string | null {
  if (parameters == null) {
    return null;
  }
  try {
    const text = JSON.stringify(redact(parameters));
    return truncate(text, MAX_PARAM_CHARS);
  } catch {
    return truncate(String(parameters), MAX_PARAM_CHARS);
  }
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (/password|secret|token|authorization|api[_-]?key/i.test(key)) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = redact(nested);
      }
    }
    return out;
  }
  return value;
}
