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
 * Keys written by verify-and-fetch coapplicant-entity aggregation
 * (stored in secondary_gst_aggregation table for now).
 */
export const COAPPLICANT_GST_COMPLIANCE_METRIC_KEYS = [
  'COAPPLICANT_TOTAL_GST_COUNT',
  'COAPPLICANT_ACTIVE_GST_COUNT',
  'COAPPLICANT_CANCELLED_GST_COUNT',
  'COAPPLICANT_SUSPENDED_GST_COUNT',
  'COAPPLICANT_ADDRESS_CHANGE_COUNT',
  'COAPPLICANT_TOTAL_EINVOICE_COUNT',
  'COAPPLICANT_EINVOICE_ENABLED_COUNT',
] as const;

/** @deprecated Prefer COAPPLICANT_GST_COMPLIANCE_METRIC_KEYS */
export const CONSIDERED_GST_COMPLIANCE_METRIC_KEYS =
  COAPPLICANT_GST_COMPLIANCE_METRIC_KEYS;

/** Keys written by verify-and-fetch/gstr-track primary aggregation. */
export const PRIMARY_GSTR_TRACK_METRIC_KEYS = [
  'PRIMARY_TOTAL_RETURN_PERIODS',
  'PRIMARY_FILED_RETURN_COUNT',
  'PRIMARY_NON_FILED_RETURN_COUNT',
  'PRIMARY_DELAYED_RETURN_COUNT',
  'PRIMARY_ONTIME_RETURN_COUNT',
] as const;

/** Keys written by verify-and-fetch/gstr-track coapplicant-entity aggregation. */
export const COAPPLICANT_GSTR_TRACK_METRIC_KEYS = [
  'COAPPLICANT_TOTAL_RETURN_PERIODS',
  'COAPPLICANT_FILED_RETURN_COUNT',
  'COAPPLICANT_NON_FILED_RETURN_COUNT',
  'COAPPLICANT_DELAYED_RETURN_COUNT',
  'COAPPLICANT_ONTIME_RETURN_COUNT',
] as const;

/** @deprecated Prefer COAPPLICANT_GSTR_TRACK_METRIC_KEYS */
export const CONSIDERED_GSTR_TRACK_METRIC_KEYS = COAPPLICANT_GSTR_TRACK_METRIC_KEYS;

/** Keys written by GSTR-2B coapplicant-supplier aggregation. */
export const COAPPLICANT_GSTR2B_SUPPLIER_METRIC_KEYS = [
  'COAPPLICANT_TOTAL_SUPPLIER_COUNT',
  'COAPPLICANT_SUPPLIER_TOTAL_INELIGIBLE_ITC',
  'COAPPLICANT_SUPPLIER_TOTAL_REVERSED_ITC',
  'COAPPLICANT_SUPPLIER_TOTAL_ELIGIBLE_ITC',
  'COAPPLICANT_SUPPLIER_TOTAL_INVOICE_COUNT',
  'COAPPLICANT_SUPPLIER_ELIGIBLE_INVOICE_COUNT',
  'COAPPLICANT_SUPPLIER_INELIGIBLE_INVOICE_COUNT',
  'COAPPLICANT_SUPPLIER_IGST_ITC',
  'COAPPLICANT_SUPPLIER_CGST_ITC',
  'COAPPLICANT_SUPPLIER_SGST_ITC',
  'COAPPLICANT_SUPPLIER_CESS_ITC',
] as const;

/** @deprecated Prefer COAPPLICANT_GSTR2B_SUPPLIER_METRIC_KEYS */
export const CONSIDERED_GSTR2B_SUPPLIER_METRIC_KEYS =
  COAPPLICANT_GSTR2B_SUPPLIER_METRIC_KEYS;

/** Keys written by GSTR-3B coapplicant-entity aggregation. */
export const COAPPLICANT_GSTR3B_METRIC_KEYS = [
  'COAPPLICANT_TOTAL_TAXABLE_TURNOVER',
  'COAPPLICANT_TOTAL_EXEMPT_TURNOVER',
  'COAPPLICANT_TOTAL_REVERSE_CHARGE_SALES',
  'COAPPLICANT_TOTAL_PURCHASE_VALUE',
  'COAPPLICANT_TOTAL_INTERSTATE_PURCHASES',
  'COAPPLICANT_TOTAL_INTRASTATE_PURCHASES',
  'COAPPLICANT_TOTAL_NON_GST_PURCHASES',
  'COAPPLICANT_TOTAL_ITC_AVAILABLE',
  'COAPPLICANT_TOTAL_CGST_ITC',
  'COAPPLICANT_TOTAL_SGST_ITC',
  'COAPPLICANT_TOTAL_IGST_ITC',
  'COAPPLICANT_TOTAL_ITC_REVERSED',
  'COAPPLICANT_TOTAL_INELIGIBLE_ITC',
  'COAPPLICANT_TOTAL_ITC_UTILISED',
  'COAPPLICANT_TOTAL_CGST_ITC_UTILISED',
  'COAPPLICANT_TOTAL_SGST_ITC_UTILISED',
  'COAPPLICANT_TOTAL_IGST_ITC_UTILISED',
  'COAPPLICANT_TOTAL_CASH_TAX_PAID',
  'COAPPLICANT_TOTAL_CASH_CGST_PAID',
  'COAPPLICANT_TOTAL_CASH_SGST_PAID',
  'COAPPLICANT_TOTAL_CASH_IGST_PAID',
] as const;

/** @deprecated Prefer COAPPLICANT_GSTR3B_METRIC_KEYS */
export const CONSIDERED_GSTR3B_METRIC_KEYS = COAPPLICANT_GSTR3B_METRIC_KEYS;

/** @deprecated Prefer COAPPLICANT_GST_COMPLIANCE_METRIC_KEYS */
export const SECONDARY_GST_COMPLIANCE_METRIC_KEYS =
  COAPPLICANT_GST_COMPLIANCE_METRIC_KEYS;

import { renameMetricsRecordToCoapplicant } from './gst-terminology.util';

export function mergeAggregationVariable(
  existingJson: string | null | undefined,
  newMetrics: Record<string, unknown>,
): string {
  let existing: Record<string, unknown> = {};

  if (existingJson) {
    try {
      const parsed = JSON.parse(existingJson);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        existing = renameMetricsRecordToCoapplicant(
          parsed as Record<string, unknown>,
        );
      }
    } catch {
      existing = {};
    }
  }

  const merged = {
    ...existing,
    ...renameMetricsRecordToCoapplicant(newMetrics),
  };
  return JSON.stringify(merged);
}

export function preserveMetricKeys(
  existingJson: string | null | undefined,
  keysToPreserve: readonly string[],
): Record<string, unknown> {
  if (!existingJson) {
    return {};
  }

  try {
    const parsed = renameMetricsRecordToCoapplicant(
      JSON.parse(existingJson) as Record<string, unknown>,
    );
    const preserved: Record<string, unknown> = {};
    for (const key of keysToPreserve) {
      const normalized = key
        .replace(/^CONSIDERED_/i, 'COAPPLICANT_')
        .replace(/^SECONDARY_/i, 'COAPPLICANT_');
      if (parsed[normalized] !== undefined) {
        preserved[normalized] = parsed[normalized];
      } else if (parsed[key] !== undefined) {
        preserved[normalized] = parsed[key];
      }
    }
    return preserved;
  } catch {
    return {};
  }
}
