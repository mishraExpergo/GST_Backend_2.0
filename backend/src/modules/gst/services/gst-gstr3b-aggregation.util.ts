import { Gstr3bComplianceRecord } from '../schemas/gst-gstr3b-compliance.schema';

export interface PrimaryGstr3bAggregationMetrics {
  PRIMARY_TOTAL_TURNOVER: number;
  PRIMARY_TOTAL_TAXABLE_TURNOVER: number;
  PRIMARY_TOTAL_EXEMPT_TURNOVER: number;
  PRIMARY_TOTAL_REVERSE_CHARGE_SALES: number;
  PRIMARY_TOTAL_PURCHASE_VALUE: number;
  PRIMARY_TOTAL_INTERSTATE_PURCHASES: number;
  PRIMARY_TOTAL_INTRASTATE_PURCHASES: number;
  PRIMARY_TOTAL_NON_GST_PURCHASES: number;
  PRIMARY_TOTAL_ITC_AVAILABLE: number;
  PRIMARY_TOTAL_CGST_ITC: number;
  PRIMARY_TOTAL_SGST_ITC: number;
  PRIMARY_TOTAL_IGST_ITC: number;
  PRIMARY_TOTAL_ITC_REVERSED: number;
  PRIMARY_TOTAL_INELIGIBLE_ITC: number;
  PRIMARY_TOTAL_ITC_UTILISED: number;
  PRIMARY_TOTAL_CGST_ITC_UTILISED: number;
  PRIMARY_TOTAL_SGST_ITC_UTILISED: number;
  PRIMARY_TOTAL_IGST_ITC_UTILISED: number;
  PRIMARY_TOTAL_CASH_TAX_PAID: number;
  PRIMARY_TOTAL_CASH_CGST_PAID: number;
  PRIMARY_TOTAL_CASH_SGST_PAID: number;
  PRIMARY_TOTAL_CASH_IGST_PAID: number;
}

export interface SecondaryGstr3bAggregationMetrics {
  CONSIDERED_TOTAL_TURNOVER: number;
  CONSIDERED_TOTAL_TAXABLE_TURNOVER: number;
  CONSIDERED_TOTAL_EXEMPT_TURNOVER: number;
  CONSIDERED_TOTAL_REVERSE_CHARGE_SALES: number;
  CONSIDERED_TOTAL_PURCHASE_VALUE: number;
  CONSIDERED_TOTAL_INTERSTATE_PURCHASES: number;
  CONSIDERED_TOTAL_INTRASTATE_PURCHASES: number;
  CONSIDERED_TOTAL_NON_GST_PURCHASES: number;
  CONSIDERED_TOTAL_ITC_AVAILABLE: number;
  CONSIDERED_TOTAL_CGST_ITC: number;
  CONSIDERED_TOTAL_SGST_ITC: number;
  CONSIDERED_TOTAL_IGST_ITC: number;
  CONSIDERED_TOTAL_ITC_REVERSED: number;
  CONSIDERED_TOTAL_INELIGIBLE_ITC: number;
  CONSIDERED_TOTAL_ITC_UTILISED: number;
  CONSIDERED_TOTAL_CGST_ITC_UTILISED: number;
  CONSIDERED_TOTAL_SGST_ITC_UTILISED: number;
  CONSIDERED_TOTAL_IGST_ITC_UTILISED: number;
  CONSIDERED_TOTAL_CASH_TAX_PAID: number;
  CONSIDERED_TOTAL_CASH_CGST_PAID: number;
  CONSIDERED_TOTAL_CASH_SGST_PAID: number;
  CONSIDERED_TOTAL_CASH_IGST_PAID: number;
}

export function normalizePan(pan: string | null | undefined): string | null {
  const normalized = (pan ?? '').trim().toUpperCase();
  return normalized || null;
}

export function getGstr3bRecordPan(
  record: Gstr3bComplianceRecord | Record<string, any>,
): string | null {
  const pan = normalizePan(record.pan);
  if (pan) return pan;

  const gstin = String(record.gstin ?? record.gstNo ?? '')
    .trim()
    .toUpperCase();
  if (gstin.length >= 12) return gstin.substring(2, 12);
  return null;
}

export function getGstr3bRecordsForPan(
  records: Array<Gstr3bComplianceRecord | Record<string, any>>,
  pan: string,
): Array<Gstr3bComplianceRecord | Record<string, any>> {
  return records.filter((record) => getGstr3bRecordPan(record) === pan);
}

export function computePrimaryGstr3bAggregationMetrics(
  records: Array<Gstr3bComplianceRecord | Record<string, any>>,
): PrimaryGstr3bAggregationMetrics {
  const summary = computeSummary(records);
  return {
    PRIMARY_TOTAL_TURNOVER: summary.totalTurnover,
    PRIMARY_TOTAL_TAXABLE_TURNOVER: summary.totalTaxableTurnover,
    PRIMARY_TOTAL_EXEMPT_TURNOVER: summary.totalExemptTurnover,
    PRIMARY_TOTAL_REVERSE_CHARGE_SALES: summary.totalReverseChargeSales,
    PRIMARY_TOTAL_PURCHASE_VALUE: summary.totalPurchaseValue,
    PRIMARY_TOTAL_INTERSTATE_PURCHASES: summary.totalInterstatePurchases,
    PRIMARY_TOTAL_INTRASTATE_PURCHASES: summary.totalIntrastatePurchases,
    PRIMARY_TOTAL_NON_GST_PURCHASES: summary.totalNonGstPurchases,
    PRIMARY_TOTAL_ITC_AVAILABLE: summary.totalItcAvailable,
    PRIMARY_TOTAL_CGST_ITC: summary.totalCgstItc,
    PRIMARY_TOTAL_SGST_ITC: summary.totalSgstItc,
    PRIMARY_TOTAL_IGST_ITC: summary.totalIgstItc,
    PRIMARY_TOTAL_ITC_REVERSED: summary.totalItcReversed,
    PRIMARY_TOTAL_INELIGIBLE_ITC: summary.totalIneligibleItc,
    PRIMARY_TOTAL_ITC_UTILISED: summary.totalItcUtilised,
    PRIMARY_TOTAL_CGST_ITC_UTILISED: summary.totalCgstItcUtilised,
    PRIMARY_TOTAL_SGST_ITC_UTILISED: summary.totalSgstItcUtilised,
    PRIMARY_TOTAL_IGST_ITC_UTILISED: summary.totalIgstItcUtilised,
    PRIMARY_TOTAL_CASH_TAX_PAID: summary.totalCashTaxPaid,
    PRIMARY_TOTAL_CASH_CGST_PAID: summary.totalCashCgstPaid,
    PRIMARY_TOTAL_CASH_SGST_PAID: summary.totalCashSgstPaid,
    PRIMARY_TOTAL_CASH_IGST_PAID: summary.totalCashIgstPaid,
  };
}

export function computeSecondaryGstr3bAggregationMetrics(
  records: Array<Gstr3bComplianceRecord | Record<string, any>>,
): SecondaryGstr3bAggregationMetrics {
  const summary = computeSummary(records);
  return {
    CONSIDERED_TOTAL_TURNOVER: summary.totalTurnover,
    CONSIDERED_TOTAL_TAXABLE_TURNOVER: summary.totalTaxableTurnover,
    CONSIDERED_TOTAL_EXEMPT_TURNOVER: summary.totalExemptTurnover,
    CONSIDERED_TOTAL_REVERSE_CHARGE_SALES: summary.totalReverseChargeSales,
    CONSIDERED_TOTAL_PURCHASE_VALUE: summary.totalPurchaseValue,
    CONSIDERED_TOTAL_INTERSTATE_PURCHASES: summary.totalInterstatePurchases,
    CONSIDERED_TOTAL_INTRASTATE_PURCHASES: summary.totalIntrastatePurchases,
    CONSIDERED_TOTAL_NON_GST_PURCHASES: summary.totalNonGstPurchases,
    CONSIDERED_TOTAL_ITC_AVAILABLE: summary.totalItcAvailable,
    CONSIDERED_TOTAL_CGST_ITC: summary.totalCgstItc,
    CONSIDERED_TOTAL_SGST_ITC: summary.totalSgstItc,
    CONSIDERED_TOTAL_IGST_ITC: summary.totalIgstItc,
    CONSIDERED_TOTAL_ITC_REVERSED: summary.totalItcReversed,
    CONSIDERED_TOTAL_INELIGIBLE_ITC: summary.totalIneligibleItc,
    CONSIDERED_TOTAL_ITC_UTILISED: summary.totalItcUtilised,
    CONSIDERED_TOTAL_CGST_ITC_UTILISED: summary.totalCgstItcUtilised,
    CONSIDERED_TOTAL_SGST_ITC_UTILISED: summary.totalSgstItcUtilised,
    CONSIDERED_TOTAL_IGST_ITC_UTILISED: summary.totalIgstItcUtilised,
    CONSIDERED_TOTAL_CASH_TAX_PAID: summary.totalCashTaxPaid,
    CONSIDERED_TOTAL_CASH_CGST_PAID: summary.totalCashCgstPaid,
    CONSIDERED_TOTAL_CASH_SGST_PAID: summary.totalCashSgstPaid,
    CONSIDERED_TOTAL_CASH_IGST_PAID: summary.totalCashIgstPaid,
  };
}

function computeSummary(
  records: Array<Gstr3bComplianceRecord | Record<string, any>>,
): {
  totalTurnover: number;
  totalTaxableTurnover: number;
  totalExemptTurnover: number;
  totalReverseChargeSales: number;
  totalPurchaseValue: number;
  totalInterstatePurchases: number;
  totalIntrastatePurchases: number;
  totalNonGstPurchases: number;
  totalItcAvailable: number;
  totalCgstItc: number;
  totalSgstItc: number;
  totalIgstItc: number;
  totalItcReversed: number;
  totalIneligibleItc: number;
  totalItcUtilised: number;
  totalCgstItcUtilised: number;
  totalSgstItcUtilised: number;
  totalIgstItcUtilised: number;
  totalCashTaxPaid: number;
  totalCashCgstPaid: number;
  totalCashSgstPaid: number;
  totalCashIgstPaid: number;
} {
  let taxableSuppliesNormalAmount = 0;
  let zeroRatedNilExemptAmount = 0;
  let reverseChargeSuppliesAmount = 0;
  let taxableSuppliesAmount = 0;
  let exemptAmount = 0;

  let interStatePurchaseAmount = 0;
  let intraStatePurchaseAmount = 0;
  let nonGstPurchaseAmount = 0;

  let inputTaxCreditCgstAmount = 0;
  let inputTaxCreditSgstAmount = 0;
  let inputTaxCreditIgstAmount = 0;
  let inputTaxCreditReversedAmount = 0;
  let inputTaxCreditIneligibleAmount = 0;

  let cgstItcUtilisedAmount = 0;
  let sgstItcUtilisedAmount = 0;
  let igstItcUtilisedAmount = 0;

  let cgstCashPaidAmount = 0;
  let sgstCashPaidAmount = 0;
  let igstCashPaidAmount = 0;

  for (const record of records) {
    const payload = (record.gstr3bResponse ?? record) as Record<string, any>;
    const allFacts = collectNumericFacts(payload);

    taxableSuppliesNormalAmount += sumForAliases(
      allFacts,
      'taxable_supplies_normal_amount',
      'taxableSuppliesNormalAmount',
      'taxable_supplies_normal',
      'taxableSuppliesNormal',
    );
    zeroRatedNilExemptAmount += sumForAliases(
      allFacts,
      'zero_rated_nil_exempt_amount',
      'zeroRatedNilExemptAmount',
      'zero_rated_nil_exempt_supplies_amount',
      'zeroRatedNilExemptSuppliesAmount',
      'zero_rated_nil_exempt',
      'zeroRatedNilExempt',
    );
    reverseChargeSuppliesAmount += sumForAliases(
      allFacts,
      'reverse_charge_supplies_amount',
      'reverseChargeSuppliesAmount',
      'reverse_charge_sales_amount',
      'reverseChargeSalesAmount',
    );
    taxableSuppliesAmount += sumForAliases(
      allFacts,
      'taxable_supplies_amount',
      'taxableSuppliesAmount',
      'total_taxable_turnover_value',
      'totalTaxableTurnoverValue',
    );
    exemptAmount += sumForAliases(
      allFacts,
      'exempt_amount',
      'exemptAmount',
      'zero_rated_nil_exempt_amount',
      'zeroRatedNilExemptAmount',
      'exempt_turnover',
      'exemptTurnover',
    );

    interStatePurchaseAmount += sumForAliases(
      allFacts,
      'inter_state_purchase_amount',
      'interStatePurchaseAmount',
      'interstate_purchase_amount',
      'interstatePurchasesAmount',
    );
    intraStatePurchaseAmount += sumForAliases(
      allFacts,
      'intra_state_purchase_amount',
      'intraStatePurchaseAmount',
      'intrastate_purchase_amount',
      'intrastatePurchasesAmount',
    );
    nonGstPurchaseAmount += sumForAliases(
      allFacts,
      'non_gst_purchase_amount',
      'nonGstPurchaseAmount',
      'nongst_purchase_amount',
      'nonGstPurchasesAmount',
    );

    inputTaxCreditCgstAmount += sumForAliases(
      allFacts,
      'input_tax_credit_cgst_amount',
      'inputTaxCreditCgstAmount',
      'cgst_itc_amount',
      'cgstItcAmount',
    );
    inputTaxCreditSgstAmount += sumForAliases(
      allFacts,
      'input_tax_credit_sgst_amount',
      'inputTaxCreditSgstAmount',
      'sgst_itc_amount',
      'sgstItcAmount',
    );
    inputTaxCreditIgstAmount += sumForAliases(
      allFacts,
      'input_tax_credit_igst_amount',
      'inputTaxCreditIgstAmount',
      'igst_itc_amount',
      'igstItcAmount',
    );
    inputTaxCreditReversedAmount += sumForAliases(
      allFacts,
      'input_tax_credit_reversed_amount',
      'inputTaxCreditReversedAmount',
      'itc_reversed_amount',
      'itcReversedAmount',
    );
    inputTaxCreditIneligibleAmount += sumForAliases(
      allFacts,
      'input_tax_credit_ineligible_amount',
      'inputTaxCreditIneligibleAmount',
      'ineligible_itc_amount',
      'ineligibleItcAmount',
    );

    cgstItcUtilisedAmount += sumForAliases(
      allFacts,
      'cgst_itc_utilised_amount',
      'cgstItcUtilisedAmount',
    );
    sgstItcUtilisedAmount += sumForAliases(
      allFacts,
      'sgst_itc_utilised_amount',
      'sgstItcUtilisedAmount',
    );
    igstItcUtilisedAmount += sumForAliases(
      allFacts,
      'igst_itc_utilised_amount',
      'igstItcUtilisedAmount',
    );

    cgstCashPaidAmount +=
      sumForAliases(allFacts, 'cgst_cash_paid_amount', 'cgstCashPaidAmount') +
      sumCashByTaxType(allFacts, 'CGST');
    sgstCashPaidAmount +=
      sumForAliases(allFacts, 'sgst_cash_paid_amount', 'sgstCashPaidAmount') +
      sumCashByTaxType(allFacts, 'SGST');
    igstCashPaidAmount +=
      sumForAliases(allFacts, 'igst_cash_paid_amount', 'igstCashPaidAmount') +
      sumCashByTaxType(allFacts, 'IGST');
  }

  const totalTurnover =
    taxableSuppliesNormalAmount + zeroRatedNilExemptAmount + reverseChargeSuppliesAmount;
  const totalPurchaseValue =
    interStatePurchaseAmount + intraStatePurchaseAmount + nonGstPurchaseAmount;
  const totalItcAvailable =
    inputTaxCreditCgstAmount + inputTaxCreditSgstAmount + inputTaxCreditIgstAmount;
  const totalItcUtilised =
    cgstItcUtilisedAmount + sgstItcUtilisedAmount + igstItcUtilisedAmount;
  const totalCashTaxPaid =
    cgstCashPaidAmount + sgstCashPaidAmount + igstCashPaidAmount;

  return {
    totalTurnover: round2(totalTurnover),
    totalTaxableTurnover: round2(taxableSuppliesAmount),
    totalExemptTurnover: round2(exemptAmount),
    totalReverseChargeSales: round2(reverseChargeSuppliesAmount),
    totalPurchaseValue: round2(totalPurchaseValue),
    totalInterstatePurchases: round2(interStatePurchaseAmount),
    totalIntrastatePurchases: round2(intraStatePurchaseAmount),
    totalNonGstPurchases: round2(nonGstPurchaseAmount),
    totalItcAvailable: round2(totalItcAvailable),
    totalCgstItc: round2(inputTaxCreditCgstAmount),
    totalSgstItc: round2(inputTaxCreditSgstAmount),
    totalIgstItc: round2(inputTaxCreditIgstAmount),
    totalItcReversed: round2(inputTaxCreditReversedAmount),
    totalIneligibleItc: round2(inputTaxCreditIneligibleAmount),
    totalItcUtilised: round2(totalItcUtilised),
    totalCgstItcUtilised: round2(cgstItcUtilisedAmount),
    totalSgstItcUtilised: round2(sgstItcUtilisedAmount),
    totalIgstItcUtilised: round2(igstItcUtilisedAmount),
    totalCashTaxPaid: round2(totalCashTaxPaid),
    totalCashCgstPaid: round2(cgstCashPaidAmount),
    totalCashSgstPaid: round2(sgstCashPaidAmount),
    totalCashIgstPaid: round2(igstCashPaidAmount),
  };
}

interface NumericFact {
  key: string;
  value: number;
  taxType: string | null;
}

function collectNumericFacts(payload: unknown): NumericFact[] {
  const facts: NumericFact[] = [];

  const walk = (node: unknown, inheritedTaxType: string | null): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, inheritedTaxType);
      return;
    }
    if (!node || typeof node !== 'object') return;

    const obj = node as Record<string, any>;
    const taxType =
      normalizeTaxType(
        pickString(
          obj,
          'tax_type',
          'taxType',
          'type',
          'tax',
        ),
      ) ?? inheritedTaxType;

    for (const [rawKey, rawValue] of Object.entries(obj)) {
      if (rawValue === null || rawValue === undefined || rawValue === '') continue;

      if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
        facts.push({
          key: normalizeKey(rawKey),
          value: rawValue,
          taxType,
        });
      } else if (typeof rawValue === 'string') {
        const parsed = Number(rawValue);
        if (Number.isFinite(parsed) && rawValue.trim() !== '') {
          facts.push({
            key: normalizeKey(rawKey),
            value: parsed,
            taxType,
          });
        }
      }
    }

    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object') {
        walk(value, taxType);
      }
    }
  };

  walk(payload, null);
  return facts;
}

function sumForAliases(facts: NumericFact[], ...aliases: string[]): number {
  const aliasSet = new Set(aliases.map((k) => normalizeKey(k)));
  let total = 0;
  for (const fact of facts) {
    if (aliasSet.has(fact.key)) {
      total += fact.value;
    }
  }
  return total;
}

function sumCashByTaxType(facts: NumericFact[], taxType: 'CGST' | 'SGST' | 'IGST'): number {
  const cashAmountAliases = new Set(
    ['cash_paid_amount', 'cashPaidAmount', 'cash_paid', 'cashPaid'].map((k) =>
      normalizeKey(k),
    ),
  );

  let total = 0;
  for (const fact of facts) {
    if (cashAmountAliases.has(fact.key) && fact.taxType === taxType) {
      total += fact.value;
    }
  }
  return total;
}

function normalizeKey(key: string): string {
  return String(key)
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .toLowerCase();
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

function normalizeTaxType(raw: string | null): 'CGST' | 'SGST' | 'IGST' | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  if (upper === 'CGST') return 'CGST';
  if (upper === 'SGST') return 'SGST';
  if (upper === 'IGST') return 'IGST';
  return null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
