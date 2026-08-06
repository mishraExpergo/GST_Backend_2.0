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

/** CONSIDERED_* / SECONDARY_* metric keys → COAPPLICANT_* for API / storage. */
export function renameMetricKeyToCoapplicant(key: string): string {
  return key
    .replace(/^CONSIDERED_/i, 'COAPPLICANT_')
    .replace(/^SECONDARY_/i, 'COAPPLICANT_');
}

export function renameMetricsRecordToCoapplicant(
  metrics: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metrics)) {
    const next = renameMetricKeyToCoapplicant(key);
    // Prefer an existing COAPPLICANT_* value over a legacy duplicate.
    if (out[next] === undefined || key.toUpperCase().startsWith('COAPPLICANT_')) {
      out[next] = value;
    }
  }
  return out;
}

const UPLOAD_FIELD_RENAMES: Array<[string, string]> = [
  ['considered_entity_pan', 'coapplicant_entity_pan'],
  ['considered_entity_gst_no', 'coapplicant_entity_gst_no'],
  ['considered_entity_name', 'coapplicant_entity_name'],
  ['considered_entity_gstin', 'coapplicant_entity_gstin'],
];

/** Rename considered_* columns on a fetched upload/portfolio row for API output. */
export function mapUploadRowFieldsForApi<T extends Record<string, any>>(
  row: T,
): T {
  const out: Record<string, any> = { ...row };
  for (const [from, to] of UPLOAD_FIELD_RENAMES) {
    if (Object.prototype.hasOwnProperty.call(out, from)) {
      out[to] = out[from];
      delete out[from];
    }
  }
  return out as T;
}

export function mapUploadRowsForApi<T extends Record<string, any>>(
  rows: T[],
): T[] {
  return rows.map((row) => mapUploadRowFieldsForApi(row));
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
