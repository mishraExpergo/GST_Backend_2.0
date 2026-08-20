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

/**
 * Keys written by verify-and-fetch considered-entity (secondary table) aggregation.
 * Replaces the older SECONDARY_* compliance keys.
 */
export const CONSIDERED_GST_COMPLIANCE_METRIC_KEYS = [
  'CONSIDERED_TOTAL_GST_COUNT',
  'CONSIDERED_ACTIVE_GST_COUNT',
  'CONSIDERED_CANCELLED_GST_COUNT',
  'CONSIDERED_SUSPENDED_GST_COUNT',
  'CONSIDERED_ADDRESS_CHANGE_COUNT',
  'CONSIDERED_TOTAL_EINVOICE_COUNT',
  'CONSIDERED_EINVOICE_ENABLED_COUNT',
] as const;

/** Keys written by verify-and-fetch/gstr-track primary aggregation. */
export const PRIMARY_GSTR_TRACK_METRIC_KEYS = [
  'PRIMARY_TOTAL_RETURN_PERIODS',
  'PRIMARY_FILED_RETURN_COUNT',
  'PRIMARY_NON_FILED_RETURN_COUNT',
  'PRIMARY_DELAYED_RETURN_COUNT',
  'PRIMARY_ONTIME_RETURN_COUNT',
] as const;

/** Keys written by verify-and-fetch/gstr-track considered-entity aggregation. */
export const CONSIDERED_GSTR_TRACK_METRIC_KEYS = [
  'CONSIDERED_TOTAL_RETURN_PERIODS',
  'CONSIDERED_FILED_RETURN_COUNT',
  'CONSIDERED_NON_FILED_RETURN_COUNT',
  'CONSIDERED_DELAYED_RETURN_COUNT',
  'CONSIDERED_ONTIME_RETURN_COUNT',
] as const;

/** Keys written by GSTR-2B considered-supplier (secondary) aggregation. */
export const CONSIDERED_GSTR2B_SUPPLIER_METRIC_KEYS = [
  'CONSIDERED_TOTAL_SUPPLIER_COUNT',
  'CONSIDERED_SUPPLIER_TOTAL_INELIGIBLE_ITC',
  'CONSIDERED_SUPPLIER_TOTAL_REVERSED_ITC',
  'CONSIDERED_SUPPLIER_TOTAL_ELIGIBLE_ITC',
  'CONSIDERED_SUPPLIER_TOTAL_INVOICE_COUNT',
  'CONSIDERED_SUPPLIER_ELIGIBLE_INVOICE_COUNT',
  'CONSIDERED_SUPPLIER_INELIGIBLE_INVOICE_COUNT',
  'CONSIDERED_SUPPLIER_IGST_ITC',
  'CONSIDERED_SUPPLIER_CGST_ITC',
  'CONSIDERED_SUPPLIER_SGST_ITC',
  'CONSIDERED_SUPPLIER_CESS_ITC',
] as const;

/** Keys written by GSTR-3B considered-entity (secondary) aggregation. */
export const CONSIDERED_GSTR3B_METRIC_KEYS = [
  'CONSIDERED_TOTAL_TAXABLE_TURNOVER',
  'CONSIDERED_TOTAL_EXEMPT_TURNOVER',
  'CONSIDERED_TOTAL_REVERSE_CHARGE_SALES',
  'CONSIDERED_TOTAL_PURCHASE_VALUE',
  'CONSIDERED_TOTAL_INTERSTATE_PURCHASES',
  'CONSIDERED_TOTAL_INTRASTATE_PURCHASES',
  'CONSIDERED_TOTAL_NON_GST_PURCHASES',
  'CONSIDERED_TOTAL_ITC_AVAILABLE',
  'CONSIDERED_TOTAL_CGST_ITC',
  'CONSIDERED_TOTAL_SGST_ITC',
  'CONSIDERED_TOTAL_IGST_ITC',
  'CONSIDERED_TOTAL_ITC_REVERSED',
  'CONSIDERED_TOTAL_INELIGIBLE_ITC',
  'CONSIDERED_TOTAL_ITC_UTILISED',
  'CONSIDERED_TOTAL_CGST_ITC_UTILISED',
  'CONSIDERED_TOTAL_SGST_ITC_UTILISED',
  'CONSIDERED_TOTAL_IGST_ITC_UTILISED',
  'CONSIDERED_TOTAL_CESS_ITC_UTILISED',
  'CONSIDERED_TOTAL_CASH_TAX_PAID',
  'CONSIDERED_TOTAL_CASH_CGST_PAID',
  'CONSIDERED_TOTAL_CASH_SGST_PAID',
  'CONSIDERED_TOTAL_CASH_IGST_PAID',
  'CONSIDERED_TOTAL_CASH_CESS_PAID',
] as const;

/** @deprecated Prefer CONSIDERED_GST_COMPLIANCE_METRIC_KEYS */
export const SECONDARY_GST_COMPLIANCE_METRIC_KEYS =
  CONSIDERED_GST_COMPLIANCE_METRIC_KEYS;

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
