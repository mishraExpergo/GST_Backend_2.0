import { AsyncLocalStorage } from 'node:async_hooks';
import type { DbQuerySource } from '../../entities/db-query-log.entity';

export interface DbQueryLogContext {
  requestId?: string | null;
  jobId?: string | null;
  traceId?: string | null;
  source?: DbQuerySource | string | null;
  userId?: string | null;
  customerId?: string | null;
  loanId?: string | null;
  gstin?: string | null;
}

const contextAls = new AsyncLocalStorage<DbQueryLogContext>();
const skipAls = new AsyncLocalStorage<boolean>();

export function isDbQueryLoggingEnabled(): boolean {
  return process.env.ENABLE_DB_QUERY_LOGS === 'true';
}

export function getDbQueryLogContext(): DbQueryLogContext {
  return contextAls.getStore() ?? {};
}

export function runWithDbLogContext<T>(
  context: DbQueryLogContext,
  fn: () => T,
): T {
  const parent = getDbQueryLogContext();
  return contextAls.run({ ...parent, ...context }, fn);
}

export function runWithoutDbQueryLogging<T>(fn: () => T): T {
  return skipAls.run(true, fn);
}

export function shouldSkipDbQueryLogging(): boolean {
  return skipAls.getStore() === true || !isDbQueryLoggingEnabled();
}
