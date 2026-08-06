import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import {
  isDbQueryLoggingEnabled,
  runWithDbLogContext,
} from './db-query-log.context';

/**
 * Assigns requestId and ALS context for the HTTP request lifecycle.
 */
export function dbQueryLogMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!isDbQueryLoggingEnabled()) {
    next();
    return;
  }

  const header = req.headers['x-request-id'];
  const requestId =
    (typeof header === 'string' && header.trim()) || randomUUID();
  res.setHeader('x-request-id', requestId);

  const user = (req as Request & { user?: { userId?: string; sub?: string } })
    .user;
  const userId = user?.userId ?? user?.sub ?? null;

  runWithDbLogContext(
    {
      requestId,
      traceId: requestId,
      source: 'http',
      userId,
    },
    () => next(),
  );
}
