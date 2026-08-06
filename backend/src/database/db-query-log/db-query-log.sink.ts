import type { DbQueryLogEntry } from './db-query-log.types';
import { shouldSkipDbQueryLogging } from './db-query-log.context';

type Sink = ((entry: DbQueryLogEntry) => void) | null;

let sink: Sink = null;

export function registerDbQueryLogSink(next: Sink): void {
  sink = next;
}

export function emitDbQueryLog(entry: DbQueryLogEntry): void {
  if (shouldSkipDbQueryLogging() || !sink) {
    return;
  }
  sink(entry);
}
