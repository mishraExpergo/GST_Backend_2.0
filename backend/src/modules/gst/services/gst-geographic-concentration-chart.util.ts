/**
 * Geographic Concentration — state share of company activity, then weighted risk.
 * Defaults: latest FY in range; GSTIN 5% = max(cancelled, suspended) scores;
 * missing factors dropped and weights renormalized.
 */

import {
  COMPOSITE_LEVEL_BANDS,
  CONCENTRATION_BANDS,
  GEOGRAPHIC_FACTOR_WEIGHTS,
  GSTIN_STATE_NAMES,
  STRESS_BANDS,
  type GeographicRiskBand,
  type GeographicRiskLabel,
} from '../config/geographic-risk-config';
import {
  buildPeriodSpecs,
  monthsForFinancialYear,
  type CalendarMonth,
  type ChartRangeKey,
} from './gst-tax-payment-chart.util';

export type GeographicMissingSource =
  | 'GSTR-2B'
  | 'GSTR-3B'
  | 'GSTR-1'
  | 'GSTREG1'
  | 'NOTICES';

export interface FactorCell {
  rawPct: number | null;
  riskScore: number | null;
  riskLabel: GeographicRiskLabel | null;
  weight: number;
  contribution: number | null;
}

export interface GeographicGstinFacts {
  gstin: string;
  stateCode: string;
  status: 'ACTIVE' | 'CANCELLED' | 'SUSPENDED' | null;
  purchaseValue: number | null;
  revenue: number | null;
  outstandingTax: number | null;
  delayedReturnCount: number | null;
  activeNoticeCount: number | null;
}

export interface GeographicStateRow {
  stateCode: string;
  stateName: string;
  gstinCount: number;
  compositeScore: number | null;
  riskLevel: GeographicRiskLabel | null;
  factors: {
    taxStress: FactorCell;
    revenue: FactorCell;
    delayedFiling: FactorCell;
    legalNotices: FactorCell;
    purchase: FactorCell;
    gstinCancelled: FactorCell;
    gstinSuspended: FactorCell;
  };
}

export interface GeographicConcentrationChartResponse {
  range: ChartRangeKey;
  financialYear: string;
  series: GeographicStateRow[];
  incomplete: boolean;
  missing: Array<{
    gstin: string;
    source: GeographicMissingSource;
    financialYear: string;
  }>;
  drilldown?: {
    stateCode: string;
    stateName: string;
    compositeScore: number | null;
    riskLevel: GeographicRiskLabel | null;
    factors: GeographicStateRow['factors'];
    gstins: GeographicGstinFacts[];
  };
  fetch?: {
    jobs: Array<{
      jobId: string;
      status: string;
      checkStatusUrl: string;
    }>;
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function parseRangeKey(raw: string): ChartRangeKey {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (value === '1y' || value === '3y' || value === '5y') {
    return value;
  }
  throw new Error('Query parameter "range" must be one of: 1y, 3y, 5y.');
}

export function resolveMapFinancialYear(
  range: ChartRangeKey,
  referenceDate = new Date(),
): { financialYear: string; fyStartYear: number; months: CalendarMonth[] } {
  const specs = buildPeriodSpecs(range, {
    granularity: 'annual',
    referenceDate,
  });
  const current = specs[specs.length - 1];
  return {
    financialYear: current.financialYear,
    fyStartYear: current.fyStartYear,
    months: current.months.length
      ? current.months
      : monthsForFinancialYear(current.fyStartYear),
  };
}

export function stateCodeFromGstin(gstin: string): string | null {
  const code = String(gstin ?? '')
    .trim()
    .toUpperCase()
    .slice(0, 2);
  return /^\d{2}$/.test(code) ? code : null;
}

export function stateNameFromCode(stateCode: string): string {
  return GSTIN_STATE_NAMES[stateCode] ?? stateCode;
}

export function normalizeStateQuery(raw: string): string | null {
  const value = String(raw ?? '').trim();
  if (!value) {
    return null;
  }
  if (/^\d{1,2}$/.test(value)) {
    return value.padStart(2, '0');
  }
  const upper = value.toUpperCase();
  for (const [code, name] of Object.entries(GSTIN_STATE_NAMES)) {
    if (name.toUpperCase() === upper || name.toUpperCase().startsWith(upper)) {
      return code;
    }
  }
  return null;
}

export function pctShare(
  part: number | null,
  total: number | null,
): number | null {
  if (part === null || total === null || total <= 0) {
    return null;
  }
  return round2((part / total) * 100);
}

export function scoreFromBands(
  pct: number | null,
  bands: GeographicRiskBand[],
): { score: number | null; label: GeographicRiskLabel | null } {
  if (pct === null) {
    return { score: null, label: null };
  }
  const safe = Math.max(0, pct);
  for (const band of bands) {
    if (band.maxExclusive === null || safe <= band.maxExclusive) {
      return { score: band.score, label: band.label };
    }
  }
  const last = bands[bands.length - 1];
  return { score: last.score, label: last.label };
}

export function compositeRiskLevel(
  score: number | null,
): GeographicRiskLabel | null {
  return scoreFromBands(score, COMPOSITE_LEVEL_BANDS).label;
}

function makeCell(
  pct: number | null,
  bands: GeographicRiskBand[],
  weight: number,
): FactorCell {
  const scored = scoreFromBands(pct, bands);
  return {
    rawPct: pct,
    riskScore: scored.score,
    riskLabel: scored.label,
    weight,
    contribution:
      scored.score === null ? null : round2(scored.score * weight),
  };
}

export function renormalizedComposite(
  scores: Array<{ score: number | null; weight: number }>,
): number | null {
  const usable = scores.filter(
    (item) => item.score !== null && item.weight > 0,
  ) as Array<{ score: number; weight: number }>;
  if (usable.length === 0) {
    return null;
  }
  const weightSum = usable.reduce((sum, item) => sum + item.weight, 0);
  if (weightSum <= 0) {
    return null;
  }
  const weighted = usable.reduce(
    (sum, item) => sum + item.score * (item.weight / weightSum),
    0,
  );
  return round2(weighted);
}

export function outstandingTax(
  liability: number,
  itcUtilised: number,
  cashPaid: number,
): number {
  return Math.max(0, round2(liability - itcUtilised - cashPaid));
}

export function extractOutwardTaxLiability(payload: unknown): number {
  const osup = findOsupDet(payload);
  if (!osup) {
    return 0;
  }
  return round2(
    toNumber(osup.iamt) +
      toNumber(osup.camt) +
      toNumber(osup.samt) +
      toNumber(osup.csamt),
  );
}

function findOsupDet(node: unknown): Record<string, any> | null {
  if (!node || typeof node !== 'object') {
    return null;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findOsupDet(item);
      if (found) {
        return found;
      }
    }
    return null;
  }
  const obj = node as Record<string, any>;
  const nested = obj.sup_details?.osup_det;
  if (nested && typeof nested === 'object') {
    return nested as Record<string, any>;
  }
  if (obj.osup_det && typeof obj.osup_det === 'object') {
    return obj.osup_det as Record<string, any>;
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') {
      const found = findOsupDet(value);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function toNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function isClosedNoticeStatus(raw: string | null | undefined): boolean {
  const value = String(raw ?? '').toUpperCase();
  return (
    value.includes('CLOSE') ||
    value.includes('RESOLV') ||
    value.includes('DISPOSE') ||
    value.includes('REPLIED')
  );
}

export function returnPeriodInMonths(
  returnPeriod: string,
  months: CalendarMonth[],
): boolean {
  const match = String(returnPeriod).match(/^(\d{2})(\d{4})$/);
  if (!match) {
    return false;
  }
  const month = Number(match[1]);
  const year = Number(match[2]);
  return months.some((slot) => slot.year === year && slot.month === month);
}

export function normalizeTrackFinancialYear(raw: string): string {
  const match = String(raw ?? '')
    .trim()
    .match(/^(?:FY\s*)?(\d{4}-\d{2})$/i);
  return match ? match[1] : String(raw ?? '').trim();
}

interface Totals {
  purchase: number;
  revenue: number;
  outstanding: number;
  delayed: number;
  notices: number;
  cancelled: number;
  suspended: number;
}

function sumFacts(
  facts: GeographicGstinFacts[],
  present: {
    purchase: boolean;
    revenue: boolean;
    delayed: boolean;
    notices: boolean;
  },
): Totals {
  const totals: Totals = {
    purchase: 0,
    revenue: 0,
    outstanding: 0,
    delayed: 0,
    notices: 0,
    cancelled: 0,
    suspended: 0,
  };
  for (const fact of facts) {
    if (present.purchase && fact.purchaseValue !== null) {
      totals.purchase += fact.purchaseValue;
    }
    if (present.revenue && fact.revenue !== null) {
      totals.revenue += fact.revenue;
      totals.outstanding += fact.outstandingTax ?? 0;
    }
    if (present.delayed && fact.delayedReturnCount !== null) {
      totals.delayed += fact.delayedReturnCount;
    }
    if (present.notices && fact.activeNoticeCount !== null) {
      totals.notices += fact.activeNoticeCount;
    }
    if (fact.status === 'CANCELLED') {
      totals.cancelled += 1;
    }
    if (fact.status === 'SUSPENDED') {
      totals.suspended += 1;
    }
  }
  return {
    purchase: round2(totals.purchase),
    revenue: round2(totals.revenue),
    outstanding: round2(totals.outstanding),
    delayed: totals.delayed,
    notices: totals.notices,
    cancelled: totals.cancelled,
    suspended: totals.suspended,
  };
}

export function buildStateRows(
  facts: GeographicGstinFacts[],
  hasPurchaseData: boolean,
  hasRevenueData: boolean,
  hasDelayedData: boolean,
  hasNoticeData: boolean,
): GeographicStateRow[] {
  const byState = new Map<string, GeographicGstinFacts[]>();
  for (const fact of facts) {
    const list = byState.get(fact.stateCode) ?? [];
    list.push(fact);
    byState.set(fact.stateCode, list);
  }
  const company = sumFacts(facts, {
    purchase: hasPurchaseData,
    revenue: hasRevenueData,
    delayed: hasDelayedData,
    notices: hasNoticeData,
  });

  const rows: GeographicStateRow[] = [];
  for (const [stateCode, stateFacts] of byState.entries()) {
    const state = sumFacts(stateFacts, {
      purchase: hasPurchaseData,
      revenue: hasRevenueData,
      delayed: hasDelayedData,
      notices: hasNoticeData,
    });
    const taxStress = makeCell(
      hasRevenueData ? pctShare(state.outstanding, company.outstanding) : null,
      STRESS_BANDS,
      GEOGRAPHIC_FACTOR_WEIGHTS.taxStress,
    );
    const revenue = makeCell(
      hasRevenueData ? pctShare(state.revenue, company.revenue) : null,
      CONCENTRATION_BANDS,
      GEOGRAPHIC_FACTOR_WEIGHTS.revenue,
    );
    const delayedFiling = makeCell(
      hasDelayedData ? pctShare(state.delayed, company.delayed) : null,
      STRESS_BANDS,
      GEOGRAPHIC_FACTOR_WEIGHTS.delayedFiling,
    );
    const legalNotices = makeCell(
      hasNoticeData ? pctShare(state.notices, company.notices) : null,
      STRESS_BANDS,
      GEOGRAPHIC_FACTOR_WEIGHTS.legalNotices,
    );
    const purchase = makeCell(
      hasPurchaseData ? pctShare(state.purchase, company.purchase) : null,
      CONCENTRATION_BANDS,
      GEOGRAPHIC_FACTOR_WEIGHTS.purchase,
    );
    const gstinCancelled = makeCell(
      pctShare(state.cancelled, company.cancelled),
      CONCENTRATION_BANDS,
      GEOGRAPHIC_FACTOR_WEIGHTS.gstin,
    );
    const gstinSuspended = makeCell(
      pctShare(state.suspended, company.suspended),
      CONCENTRATION_BANDS,
      GEOGRAPHIC_FACTOR_WEIGHTS.gstin,
    );
    const gstinScore = Math.max(
      gstinCancelled.riskScore ?? Number.NEGATIVE_INFINITY,
      gstinSuspended.riskScore ?? Number.NEGATIVE_INFINITY,
    );
    const gstinForComposite =
      gstinScore === Number.NEGATIVE_INFINITY ? null : gstinScore;

    const compositeScore = renormalizedComposite([
      { score: taxStress.riskScore, weight: GEOGRAPHIC_FACTOR_WEIGHTS.taxStress },
      { score: revenue.riskScore, weight: GEOGRAPHIC_FACTOR_WEIGHTS.revenue },
      {
        score: delayedFiling.riskScore,
        weight: GEOGRAPHIC_FACTOR_WEIGHTS.delayedFiling,
      },
      {
        score: legalNotices.riskScore,
        weight: GEOGRAPHIC_FACTOR_WEIGHTS.legalNotices,
      },
      { score: purchase.riskScore, weight: GEOGRAPHIC_FACTOR_WEIGHTS.purchase },
      { score: gstinForComposite, weight: GEOGRAPHIC_FACTOR_WEIGHTS.gstin },
    ]);

    rows.push({
      stateCode,
      stateName: stateNameFromCode(stateCode),
      gstinCount: stateFacts.length,
      compositeScore,
      riskLevel: compositeRiskLevel(compositeScore),
      factors: {
        taxStress,
        revenue,
        delayedFiling,
        legalNotices,
        purchase,
        gstinCancelled,
        gstinSuspended,
      },
    });
  }

  return rows.sort((a, b) => {
    const aScore = a.compositeScore ?? -1;
    const bScore = b.compositeScore ?? -1;
    if (bScore !== aScore) {
      return bScore - aScore;
    }
    return a.stateCode.localeCompare(b.stateCode);
  });
}
