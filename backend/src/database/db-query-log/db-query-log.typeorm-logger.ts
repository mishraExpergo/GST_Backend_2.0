import type { Logger, QueryRunner } from 'typeorm';
import { emitDbQueryLog } from './db-query-log.sink';
import { shouldSkipDbQueryLogging } from './db-query-log.context';
import { DB_QUERY_LOG_TABLE } from './db-query-log.types';

/**
 * TypeORM logger that forwards SQL to DbQueryLogService (when enabled).
 * Wired from TypeOrmModule when ENABLE_DB_QUERY_LOGS=true.
 */
export class DbQueryTypeOrmLogger implements Logger {
  logQuery(query: string, parameters?: unknown[], _queryRunner?: QueryRunner) {
    this.capture('query', query, parameters, true);
  }

  logQueryError(
    error: string | Error,
    query: string,
    parameters?: unknown[],
    _queryRunner?: QueryRunner,
  ) {
    this.capture(
      'query-error',
      query,
      parameters,
      false,
      undefined,
      error instanceof Error ? error.message : String(error),
    );
  }

  logQuerySlow(
    time: number,
    query: string,
    parameters?: unknown[],
    _queryRunner?: QueryRunner,
  ) {
    this.capture('query-slow', query, parameters, true, time);
  }

  logSchemaBuild(_message: string, _queryRunner?: QueryRunner) {
    // Intentionally ignored — not useful for app traceability.
  }

  logMigration(_message: string, _queryRunner?: QueryRunner) {
    // Intentionally ignored.
  }

  log(
    _level: 'log' | 'info' | 'warn',
    _message: unknown,
    _queryRunner?: QueryRunner,
  ) {
    // Intentionally ignored — avoid noise from TypeORM info logs.
  }

  private capture(
    operation: string,
    query: string,
    parameters: unknown[] | undefined,
    success: boolean,
    durationMs?: number,
    errorMessage?: string,
  ) {
    if (shouldSkipDbQueryLogging()) {
      return;
    }
    const statement = String(query ?? '');
    if (!statement || statement.toLowerCase().includes(DB_QUERY_LOG_TABLE)) {
      return;
    }

    emitDbQueryLog({
      dbEngine: 'postgres',
      operation,
      statement,
      collectionOrTable: extractPostgresTable(statement),
      durationMs: durationMs ?? null,
      success,
      errorMessage: errorMessage ?? null,
      parameters: parameters ?? null,
    });
  }
}

function extractPostgresTable(sql: string): string | null {
  const match = sql.match(
    /\b(?:from|into|update|table|join)\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?/i,
  );
  return match?.[1] ?? null;
}
