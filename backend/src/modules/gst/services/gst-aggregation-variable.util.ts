/** Keys written by verify-and-fetch primary aggregation. */
export const PRIMARY_GST_COMPLIANCE_METRIC_KEYS = [
  'PRIMARY_TOTAL_GST_COUNT',
  'PRIMARY_ACTIVE_GST_COUNT',
  'PRIMARY_CANCELLED_GST_COUNT',
  'PRIMARY_SUSPENDED_GST_COUNT',
  'PRIMARY_ADDRESS_CHANGE',
  'PRIMARY_TOTAL_EINVOICE_COUNT',
  'PRIMARY_EINVOICE_ENABLED_COUNT',
] as const;

/** Keys written by verify-and-fetch secondary aggregation. */
export const SECONDARY_GST_COMPLIANCE_METRIC_KEYS = [
  'SECONDARY_TOTAL_GST_COUNT',
  'SECONDARY_ACTIVE_GST_COUNT',
  'SECONDARY_CANCELLED_GST_COUNT',
  'SECONDARY_SUSPENDED_GST_COUNT',
  'SECONDARY_ADDRESS_CHANGE',
  'SECONDARY_TOTAL_EINVOICE_COUNT',
  'SECONDARY_EINVOICE_ENABLED_COUNT',
] as const;

export function mergeAggregationVariable(
  existingJson: string | null | undefined,
  newMetrics: Record<string, unknown>,
): string {
  let existing: Record<string, unknown> = {};

  if (existingJson) {
    try {
      const parsed = JSON.parse(existingJson);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>;
      }
    } catch {
      existing = {};
    }
  }

  return JSON.stringify({ ...existing, ...newMetrics });
}

export function preserveMetricKeys(
  existingJson: string | null | undefined,
  keysToPreserve: readonly string[],
): Record<string, unknown> {
  if (!existingJson) {
    return {};
  }

  try {
    const parsed = JSON.parse(existingJson) as Record<string, unknown>;
    const preserved: Record<string, unknown> = {};
    for (const key of keysToPreserve) {
      if (parsed[key] !== undefined) {
        preserved[key] = parsed[key];
      }
    }
    return preserved;
  } catch {
    return {};
  }
}
