import { Logger } from '@nestjs/common';
import { MongoClient } from 'mongodb';

const CONNECT_TIMEOUT_MS = 5000;

/** Avoid mongodb+srv DNS SRV lookups when the local resolver blocks them. */
export function toStandardMongoUri(srvUri: string): string | null {
  if (!srvUri.startsWith('mongodb+srv://')) {
    return null;
  }

  const withoutScheme = srvUri.slice('mongodb+srv://'.length);
  const at = withoutScheme.indexOf('@');
  if (at === -1) {
    return null;
  }

  const creds = withoutScheme.slice(0, at);
  const rest = withoutScheme.slice(at + 1);
  const slash = rest.indexOf('/');
  const host =
    slash === -1 ? rest.split('?')[0] : rest.slice(0, slash);
  const queryStart = rest.indexOf('?');
  const query = queryStart === -1 ? '' : rest.slice(queryStart + 1);
  const params = new URLSearchParams(query);

  params.set('tls', 'true');
  if (!params.has('authSource')) {
    params.set('authSource', 'admin');
  }
  if (!params.has('retryWrites')) {
    params.set('retryWrites', 'true');
  }
  if (!params.has('w')) {
    params.set('w', 'majority');
  }

  return `mongodb://${creds}@${host}:27017/?${params.toString()}`;
}

export function sanitizeMongoUri(uri: string): string {
  return uri.replace(/:([^@/]+)@/, ':****@');
}

/** Returns the URI that successfully connected. */
export async function pingMongo(uri: string): Promise<string> {
  const standardUri = toStandardMongoUri(uri);
  const candidates =
    uri.startsWith('mongodb+srv://') && standardUri
      ? [standardUri, uri]
      : [uri];

  let lastError: unknown;
  for (const candidate of candidates) {
    const client = new MongoClient(candidate, {
      serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS,
    });

    try {
      await client.connect();
      await client.db().command({ ping: 1 });
      return candidate;
    } catch (err) {
      lastError = err;
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  throw lastError;
}

/**
 * Verify MongoDB before Nest modules load (AppModule reads ENABLE_MONGO at import time).
 * Falls back to a standard mongodb:// URI when SRV DNS is blocked.
 */
export async function resolveMongoMode(logger: Logger): Promise<boolean> {
  if (process.env.ENABLE_MONGO !== 'true') {
    return false;
  }

  const uri = process.env.MONGO_URI?.trim();
  if (!uri) {
    logger.warn('ENABLE_MONGO=true but MONGO_URI is missing. Disabling MongoDB.');
    process.env.ENABLE_MONGO = 'false';
    return false;
  }

  try {
    const resolvedUri = await pingMongo(uri);
    if (resolvedUri !== uri) {
      process.env.MONGO_URI = resolvedUri;
      logger.log(
        `MongoDB connected via standard URI (${sanitizeMongoUri(resolvedUri)}).`,
      );
    } else {
      logger.log(`MongoDB reachable at ${sanitizeMongoUri(resolvedUri)}.`);
    }
    return true;
  } catch (err) {
    logger.warn('=================================================');
    logger.warn(`MongoDB unreachable (${sanitizeMongoUri(uri)})`);
    logger.warn(
      `Reason: ${err instanceof Error ? err.message : String(err)}`,
    );
    logger.warn(
      'GST compliance storage disabled for this session. Excel/API jobs still work.',
    );
    logger.warn(
      'Fix MONGO_URI or network access, then restart with ENABLE_MONGO=true.',
    );
    logger.warn('=================================================');
    process.env.ENABLE_MONGO = 'false';
    return false;
  }
}
