import { Gstr3bComplianceRecord } from '../schemas/gst-gstr3b-compliance.schema';

export interface PrimaryGstr3bAggregationMetrics {
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
  PRIMARY_TOTAL_CESS_ITC_UTILISED: number;
  PRIMARY_TOTAL_CASH_TAX_PAID: number;
  PRIMARY_TOTAL_CASH_CGST_PAID: number;
  PRIMARY_TOTAL_CASH_SGST_PAID: number;
  PRIMARY_TOTAL_CASH_IGST_PAID: number;
  PRIMARY_TOTAL_CASH_CESS_PAID: number;
}

export interface SecondaryGstr3bAggregationMetrics {
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
  CONSIDERED_TOTAL_CESS_ITC_UTILISED: number;
  CONSIDERED_TOTAL_CASH_TAX_PAID: number;
  CONSIDERED_TOTAL_CASH_CGST_PAID: number;
  CONSIDERED_TOTAL_CASH_SGST_PAID: number;
  CONSIDERED_TOTAL_CASH_IGST_PAID: number;
  CONSIDERED_TOTAL_CASH_CESS_PAID: number;
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
    PRIMARY_TOTAL_CESS_ITC_UTILISED: summary.totalCessItcUtilised,
    PRIMARY_TOTAL_CASH_TAX_PAID: summary.totalCashTaxPaid,
    PRIMARY_TOTAL_CASH_CGST_PAID: summary.totalCashCgstPaid,
    PRIMARY_TOTAL_CASH_SGST_PAID: summary.totalCashSgstPaid,
    PRIMARY_TOTAL_CASH_IGST_PAID: summary.totalCashIgstPaid,
    PRIMARY_TOTAL_CASH_CESS_PAID: summary.totalCashCessPaid,
  };
}

export function computeSecondaryGstr3bAggregationMetrics(
  records: Array<Gstr3bComplianceRecord | Record<string, any>>,
): SecondaryGstr3bAggregationMetrics {
  const summary = computeSummary(records);
  return {
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
    CONSIDERED_TOTAL_CESS_ITC_UTILISED: summary.totalCessItcUtilised,
    CONSIDERED_TOTAL_CASH_TAX_PAID: summary.totalCashTaxPaid,
    CONSIDERED_TOTAL_CASH_CGST_PAID: summary.totalCashCgstPaid,
    CONSIDERED_TOTAL_CASH_SGST_PAID: summary.totalCashSgstPaid,
    CONSIDERED_TOTAL_CASH_IGST_PAID: summary.totalCashIgstPaid,
    CONSIDERED_TOTAL_CASH_CESS_PAID: summary.totalCashCessPaid,
  };
}

/**
 * Loan-level CONSIDERED_* GSTR-3B metrics (Considered_GST_Metrics_Logic.xlsx):
 *
 * 1. For each Considered Entity PAN (non-empty), compute entity-level metrics
 *    from that PAN's GSTR-3B records on the loan.
 * 2. SUM those entity-level values across all Considered Entity PANs for the
 *    same associated_loan_id.
 */
export function computeLoanLevelConsideredGstr3bMetrics(
  consideredEntityPans: string[],
  loanGstr3bRecords: Array<Gstr3bComplianceRecord | Record<string, any>>,
): SecondaryGstr3bAggregationMetrics {
  const empty: SecondaryGstr3bAggregationMetrics = {
    CONSIDERED_TOTAL_TAXABLE_TURNOVER: 0,
    CONSIDERED_TOTAL_EXEMPT_TURNOVER: 0,
    CONSIDERED_TOTAL_REVERSE_CHARGE_SALES: 0,
    CONSIDERED_TOTAL_PURCHASE_VALUE: 0,
    CONSIDERED_TOTAL_INTERSTATE_PURCHASES: 0,
    CONSIDERED_TOTAL_INTRASTATE_PURCHASES: 0,
    CONSIDERED_TOTAL_NON_GST_PURCHASES: 0,
    CONSIDERED_TOTAL_ITC_AVAILABLE: 0,
    CONSIDERED_TOTAL_CGST_ITC: 0,
    CONSIDERED_TOTAL_SGST_ITC: 0,
    CONSIDERED_TOTAL_IGST_ITC: 0,
    CONSIDERED_TOTAL_ITC_REVERSED: 0,
    CONSIDERED_TOTAL_INELIGIBLE_ITC: 0,
    CONSIDERED_TOTAL_ITC_UTILISED: 0,
    CONSIDERED_TOTAL_CGST_ITC_UTILISED: 0,
    CONSIDERED_TOTAL_SGST_ITC_UTILISED: 0,
    CONSIDERED_TOTAL_IGST_ITC_UTILISED: 0,
    CONSIDERED_TOTAL_CESS_ITC_UTILISED: 0,
    CONSIDERED_TOTAL_CASH_TAX_PAID: 0,
    CONSIDERED_TOTAL_CASH_CGST_PAID: 0,
    CONSIDERED_TOTAL_CASH_SGST_PAID: 0,
    CONSIDERED_TOTAL_CASH_IGST_PAID: 0,
    CONSIDERED_TOTAL_CASH_CESS_PAID: 0,
  };

  const pans = Array.from(
    new Set(
      consideredEntityPans
        .map((pan) => normalizePan(pan))
        .filter((pan): pan is string => Boolean(pan)),
    ),
  );

  if (pans.length === 0) {
    return empty;
  }

  // Prefer CONSIDERED_ENTITY docs when entityType is present.
  const consideredScopedRecords = loanGstr3bRecords.filter((record) => {
    const entityType = String(record.entityType ?? '')
      .trim()
      .toUpperCase();
    return !entityType || entityType === 'CONSIDERED_ENTITY';
  });

  const totals = { ...empty };

  for (const pan of pans) {
    const panRecords = getGstr3bRecordsForPan(consideredScopedRecords, pan);
    const entityMetrics = computeSecondaryGstr3bAggregationMetrics(panRecords);

    totals.CONSIDERED_TOTAL_TAXABLE_TURNOVER +=
      entityMetrics.CONSIDERED_TOTAL_TAXABLE_TURNOVER;
    totals.CONSIDERED_TOTAL_EXEMPT_TURNOVER +=
      entityMetrics.CONSIDERED_TOTAL_EXEMPT_TURNOVER;
    totals.CONSIDERED_TOTAL_REVERSE_CHARGE_SALES +=
      entityMetrics.CONSIDERED_TOTAL_REVERSE_CHARGE_SALES;
    totals.CONSIDERED_TOTAL_PURCHASE_VALUE +=
      entityMetrics.CONSIDERED_TOTAL_PURCHASE_VALUE;
    totals.CONSIDERED_TOTAL_INTERSTATE_PURCHASES +=
      entityMetrics.CONSIDERED_TOTAL_INTERSTATE_PURCHASES;
    totals.CONSIDERED_TOTAL_INTRASTATE_PURCHASES +=
      entityMetrics.CONSIDERED_TOTAL_INTRASTATE_PURCHASES;
    totals.CONSIDERED_TOTAL_NON_GST_PURCHASES +=
      entityMetrics.CONSIDERED_TOTAL_NON_GST_PURCHASES;
    totals.CONSIDERED_TOTAL_ITC_AVAILABLE +=
      entityMetrics.CONSIDERED_TOTAL_ITC_AVAILABLE;
    totals.CONSIDERED_TOTAL_CGST_ITC += entityMetrics.CONSIDERED_TOTAL_CGST_ITC;
    totals.CONSIDERED_TOTAL_SGST_ITC += entityMetrics.CONSIDERED_TOTAL_SGST_ITC;
    totals.CONSIDERED_TOTAL_IGST_ITC += entityMetrics.CONSIDERED_TOTAL_IGST_ITC;
    totals.CONSIDERED_TOTAL_ITC_REVERSED +=
      entityMetrics.CONSIDERED_TOTAL_ITC_REVERSED;
    totals.CONSIDERED_TOTAL_INELIGIBLE_ITC +=
      entityMetrics.CONSIDERED_TOTAL_INELIGIBLE_ITC;
    totals.CONSIDERED_TOTAL_ITC_UTILISED +=
      entityMetrics.CONSIDERED_TOTAL_ITC_UTILISED;
    totals.CONSIDERED_TOTAL_CGST_ITC_UTILISED +=
      entityMetrics.CONSIDERED_TOTAL_CGST_ITC_UTILISED;
    totals.CONSIDERED_TOTAL_SGST_ITC_UTILISED +=
      entityMetrics.CONSIDERED_TOTAL_SGST_ITC_UTILISED;
    totals.CONSIDERED_TOTAL_IGST_ITC_UTILISED +=
      entityMetrics.CONSIDERED_TOTAL_IGST_ITC_UTILISED;
    totals.CONSIDERED_TOTAL_CESS_ITC_UTILISED +=
      entityMetrics.CONSIDERED_TOTAL_CESS_ITC_UTILISED;
    totals.CONSIDERED_TOTAL_CASH_TAX_PAID +=
      entityMetrics.CONSIDERED_TOTAL_CASH_TAX_PAID;
    totals.CONSIDERED_TOTAL_CASH_CGST_PAID +=
      entityMetrics.CONSIDERED_TOTAL_CASH_CGST_PAID;
    totals.CONSIDERED_TOTAL_CASH_SGST_PAID +=
      entityMetrics.CONSIDERED_TOTAL_CASH_SGST_PAID;
    totals.CONSIDERED_TOTAL_CASH_IGST_PAID +=
      entityMetrics.CONSIDERED_TOTAL_CASH_IGST_PAID;
    totals.CONSIDERED_TOTAL_CASH_CESS_PAID +=
      entityMetrics.CONSIDERED_TOTAL_CASH_CESS_PAID;
  }

  return totals;
}

function computeSummary(
  records: Array<Gstr3bComplianceRecord | Record<string, any>>,
): {
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
  totalCessItcUtilised: number;
  totalCashTaxPaid: number;
  totalCashCgstPaid: number;
  totalCashSgstPaid: number;
  totalCashIgstPaid: number;
  totalCashCessPaid: number;
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
  let cessItcUtilisedAmount = 0;

  let cgstCashPaidAmount = 0;
  let sgstCashPaidAmount = 0;
  let igstCashPaidAmount = 0;
  let cessCashPaidAmount = 0;

  // Structured extraction fallback for real Sandbox 3B payload shape.
  let structuredTaxableSuppliesNormalAmount = 0;
  let structuredZeroRatedNilExemptAmount = 0;
  let structuredReverseChargeSuppliesAmount = 0;
  let structuredTaxableSuppliesAmount = 0;
  let structuredExemptAmount = 0;
  let structuredInterStatePurchaseAmount = 0;
  let structuredIntraStatePurchaseAmount = 0;
  let structuredNonGstPurchaseAmount = 0;
  let structuredInputTaxCreditCgstAmount = 0;
  let structuredInputTaxCreditSgstAmount = 0;
  let structuredInputTaxCreditIgstAmount = 0;
  let structuredInputTaxCreditReversedAmount = 0;
  let structuredInputTaxCreditIneligibleAmount = 0;
  let structuredCgstItcUtilisedAmount = 0;
  let structuredSgstItcUtilisedAmount = 0;
  let structuredIgstItcUtilisedAmount = 0;
  let structuredCessItcUtilisedAmount = 0;
  let structuredCgstCashPaidAmount = 0;
  let structuredSgstCashPaidAmount = 0;
  let structuredIgstCashPaidAmount = 0;
  let structuredCessCashPaidAmount = 0;

  for (const record of records) {
    const payload = (record.gstr3bResponse ?? record) as Record<string, any>;
    const body = extractStructuredBody(payload);
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
    cessItcUtilisedAmount += sumForAliases(
      allFacts,
      'cess_itc_utilised_amount',
      'cessItcUtilisedAmount',
      'csamt_itc_utilised',
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
    cessCashPaidAmount +=
      sumForAliases(allFacts, 'cess_cash_paid_amount', 'cessCashPaidAmount') +
      sumCashByTaxType(allFacts, 'CESS');

    // Structured parsing for payloads like:
    // data.data.sup_details / data.data.itc_elg / data.data.tx_pmt.
    const supDetails = asRecord(body.sup_details);
    const osupDet = asRecord(supDetails.osup_det);
    const osupZero = asRecord(supDetails.osup_zero);
    const osupNilExmp = asRecord(supDetails.osup_nil_exmp);
    const osupNongst = asRecord(supDetails.osup_nongst);
    const isupRev = asRecord(supDetails.isup_rev);

    const structuredTaxable = pickNumber(osupDet, 'txval');
    const structuredZero = pickNumber(osupZero, 'txval');
    const structuredNil = pickNumber(osupNilExmp, 'txval');
    const structuredNonGst = pickNumber(osupNongst, 'txval');
    const structuredReverse = pickNumber(isupRev, 'txval');

    structuredTaxableSuppliesNormalAmount += structuredTaxable;
    structuredZeroRatedNilExemptAmount += structuredZero + structuredNil + structuredNonGst;
    structuredReverseChargeSuppliesAmount += structuredReverse;
    structuredTaxableSuppliesAmount += structuredTaxable;
    structuredExemptAmount += structuredZero + structuredNil + structuredNonGst;
    structuredNonGstPurchaseAmount += structuredNonGst;

    const interSup = asRecord(body.inter_sup);
    structuredInterStatePurchaseAmount += sumTxValFromArray(interSup.unreg_details);
    structuredInterStatePurchaseAmount += sumTxValFromArray(interSup.comp_details);
    structuredInterStatePurchaseAmount += sumTxValFromArray(interSup.uin_details);

    const itcElg = asRecord(body.itc_elg);
    const itcAvl = asArrayOfRecords(itcElg.itc_avl);
    const itcRev = asArrayOfRecords(itcElg.itc_rev);
    const itcInelg = asArrayOfRecords(itcElg.itc_inelg);

    structuredInputTaxCreditCgstAmount += sumTaxAmounts(itcAvl, 'camt');
    structuredInputTaxCreditSgstAmount += sumTaxAmounts(itcAvl, 'samt');
    structuredInputTaxCreditIgstAmount += sumTaxAmounts(itcAvl, 'iamt');
    structuredInputTaxCreditReversedAmount +=
      sumTaxAmounts(itcRev, 'camt') +
      sumTaxAmounts(itcRev, 'samt') +
      sumTaxAmounts(itcRev, 'iamt');
    structuredInputTaxCreditIneligibleAmount +=
      sumTaxAmounts(itcInelg, 'camt') +
      sumTaxAmounts(itcInelg, 'samt') +
      sumTaxAmounts(itcInelg, 'iamt');

    const txPmt = asRecord(body.tx_pmt);
    const pditc = asRecord(txPmt.pditc);
    structuredCgstItcUtilisedAmount += pickNumber(pditc, 'c_pdi');
    structuredSgstItcUtilisedAmount += pickNumber(pditc, 's_pdi');
    structuredIgstItcUtilisedAmount += pickNumber(pditc, 'i_pdi');
    structuredCessItcUtilisedAmount += pickNumber(pditc, 'cs_pdi');

    const pdcash = asArrayOfRecords(txPmt.pdcash);
    for (const row of pdcash) {
      structuredCgstCashPaidAmount += pickNumber(row, 'cpd');
      structuredSgstCashPaidAmount += pickNumber(row, 'spd');
      structuredIgstCashPaidAmount += pickNumber(row, 'ipd');
      structuredCessCashPaidAmount += pickNumber(row, 'cspd', 'cs_pd', 'csamt');
    }
  }

  const choose = (aliasValue: number, structuredValue: number): number =>
    aliasValue !== 0 ? aliasValue : structuredValue;

  taxableSuppliesNormalAmount = choose(
    taxableSuppliesNormalAmount,
    structuredTaxableSuppliesNormalAmount,
  );
  zeroRatedNilExemptAmount = choose(
    zeroRatedNilExemptAmount,
    structuredZeroRatedNilExemptAmount,
  );
  reverseChargeSuppliesAmount = choose(
    reverseChargeSuppliesAmount,
    structuredReverseChargeSuppliesAmount,
  );
  taxableSuppliesAmount = choose(taxableSuppliesAmount, structuredTaxableSuppliesAmount);
  exemptAmount = choose(exemptAmount, structuredExemptAmount);
  interStatePurchaseAmount = choose(
    interStatePurchaseAmount,
    structuredInterStatePurchaseAmount,
  );
  intraStatePurchaseAmount = choose(
    intraStatePurchaseAmount,
    structuredIntraStatePurchaseAmount,
  );
  nonGstPurchaseAmount = choose(nonGstPurchaseAmount, structuredNonGstPurchaseAmount);
  inputTaxCreditCgstAmount = choose(
    inputTaxCreditCgstAmount,
    structuredInputTaxCreditCgstAmount,
  );
  inputTaxCreditSgstAmount = choose(
    inputTaxCreditSgstAmount,
    structuredInputTaxCreditSgstAmount,
  );
  inputTaxCreditIgstAmount = choose(
    inputTaxCreditIgstAmount,
    structuredInputTaxCreditIgstAmount,
  );
  inputTaxCreditReversedAmount = choose(
    inputTaxCreditReversedAmount,
    structuredInputTaxCreditReversedAmount,
  );
  inputTaxCreditIneligibleAmount = choose(
    inputTaxCreditIneligibleAmount,
    structuredInputTaxCreditIneligibleAmount,
  );
  cgstItcUtilisedAmount = choose(
    cgstItcUtilisedAmount,
    structuredCgstItcUtilisedAmount,
  );
  sgstItcUtilisedAmount = choose(
    sgstItcUtilisedAmount,
    structuredSgstItcUtilisedAmount,
  );
  igstItcUtilisedAmount = choose(
    igstItcUtilisedAmount,
    structuredIgstItcUtilisedAmount,
  );
  cessItcUtilisedAmount = choose(
    cessItcUtilisedAmount,
    structuredCessItcUtilisedAmount,
  );
  cgstCashPaidAmount = choose(cgstCashPaidAmount, structuredCgstCashPaidAmount);
  sgstCashPaidAmount = choose(sgstCashPaidAmount, structuredSgstCashPaidAmount);
  igstCashPaidAmount = choose(igstCashPaidAmount, structuredIgstCashPaidAmount);
  cessCashPaidAmount = choose(cessCashPaidAmount, structuredCessCashPaidAmount);

  const totalPurchaseValue =
    interStatePurchaseAmount + intraStatePurchaseAmount + nonGstPurchaseAmount;
  const totalItcAvailable =
    inputTaxCreditCgstAmount + inputTaxCreditSgstAmount + inputTaxCreditIgstAmount;
  const totalItcUtilised =
    cgstItcUtilisedAmount +
    sgstItcUtilisedAmount +
    igstItcUtilisedAmount +
    cessItcUtilisedAmount;
  const totalCashTaxPaid =
    cgstCashPaidAmount +
    sgstCashPaidAmount +
    igstCashPaidAmount +
    cessCashPaidAmount;

  return {
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
    totalCessItcUtilised: round2(cessItcUtilisedAmount),
    totalCashTaxPaid: round2(totalCashTaxPaid),
    totalCashCgstPaid: round2(cgstCashPaidAmount),
    totalCashSgstPaid: round2(sgstCashPaidAmount),
    totalCashIgstPaid: round2(igstCashPaidAmount),
    totalCashCessPaid: round2(cessCashPaidAmount),
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

function sumCashByTaxType(facts: NumericFact[], taxType: 'CGST' | 'SGST' | 'IGST' | 'CESS'): number {
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

function normalizeTaxType(raw: string | null): 'CGST' | 'SGST' | 'IGST' | 'CESS' | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  if (upper === 'CGST') return 'CGST';
  if (upper === 'SGST') return 'SGST';
  if (upper === 'IGST') return 'IGST';
  if (upper === 'CESS' || upper === 'CESSAMT') return 'CESS';
  return null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function asRecord(value: unknown): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, any>;
  }
  return {};
}

function asArrayOfRecords(value: unknown): Array<Record<string, any>> {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => v && typeof v === 'object') as Array<Record<string, any>>;
}

function extractStructuredBody(payload: Record<string, any>): Record<string, any> {
  const level1 = asRecord(payload.data);
  const level2 = asRecord(level1.data);
  return Object.keys(level2).length > 0 ? level2 : level1;
}

function sumTxValFromArray(value: unknown): number {
  return asArrayOfRecords(value).reduce((sum, row) => sum + pickNumber(row, 'txval'), 0);
}

function sumTaxAmounts(rows: Array<Record<string, any>>, key: string): number {
  return rows.reduce((sum, row) => sum + pickNumber(row, key), 0);
}
