/**
 * Product terminology: "considered" / "secondary" → "coapplicant" in app
 * code and API responses. Postgres table/column names stay unchanged for now.
 */

export const COAPPLICANT_ENTITY_TYPE = 'COAPPLICANT_ENTITY' as const;
/** Legacy value still present in older Mongo docs. */
export const LEGACY_CONSIDERED_ENTITY_TYPE = 'CONSIDERED_ENTITY' as const;

export type GstEntityTypeLabel = 'PRIMARY' | typeof COAPPLICANT_ENTITY_TYPE;

export function isCoapplicantEntityType(
  value: string | null | undefined,
): boolean {
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase();
  return (
    normalized === COAPPLICANT_ENTITY_TYPE ||
    normalized === LEGACY_CONSIDERED_ENTITY_TYPE
  );
}

/** Normalize stored/read entity type for API + new Mongo writes. */
export function toApiEntityType(
  value: string | null | undefined,
): string | null {
  if (value == null || String(value).trim() === '') {
    return null;
  }
  if (isCoapplicantEntityType(value)) {
    return COAPPLICANT_ENTITY_TYPE;
  }
  return String(value).trim().toUpperCase();
}

/**
 * Replace "considered" with "coapplicant" while preserving casing style:
 * considered → coapplicant, Considered → Coapplicant, CONSIDERED → COAPPLICANT
 */
export function replaceConsideredToken(match: string): string {
  if (match === match.toUpperCase()) {
    return 'COAPPLICANT';
  }
  if (match[0] === match[0].toUpperCase()) {
    return 'Coapplicant';
  }
  return 'coapplicant';
}

/** Rename a single key/string token containing considered → coapplicant. */
export function renameConsideredInToken(token: string): string {
  return token.replace(/considered/gi, replaceConsideredToken);
}

/** CONSIDERED_* / SECONDARY_* metric keys → COAPPLICANT_* for API / storage. */
export function renameMetricKeyToCoapplicant(key: string): string {
  return renameConsideredInToken(key).replace(/^SECONDARY_/i, 'COAPPLICANT_');
}

export function renameMetricsRecordToCoapplicant(
  metrics: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metrics)) {
    const next = renameMetricKeyToCoapplicant(key);
    if (out[next] === undefined || key.toUpperCase().startsWith('COAPPLICANT_')) {
      out[next] = value;
    }
  }
  return out;
}

/**
 * Deep-rewrite any object/array for HTTP API output:
 * - keys containing "considered" → "coapplicant" (any style)
 * - string values containing "considered" → "coapplicant"
 * Covers upload rows (considered_state, considered_consent_available, …),
 * Mongo docs, nested payloads, metric keys, entityType enums, etc.
 */
export function renameConsideredInApiPayload(
  value: unknown,
  depth = 0,
): unknown {
  if (depth > 60 || value == null) {
    return value;
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => renameConsideredInApiPayload(item, depth + 1));
  }

  if (typeof value === 'object') {
    // Mongo ObjectId / similar
    const maybeId = value as { _bsontype?: string; toHexString?: () => string };
    if (
      maybeId._bsontype === 'ObjectID' ||
      maybeId._bsontype === 'ObjectId' ||
      typeof maybeId.toHexString === 'function'
    ) {
      try {
        return String(value);
      } catch {
        return value;
      }
    }

    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(
      value as Record<string, unknown>,
    )) {
      const nextKey = renameConsideredInToken(key);
      const nextVal = renameConsideredInApiPayload(nested, depth + 1);
      if (
        out[nextKey] === undefined ||
        /coapplicant/i.test(key) ||
        !/considered/i.test(key)
      ) {
        out[nextKey] = nextVal;
      }
    }
    return out;
  }

  if (typeof value === 'string' && /considered/i.test(value)) {
    return renameConsideredInToken(value);
  }

  return value;
}

/** Rename considered_* columns on a fetched upload/portfolio row for API output. */
export function mapUploadRowFieldsForApi<T extends Record<string, any>>(
  row: T,
): T {
  return renameConsideredInApiPayload(row) as T;
}

export function mapUploadRowsForApi<T extends Record<string, any>>(
  rows: T[],
): T[] {
  return renameConsideredInApiPayload(rows) as T[];
}

/** API aggregation type: accept coapplicant and legacy secondary. */
export function resolveAggregationTypeParam(
  type?: string | null,
): 'primary' | 'coapplicant' {
  const normalized = String(type ?? 'primary')
    .trim()
    .toLowerCase();
  if (
    normalized === 'coapplicant' ||
    normalized === 'secondary' ||
    normalized === 'considered'
  ) {
    return 'coapplicant';
  }
  return 'primary';
}
