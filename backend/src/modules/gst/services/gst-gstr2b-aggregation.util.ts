import { Gstr2bComplianceRecord } from '../schemas/gst-gstr2b-compliance.schema';
import { COAPPLICANT_GSTR2B_SUPPLIER_METRIC_KEYS as COAPPLICANT_GSTR2B_SUPPLIER_METRIC_KEYS_FROM_VAR } from './gst-aggregation-variable.util';
import { isCoapplicantEntityType } from './gst-terminology.util';

export interface PrimaryGstr2bAggregationMetrics {
  PRIMARY_TOTAL_SUPPLIER_COUNT: number;
  PRIMARY_SUPPLIER_TOTAL_ELIGIBLE_ITC: number;
  PRIMARY_SUPPLIER_TOTAL_INELIGIBLE_ITC: number;
  PRIMARY_SUPPLIER_TOTAL_REVERSED_ITC: number;
  PRIMARY_SUPPLIER_IGST_ITC: number;
  PRIMARY_SUPPLIER_CGST_ITC: number;
  PRIMARY_SUPPLIER_SGST_ITC: number;
  PRIMARY_SUPPLIER_CESS_ITC: number;
  PRIMARY_TOTAL_INVOICE_COUNT: number;
  PRIMARY_ELIGIBLE_INVOICE_COUNT: number;
  PRIMARY_INELIGIBLE_INVOICE_COUNT: number;
}

/**
 * Loan-level coapplicant-supplier metrics written to secondary_gst_aggregation
 * after GSTR-2B aggregation.
 */
export interface CoapplicantSupplierGstr2bAggregationMetrics {
  COAPPLICANT_TOTAL_SUPPLIER_COUNT: number;
  COAPPLICANT_SUPPLIER_TOTAL_INELIGIBLE_ITC: number;
  COAPPLICANT_SUPPLIER_TOTAL_REVERSED_ITC: number;
  COAPPLICANT_SUPPLIER_TOTAL_ELIGIBLE_ITC: number;
  COAPPLICANT_SUPPLIER_TOTAL_INVOICE_COUNT: number;
  COAPPLICANT_SUPPLIER_ELIGIBLE_INVOICE_COUNT: number;
  COAPPLICANT_SUPPLIER_INELIGIBLE_INVOICE_COUNT: number;
  COAPPLICANT_SUPPLIER_IGST_ITC: number;
  COAPPLICANT_SUPPLIER_CGST_ITC: number;
  COAPPLICANT_SUPPLIER_SGST_ITC: number;
  COAPPLICANT_SUPPLIER_CESS_ITC: number;
}

/** @deprecated Prefer CoapplicantSupplierGstr2bAggregationMetrics */
export type CoapplicantGstr2bAggregationMetrics =
  CoapplicantSupplierGstr2bAggregationMetrics;

/** @deprecated Prefer CoapplicantSupplierGstr2bAggregationMetrics */
export type ConsideredSupplierGstr2bAggregationMetrics =
  CoapplicantSupplierGstr2bAggregationMetrics;

export const PRIMARY_GSTR2B_METRIC_KEYS = [
  'PRIMARY_TOTAL_SUPPLIER_COUNT',
  'PRIMARY_SUPPLIER_TOTAL_ELIGIBLE_ITC',
  'PRIMARY_SUPPLIER_TOTAL_INELIGIBLE_ITC',
  'PRIMARY_SUPPLIER_TOTAL_REVERSED_ITC',
  'PRIMARY_SUPPLIER_IGST_ITC',
  'PRIMARY_SUPPLIER_CGST_ITC',
  'PRIMARY_SUPPLIER_SGST_ITC',
  'PRIMARY_SUPPLIER_CESS_ITC',
  'PRIMARY_TOTAL_INVOICE_COUNT',
  'PRIMARY_ELIGIBLE_INVOICE_COUNT',
  'PRIMARY_INELIGIBLE_INVOICE_COUNT',
] as const;

export const COAPPLICANT_GSTR2B_SUPPLIER_METRIC_KEYS =
  COAPPLICANT_GSTR2B_SUPPLIER_METRIC_KEYS_FROM_VAR;

/** @deprecated Prefer COAPPLICANT_GSTR2B_SUPPLIER_METRIC_KEYS */
export const COAPPLICANT_GSTR2B_METRIC_KEYS_LEGACY = COAPPLICANT_GSTR2B_SUPPLIER_METRIC_KEYS;

interface InvoiceMetricFact {
  supplierGstin: string | null;
  invoiceNumber: string | null;
  itcEligibility: 'ELIGIBLE' | 'INELIGIBLE' | null;
  eligibleItc: number;
  ineligibleItc: number;
  itcReversed: number;
  igstItc: number;
  cgstItc: number;
  sgstItc: number;
  cessItc: number;
}

interface TraversalContext {
  supplierGstin: string | null;
  invoiceNumber: string | null;
  itcEligibility: 'ELIGIBLE' | 'INELIGIBLE' | null;
}

/** Per coapplicant-entity PAN supplier metrics (before loan roll-up). */
export interface CoapplicantEntityPanSupplierMetrics {
  totalSupplierCount: number;
  totalIneligibleItc: number;
  totalReversedItc: number;
  totalEligibleItc: number;
  totalInvoiceCount: number;
  eligibleInvoiceCount: number;
  ineligibleInvoiceCount: number;
  igstItc: number;
  cgstItc: number;
  sgstItc: number;
  cessItc: number;
}

export function normalizePan(pan: string | null | undefined): string | null {
  const normalized = (pan ?? '').trim().toUpperCase();
  return normalized || null;
}

export function getGstr2bRecordPan(
  record: Gstr2bComplianceRecord | Record<string, any>,
): string | null {
  const pan = normalizePan(record.pan);
  if (pan) {
    return pan;
  }

  const gstin = String(record.gstin ?? record.gstNo ?? '')
    .trim()
    .toUpperCase();
  if (gstin.length >= 12) {
    return gstin.substring(2, 12);
  }
  return null;
}

export function getGstr2bRecordsForPan(
  records: Array<Gstr2bComplianceRecord | Record<string, any>>,
  pan: string,
): Array<Gstr2bComplianceRecord | Record<string, any>> {
  return records.filter((record) => getGstr2bRecordPan(record) === pan);
}

export function computePrimaryGstr2bAggregationMetrics(
  records: Array<Gstr2bComplianceRecord | Record<string, any>>,
): PrimaryGstr2bAggregationMetrics {
  const summary = computePanSummary(records);
  return {
    PRIMARY_TOTAL_SUPPLIER_COUNT: summary.totalSupplierCount,
    PRIMARY_SUPPLIER_TOTAL_ELIGIBLE_ITC: round2(summary.totalEligibleItc),
    PRIMARY_SUPPLIER_TOTAL_INELIGIBLE_ITC: round2(summary.totalIneligibleItc),
    PRIMARY_SUPPLIER_TOTAL_REVERSED_ITC: round2(summary.totalReversedItc),
    PRIMARY_SUPPLIER_IGST_ITC: round2(summary.igstItc),
    PRIMARY_SUPPLIER_CGST_ITC: round2(summary.cgstItc),
    PRIMARY_SUPPLIER_SGST_ITC: round2(summary.sgstItc),
    PRIMARY_SUPPLIER_CESS_ITC: round2(summary.cessItc),
    PRIMARY_TOTAL_INVOICE_COUNT: summary.totalInvoiceCount,
    PRIMARY_ELIGIBLE_INVOICE_COUNT: summary.eligibleInvoiceCount,
    PRIMARY_INELIGIBLE_INVOICE_COUNT: summary.ineligibleInvoiceCount,
  };
}

/**
 * Total inward purchase taxable value (txval) from one or more GSTR-2B docs.
 * Prefer invoice-level `txval` / `taxable_value` (not tax amounts / ITC).
 */
export function computeGstr2bPurchaseTaxableValue(
  records: Array<Gstr2bComplianceRecord | Record<string, any>>,
): number {
  let total = 0;
  for (const record of records) {
    const payload = (record.gstr2bResponse ?? record) as Record<string, any>;
    const structured = sumStructuredGstr2bTaxableValue(payload);
    if (structured > 0) {
      total += structured;
    } else {
      total += sumInvoiceLevelTaxableValue(payload);
    }
  }
  return round2(total);
}

function sumStructuredGstr2bTaxableValue(payload: Record<string, any>): number {
  const roots = [
    payload?.data?.docdata,
    payload?.docdata,
    payload?.data?.data?.docdata,
    payload?.data,
    payload,
  ].filter(Boolean);

  let total = 0;
  for (const root of roots) {
    if (!root || typeof root !== 'object') continue;
    const r = root as Record<string, any>;
    // B2B invoices
    for (const supplier of asArray(r.b2b)) {
      total += sumTxvalOnList(asArray(supplier?.inv ?? supplier?.invoices));
    }
    // Credit/debit notes
    for (const supplier of asArray(r.cdnr ?? r.cdn)) {
      for (const note of asArray(supplier?.nt ?? supplier?.inv)) {
        const txval = pickTaxableValue(note);
        const kind = String(
          note?.ntty ?? note?.note_type ?? note?.type ?? '',
        )
          .trim()
          .toUpperCase();
        if (kind === 'C' || kind === 'CR' || kind.includes('CREDIT')) {
          total -= txval;
        } else {
          total += txval;
        }
      }
    }
    // B2BA amendments
    for (const supplier of asArray(r.b2ba)) {
      total += sumTxvalOnList(asArray(supplier?.inv));
    }
    // ISD / IMPG / IMPGSEZ if present with txval
    for (const key of ['isd', 'impg', 'impgsez', 'eco']) {
      for (const row of asArray(r[key])) {
        total += pickTaxableValue(row);
        total += sumTxvalOnList(asArray(row?.inv ?? row?.nt));
      }
    }
  }
  return round2(total);
}

function sumInvoiceLevelTaxableValue(payload: unknown): number {
  let total = 0;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, any>;
    const hasInvoiceId = Boolean(
      pickString(
        obj,
        'invoiceNumber',
        'invoice_number',
        'invoice_no',
        'inum',
        'inv_num',
        'ntnum',
        'note_number',
      ),
    );
    const txval = pickTaxableValue(obj);
    if (hasInvoiceId && txval) {
      total += txval;
    }
    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object') visit(value);
    }
  };
  visit(payload);
  return round2(total);
}

function sumTxvalOnList(rows: Array<Record<string, any>>): number {
  return rows.reduce((sum, row) => sum + pickTaxableValue(row), 0);
}

function pickTaxableValue(obj: Record<string, any> | null | undefined): number {
  if (!obj || typeof obj !== 'object') return 0;
  return pickNumber(
    obj,
    'txval',
    'taxable_value',
    'taxableValue',
    'taxable_val',
    'taxval',
    'ttl_txval',
    'total_taxable_value',
    'totalTaxableValue',
  );
}

function asArray(value: unknown): Array<Record<string, any>> {
  if (Array.isArray(value)) {
    return value.filter((v) => v && typeof v === 'object') as Array<
      Record<string, any>
    >;
  }
  if (value && typeof value === 'object') {
    return [value as Record<string, any>];
  }
  return [];
}

/**
 * Per coapplicant-entity PAN metrics from that PAN's GSTR-2B docs.
 */
export function computeCoapplicantEntityPanSupplierMetrics(
  panRecords: Array<Gstr2bComplianceRecord | Record<string, any>>,
): CoapplicantEntityPanSupplierMetrics {
  return computePanSummary(panRecords);
}

/**
 * Loan-level COAPPLICANT_* supplier metrics:
 *
 * 1. For each coapplicant-entity PAN (non-empty), compute entity-level metrics
 *    from that PAN's GSTR-2B records on the loan.
 * 2. SUM those entity-level values across all coapplicant-entity PANs for the
 *    same associated_loan_id.
 */
export function computeLoanLevelCoapplicantSupplierMetrics(
  coapplicantEntityPans: string[],
  loanGstr2bRecords: Array<Gstr2bComplianceRecord | Record<string, any>>,
): CoapplicantSupplierGstr2bAggregationMetrics {
  const empty: CoapplicantSupplierGstr2bAggregationMetrics = {
    COAPPLICANT_TOTAL_SUPPLIER_COUNT: 0,
    COAPPLICANT_SUPPLIER_TOTAL_INELIGIBLE_ITC: 0,
    COAPPLICANT_SUPPLIER_TOTAL_REVERSED_ITC: 0,
    COAPPLICANT_SUPPLIER_TOTAL_ELIGIBLE_ITC: 0,
    COAPPLICANT_SUPPLIER_TOTAL_INVOICE_COUNT: 0,
    COAPPLICANT_SUPPLIER_ELIGIBLE_INVOICE_COUNT: 0,
    COAPPLICANT_SUPPLIER_INELIGIBLE_INVOICE_COUNT: 0,
    COAPPLICANT_SUPPLIER_IGST_ITC: 0,
    COAPPLICANT_SUPPLIER_CGST_ITC: 0,
    COAPPLICANT_SUPPLIER_SGST_ITC: 0,
    COAPPLICANT_SUPPLIER_CESS_ITC: 0,
  };

  const pans = Array.from(
    new Set(
      coapplicantEntityPans
        .map((pan) => normalizePan(pan))
        .filter((pan): pan is string => Boolean(pan)),
    ),
  );

  if (pans.length === 0) {
    return empty;
  }

  // Prefer COAPPLICANT_ENTITY (or legacy CONSIDERED_ENTITY) docs when entityType is present.
  const coapplicantScopedRecords = loanGstr2bRecords.filter((record) => {
    const entityType = String(record.entityType ?? '')
      .trim()
      .toUpperCase();
    return !entityType || isCoapplicantEntityType(entityType);
  });

  let totalSupplierCount = 0;
  let totalIneligibleItc = 0;
  let totalReversedItc = 0;
  let totalEligibleItc = 0;
  let totalInvoiceCount = 0;
  let eligibleInvoiceCount = 0;
  let ineligibleInvoiceCount = 0;
  let igstItc = 0;
  let cgstItc = 0;
  let sgstItc = 0;
  let cessItc = 0;

  for (const pan of pans) {
    const panRecords = getGstr2bRecordsForPan(coapplicantScopedRecords, pan);
    const entityMetrics = computeCoapplicantEntityPanSupplierMetrics(panRecords);

    // SUM(COUNT(DISTINCT supplier_gstin ...)) across coapplicant-entity PANs
    totalSupplierCount += entityMetrics.totalSupplierCount;
    // SUM(ineligible_itc / reversed_itc / eligible_itc / tax ITCs) across PANs
    totalIneligibleItc += entityMetrics.totalIneligibleItc;
    totalReversedItc += entityMetrics.totalReversedItc;
    totalEligibleItc += entityMetrics.totalEligibleItc;
    // SUM(COUNT(invoice_number ...)) / eligible / ineligible across PANs
    totalInvoiceCount += entityMetrics.totalInvoiceCount;
    eligibleInvoiceCount += entityMetrics.eligibleInvoiceCount;
    ineligibleInvoiceCount += entityMetrics.ineligibleInvoiceCount;
    igstItc += entityMetrics.igstItc;
    cgstItc += entityMetrics.cgstItc;
    sgstItc += entityMetrics.sgstItc;
    cessItc += entityMetrics.cessItc;
  }

  return {
    COAPPLICANT_TOTAL_SUPPLIER_COUNT: totalSupplierCount,
    COAPPLICANT_SUPPLIER_TOTAL_INELIGIBLE_ITC: round2(totalIneligibleItc),
    COAPPLICANT_SUPPLIER_TOTAL_REVERSED_ITC: round2(totalReversedItc),
    COAPPLICANT_SUPPLIER_TOTAL_ELIGIBLE_ITC: round2(totalEligibleItc),
    COAPPLICANT_SUPPLIER_TOTAL_INVOICE_COUNT: totalInvoiceCount,
    COAPPLICANT_SUPPLIER_ELIGIBLE_INVOICE_COUNT: eligibleInvoiceCount,
    COAPPLICANT_SUPPLIER_INELIGIBLE_INVOICE_COUNT: ineligibleInvoiceCount,
    COAPPLICANT_SUPPLIER_IGST_ITC: round2(igstItc),
    COAPPLICANT_SUPPLIER_CGST_ITC: round2(cgstItc),
    COAPPLICANT_SUPPLIER_SGST_ITC: round2(sgstItc),
    COAPPLICANT_SUPPLIER_CESS_ITC: round2(cessItc),
  };
}

/** @deprecated Prefer computeLoanLevelCoapplicantSupplierMetrics */
export function computeLoanLevelConsideredSupplierMetrics(
  coapplicantEntityPans: string[],
  loanGstr2bRecords: Array<Gstr2bComplianceRecord | Record<string, any>>,
): CoapplicantSupplierGstr2bAggregationMetrics {
  return computeLoanLevelCoapplicantSupplierMetrics(
    coapplicantEntityPans,
    loanGstr2bRecords,
  );
}

/** @deprecated Prefer computeLoanLevelCoapplicantSupplierMetrics */
export function computeConsideredGstr2bAggregationMetricsForPans(
  pans: string[],
  allRecords: Array<Gstr2bComplianceRecord | Record<string, any>>,
): CoapplicantSupplierGstr2bAggregationMetrics {
  return computeLoanLevelCoapplicantSupplierMetrics(pans, allRecords);
}

/** @deprecated Prefer computeLoanLevelCoapplicantSupplierMetrics for loan roll-up */
export function computeCoapplicantGstr2bAggregationMetrics(
  records: Array<Gstr2bComplianceRecord | Record<string, any>>,
): CoapplicantSupplierGstr2bAggregationMetrics {
  const summary = computePanSummary(records);
  return {
    COAPPLICANT_TOTAL_SUPPLIER_COUNT: summary.totalSupplierCount,
    COAPPLICANT_SUPPLIER_TOTAL_INELIGIBLE_ITC: round2(summary.totalIneligibleItc),
    COAPPLICANT_SUPPLIER_TOTAL_REVERSED_ITC: round2(summary.totalReversedItc),
    COAPPLICANT_SUPPLIER_TOTAL_ELIGIBLE_ITC: round2(summary.totalEligibleItc),
    COAPPLICANT_SUPPLIER_TOTAL_INVOICE_COUNT: summary.totalInvoiceCount,
    COAPPLICANT_SUPPLIER_ELIGIBLE_INVOICE_COUNT: summary.eligibleInvoiceCount,
    COAPPLICANT_SUPPLIER_INELIGIBLE_INVOICE_COUNT: summary.ineligibleInvoiceCount,
    COAPPLICANT_SUPPLIER_IGST_ITC: round2(summary.igstItc),
    COAPPLICANT_SUPPLIER_CGST_ITC: round2(summary.cgstItc),
    COAPPLICANT_SUPPLIER_SGST_ITC: round2(summary.sgstItc),
    COAPPLICANT_SUPPLIER_CESS_ITC: round2(summary.cessItc),
  };
}

/**
 * Entity/PAN-level supplier metric facts from GSTR-2B invoice payload.
 * - TOTAL_SUPPLIER_COUNT = COUNT(DISTINCT supplier_gstin)
 * - invoice counts = COUNT(DISTINCT invoice_number) [, filtered by eligibility]
 * - ITC amounts = SUM of extracted amount fields
 */
function computePanSummary(
  records: Array<Gstr2bComplianceRecord | Record<string, any>>,
): CoapplicantEntityPanSupplierMetrics {
  const facts = records.flatMap((record) =>
    extractInvoiceFacts(record.gstr2bResponse ?? record),
  );

  const suppliers = new Set<string>();
  const invoices = new Set<string>();
  const eligibleInvoices = new Set<string>();
  const ineligibleInvoices = new Set<string>();

  let totalEligibleItc = 0;
  let totalIneligibleItc = 0;
  let totalReversedItc = 0;
  let igstItc = 0;
  let cgstItc = 0;
  let sgstItc = 0;
  let cessItc = 0;

  for (const fact of facts) {
    if (fact.supplierGstin) {
      suppliers.add(fact.supplierGstin);
    }
    if (fact.invoiceNumber) {
      invoices.add(fact.invoiceNumber);
      if (fact.itcEligibility === 'ELIGIBLE') {
        eligibleInvoices.add(fact.invoiceNumber);
      }
      if (fact.itcEligibility === 'INELIGIBLE') {
        ineligibleInvoices.add(fact.invoiceNumber);
      }
    }

    totalEligibleItc += fact.eligibleItc;
    totalIneligibleItc += fact.ineligibleItc;
    totalReversedItc += fact.itcReversed;
    igstItc += fact.igstItc;
    cgstItc += fact.cgstItc;
    sgstItc += fact.sgstItc;
    cessItc += fact.cessItc;
  }

  return {
    totalSupplierCount: suppliers.size,
    totalEligibleItc,
    totalIneligibleItc,
    totalReversedItc,
    igstItc,
    cgstItc,
    sgstItc,
    cessItc,
    totalInvoiceCount: invoices.size,
    eligibleInvoiceCount: eligibleInvoices.size,
    ineligibleInvoiceCount: ineligibleInvoices.size,
  };
}

function extractInvoiceFacts(payload: Record<string, any>): InvoiceMetricFact[] {
  const facts: InvoiceMetricFact[] = [];

  const visit = (node: unknown, context: TraversalContext): void => {
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item, context);
      }
      return;
    }
    if (!node || typeof node !== 'object') {
      return;
    }

    const obj = node as Record<string, any>;
    const supplierGstin =
      normalizeGstin(
        pickString(
          obj,
          'supplierGstin',
          'supplier_gstin',
          'supplierGSTIN',
          'ctin',
          'gstin',
        ),
      ) ?? context.supplierGstin;

    const invoiceNumber =
      normalizeInvoiceNumber(
        pickString(
          obj,
          'invoiceNumber',
          'invoice_number',
          'invoice_no',
          'inum',
          'inv_num',
        ),
      ) ?? context.invoiceNumber;

    const eligibility =
      normalizeEligibility(
        pickString(
          obj,
          'itcEligibility',
          'itc_eligibility',
          'itc_avl',
          'eligibility',
          'itc_status',
        ),
      ) ?? context.itcEligibility;

    const eligibleItc = pickNumber(
      obj,
      'eligibleItc',
      'eligible_itc',
      'itc_eligible',
      'elg_itc',
      'eligible',
    );
    const ineligibleItc = pickNumber(
      obj,
      'ineligibleItc',
      'ineligible_itc',
      'itc_ineligible',
      'inelig_itc',
      'ineligible',
    );
    const reversedItc = pickNumber(
      obj,
      'itcReversed',
      'itc_reversed',
      'reversed_itc',
      'reversal',
    );

    let igst = pickNumber(obj, 'igst', 'igstItc', 'igst_itc', 'iamt');
    let cgst = pickNumber(obj, 'cgst', 'cgstItc', 'cgst_itc', 'camt');
    let sgst = pickNumber(obj, 'sgst', 'sgstItc', 'sgst_itc', 'samt');
    let cess = pickNumber(obj, 'cess', 'cessItc', 'cess_itc', 'csamt');

    const taxType = String(
      pickString(obj, 'taxType', 'tax_type', 'type', 'itc_type') ?? '',
    )
      .trim()
      .toUpperCase();
    const taxAmount = pickNumber(
      obj,
      'itcSummaryAmount',
      'itc_summary_amount',
      'amount',
      'amt',
      'value',
    );
    if (taxType && taxAmount) {
      if (taxType === 'IGST') igst += taxAmount;
      else if (taxType === 'CGST') cgst += taxAmount;
      else if (taxType === 'SGST') sgst += taxAmount;
      else if (taxType === 'CESS') cess += taxAmount;
    }

    if (
      supplierGstin ||
      invoiceNumber ||
      eligibility ||
      eligibleItc ||
      ineligibleItc ||
      reversedItc ||
      igst ||
      cgst ||
      sgst ||
      cess
    ) {
      facts.push({
        supplierGstin,
        invoiceNumber,
        itcEligibility: eligibility,
        eligibleItc,
        ineligibleItc,
        itcReversed: reversedItc,
        igstItc: igst,
        cgstItc: cgst,
        sgstItc: sgst,
        cessItc: cess,
      });
    }

    const nextContext: TraversalContext = {
      supplierGstin,
      invoiceNumber,
      itcEligibility: eligibility,
    };
    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object') {
        visit(value, nextContext);
      }
    }
  };

  visit(payload, {
    supplierGstin: null,
    invoiceNumber: null,
    itcEligibility: null,
  });

  return facts;
}

function pickString(obj: Record<string, any>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function pickNumber(obj: Record<string, any>, ...keys: string[]): number {
  for (const key of keys) {
    const value = obj[key];
    if (value === null || value === undefined || value === '') {
      continue;
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return 0;
}

function normalizeGstin(raw: string | null): string | null {
  if (!raw) return null;
  const gstin = raw.trim().toUpperCase();
  return gstin || null;
}

function normalizeInvoiceNumber(raw: string | null): string | null {
  if (!raw) return null;
  return raw.trim().toUpperCase() || null;
}

function normalizeEligibility(raw: string | null): 'ELIGIBLE' | 'INELIGIBLE' | null {
  if (!raw) return null;
  const value = raw.trim().toUpperCase();
  if (!value) return null;
  if (value.includes('INELIGIBLE')) return 'INELIGIBLE';
  if (value.includes('ELIGIBLE')) return 'ELIGIBLE';
  if (value === 'Y' || value === 'YES') return 'ELIGIBLE';
  if (value === 'N' || value === 'NO') return 'INELIGIBLE';
  return null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
