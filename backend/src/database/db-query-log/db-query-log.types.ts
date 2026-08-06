import type {
  DbQueryEngine,
  DbQuerySource,
} from '../../entities/db-query-log.entity';

export interface DbQueryLogEntry {
  dbEngine: DbQueryEngine;
  operation?: string | null;
  statement: string;
  collectionOrTable?: string | null;
  durationMs?: number | null;
  success?: boolean;
  errorMessage?: string | null;
  parameters?: Record<string, unknown> | unknown[] | null;
  requestId?: string | null;
  jobId?: string | null;
  traceId?: string | null;
  source?: DbQuerySource | string | null;
  userId?: string | null;
  customerId?: string | null;
  loanId?: string | null;
  gstin?: string | null;
}

export interface DbQueryLogQuery {
  requestId?: string;
  jobId?: string;
  gstin?: string;
  dbEngine?: DbQueryEngine;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export const DB_QUERY_LOG_TABLE = 'db_query_logs';
export const MAX_STATEMENT_CHARS = 8000;
export const MAX_PARAM_CHARS = 4000;
