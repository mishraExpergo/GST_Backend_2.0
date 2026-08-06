import mongoose from 'mongoose';
import type { DbQueryLogEntry } from './db-query-log.types';
import { shouldSkipDbQueryLogging } from './db-query-log.context';
import { MAX_STATEMENT_CHARS } from './db-query-log.types';

/**
 * Installs mongoose debug hook. Returns uninstall function.
 */
export function installMongooseDbQueryLogging(
  enqueue: (entry: DbQueryLogEntry) => void,
): () => void {
  const previous = (mongoose as unknown as { _gstPrevDebug?: unknown })
    ._gstPrevDebug;
  (mongoose as unknown as { _gstPrevDebug?: unknown })._gstPrevDebug =
    mongoose.get('debug');

  mongoose.set('debug', (collectionName: string, methodName: string, ...args: unknown[]) => {
    if (shouldSkipDbQueryLogging()) {
      return;
    }

    let statement: string;
    try {
      statement = truncate(
        `${collectionName}.${methodName}(${args
          .map((arg) => {
            try {
              return JSON.stringify(arg);
            } catch {
              return String(arg);
            }
          })
          .join(', ')})`,
        MAX_STATEMENT_CHARS,
      );
    } catch {
      statement = `${collectionName}.${methodName}(…)`;
    }

    enqueue({
      dbEngine: 'mongo',
      operation: methodName,
      statement,
      collectionOrTable: collectionName,
      success: true,
      parameters: args.length ? (args as unknown[]) : null,
    });
  });

  return () => {
    mongoose.set('debug', previous ?? false);
  };
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}…[truncated]`;
}
