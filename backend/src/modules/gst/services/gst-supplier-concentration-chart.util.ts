/**
 * Supplier Concentration — GSTR-2B taxable purchases by supplier GSTIN.
 * Two-period comparison (1y = last two FY halves; 3y/5y = last two FYs).
 */

import {
  buildPeriodSpecs,
  monthKey,
  type CalendarMonth,
  type ChartHalf,
  type ChartRangeKey,
} from './gst-tax-payment-chart.util';

export type SupplierStatus = 'EXISTING' | 'NEW' | 'LEFT';
export type SupplierMovement =
  | 'INCREASED'
  | 'DECREASED'
  | 'STABLE'
  | 'NEW'
  | 'LEFT';

const STABLE_PP_EPSILON = 0.5;
const MATERIAL_LEAVER_SHARE = 5;
const UNKNOWN_SUPPLIER = 'UNKNOWN';

export interface ComparisonPeriod {
  period: string;
  financialYear: string;
  half: ChartHalf | null;
  months: CalendarMonth[];
}

export interface ComparisonWindows {
  previous: ComparisonPeriod;
  current: ComparisonPeriod;
}

export interface SupplierPurchaseLine {
  supplierGstin: string;
  supplierName: string | null;
  taxableValue: number;
}

export interface SupplierPeriodTotals {
  supplierGstin: string;
  supplierName: string | null;
  purchaseValue: number;
}

export interface SupplierComparisonRow {
  rank: number | null;
  supplierGstin: string;
  supplierName: string | null;
  previousPurchaseValue: number | null;
  currentPurchaseValue: number | null;
  previousShare: number | null;
  currentShare: number | null;
  dependencyChangePp: number | null;
  dependencyChangePct: number | null;
  status: SupplierStatus;
  interpretation: SupplierMovement;
}

export interface SupplierConcentrationChartResponse {
  range: ChartRangeKey;
  comparison: {
    previous: {
      period: string;
      financialYear: string;
      half: ChartHalf | null;
    };
    current: {
      period: string;
      financialYear: string;
      half: ChartHalf | null;
    };
  };
  totals: {
    previousPurchaseValue: number | null;
    currentPurchaseValue: number | null;
    previousActiveSupplierCount: number | null;
    currentActiveSupplierCount: number | null;
    supplierCountChange: number | null;
  };
  concentration: {
    previousTop5Pct: number | null;
    currentTop5Pct: number | null;
    top5ChangePp: number | null;
  };
  churn: {
    newSupplierCount: number | null;
    newSupplierRate: number | null;
    attritionCount: number | null;
    attritionRate: number | null;
    attritionValue: number | null;
    attritionValueShare: number | null;
  };
  series: Array<{
    rank: number;
    supplierGstin: string;
    supplierName: string | null;
    previousPurchaseValue: number | null;
    currentPurchaseValue: number | null;
    previousShare: number | null;
    currentShare: number | null;
    dependencyChangePp: number | null;
    dependencyChangePct: number | null;
    status: SupplierStatus;
  }>;
  interpretation: {
    concentrating: boolean | null;
    materialLeavers: Array<{ supplierGstin: string; previousShare: number }>;
    newInTop5: string[];
  };
  incomplete: boolean;
  missing: Array<{
    gstin: string;
    financialYear: string;
    year: number;
    month: number;
  }>;
  drilldown?: { rows: SupplierComparisonRow[] };
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

export function buildComparisonWindows(
  range: ChartRangeKey,
  referenceDate = new Date(),
): ComparisonWindows {
  if (range === '1y') {
    const specs = buildPeriodSpecs('1y', {
      granularity: 'half-yearly',
      referenceDate,
    });
    if (specs.length < 2) {
      throw new Error('Unable to build 1y half-year comparison windows.');
    }
    const previous = specs[specs.length - 2];
    const current = specs[specs.length - 1];
    return {
      previous: toComparisonPeriod(previous),
      current: toComparisonPeriod(current),
    };
  }

  const specs = buildPeriodSpecs('3y', {
    granularity: 'annual',
    referenceDate,
  });
  if (specs.length < 2) {
    throw new Error('Unable to build annual comparison windows.');
  }
  const previous = specs[specs.length - 2];
  const current = specs[specs.length - 1];
  return {
    previous: toComparisonPeriod(previous),
    current: toComparisonPeriod(current),
  };
}

function toComparisonPeriod(spec: {
  period: string;
  financialYear: string;
  half: ChartHalf | null;
  months: CalendarMonth[];
}): ComparisonPeriod {
  return {
    period: spec.period,
    financialYear: spec.financialYear,
    half: spec.half,
    months: spec.months,
  };
}

export function allWindowMonths(windows: ComparisonWindows): CalendarMonth[] {
  const seen = new Set<string>();
  const months: CalendarMonth[] = [];
  for (const slot of [...windows.previous.months, ...windows.current.months]) {
    const key = monthKey(slot.year, slot.month);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    months.push(slot);
  }
  return months;
}

export function extractSupplierPurchases(
  payload: unknown,
): SupplierPurchaseLine[] {
  const byGstin = new Map<
    string,
    { supplierGstin: string; supplierName: string | null; taxableValue: number }
  >();

  const add = (
    supplierGstin: string | null,
    supplierName: string | null,
    taxableValue: number,
  ): void => {
    if (!Number.isFinite(taxableValue) || taxableValue === 0) {
      return;
    }
    const key = supplierGstin || UNKNOWN_SUPPLIER;
    const existing = byGstin.get(key);
    if (existing) {
      existing.taxableValue = round2(existing.taxableValue + taxableValue);
      if (!existing.supplierName && supplierName) {
        existing.supplierName = supplierName;
      }
      return;
    }
    byGstin.set(key, {
      supplierGstin: key,
      supplierName,
      taxableValue: round2(taxableValue),
    });
  };

  visitPurchases(payload, {
    supplierGstin: null,
    supplierName: null,
    sign: 1,
  }, add);

  return [...byGstin.values()];
}

interface VisitContext {
  supplierGstin: string | null;
  supplierName: string | null;
  sign: number;
}

function visitPurchases(
  node: unknown,
  context: VisitContext,
  add: (
    supplierGstin: string | null,
    supplierName: string | null,
    taxableValue: number,
  ) => void,
): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      visitPurchases(item, context, add);
    }
    return;
  }
  if (!node || typeof node !== 'object') {
    return;
  }

  const obj = node as Record<string, any>;
  const supplierGstin =
    normalizeGstin(
      pickString(obj, 'ctin', 'supplierGstin', 'supplier_gstin', 'supplierGSTIN'),
    ) ?? context.supplierGstin;
  const supplierName =
    pickString(
      obj,
      'trdnm',
      'tradeNam',
      'tradeName',
      'lgl_trdnm',
      'supplierName',
      'supplier_name',
    ) ?? context.supplierName;
  const sign = noteSign(obj) * context.sign;

  const hasLineItems = Array.isArray(obj.itms) && obj.itms.length > 0;
  const txval = pickTaxableValue(obj);
  if (txval !== null && !hasLineItems) {
    add(supplierGstin, supplierName, txval * sign);
  }

  const next: VisitContext = { supplierGstin, supplierName, sign };
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') {
      visitPurchases(value, next, add);
    }
  }
}

function noteSign(obj: Record<string, any>): number {
  const raw = pickString(obj, 'ntty', 'noteType', 'note_type');
  if (!raw) {
    return 1;
  }
  const value = raw.toUpperCase();
  if (
    value === 'C' ||
    value === 'CR' ||
    value === 'CREDIT' ||
    value.includes('CREDIT')
  ) {
    return -1;
  }
  return 1;
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

function pickTaxableValue(obj: Record<string, any>): number | null {
  for (const key of ['txval', 'taxableValue', 'taxable_value', 'taxval']) {
    const value = obj[key];
    if (value === null || value === undefined || value === '') {
      continue;
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return null;
}

function normalizeGstin(raw: string | null): string | null {
  if (!raw) {
    return null;
  }
  const gstin = raw.trim().toUpperCase();
  return gstin || null;
}

export function rollUpBySupplier(
  lines: SupplierPurchaseLine[],
): Map<string, SupplierPeriodTotals> {
  const byGstin = new Map<string, SupplierPeriodTotals>();
  for (const line of lines) {
    const key = line.supplierGstin || UNKNOWN_SUPPLIER;
    const existing = byGstin.get(key);
    if (existing) {
      existing.purchaseValue = round2(existing.purchaseValue + line.taxableValue);
      if (!existing.supplierName && line.supplierName) {
        existing.supplierName = line.supplierName;
      }
    } else {
      byGstin.set(key, {
        supplierGstin: key,
        supplierName: line.supplierName,
        purchaseValue: round2(line.taxableValue),
      });
    }
  }
  return byGstin;
}

export function identifiedSupplierTotal(
  map: Map<string, SupplierPeriodTotals>,
): number {
  let total = 0;
  for (const row of map.values()) {
    if (row.supplierGstin === UNKNOWN_SUPPLIER) {
      continue;
    }
    total += row.purchaseValue;
  }
  return round2(total);
}

export function activeSuppliers(
  map: Map<string, SupplierPeriodTotals>,
): Map<string, SupplierPeriodTotals> {
  const active = new Map<string, SupplierPeriodTotals>();
  for (const [gstin, row] of map.entries()) {
    if (gstin === UNKNOWN_SUPPLIER) {
      continue;
    }
    if (row.purchaseValue > 0) {
      active.set(gstin, row);
    }
  }
  return active;
}

export function dependencyShare(
  value: number | null,
  total: number | null,
): number | null {
  if (value === null || total === null || total <= 0) {
    return null;
  }
  return round2((value / total) * 100);
}

export function dependencyChangePp(
  currentShare: number | null,
  previousShare: number | null,
): number | null {
  if (currentShare === null || previousShare === null) {
    return null;
  }
  return round2(currentShare - previousShare);
}

export function dependencyChangePct(
  currentShare: number | null,
  previousShare: number | null,
): number | null {
  if (currentShare === null || previousShare === null) {
    return null;
  }
  if (previousShare === 0) {
    return currentShare === 0 ? 0 : null;
  }
  return round2(((currentShare - previousShare) / previousShare) * 100);
}

export function classifyStatus(
  previousValue: number,
  currentValue: number,
): SupplierStatus {
  const prev = previousValue > 0;
  const curr = currentValue > 0;
  if (curr && !prev) {
    return 'NEW';
  }
  if (prev && !curr) {
    return 'LEFT';
  }
  return 'EXISTING';
}

export function classifyMovement(
  status: SupplierStatus,
  changePp: number | null,
): SupplierMovement {
  if (status === 'NEW' || status === 'LEFT') {
    return status;
  }
  if (changePp === null) {
    return 'STABLE';
  }
  if (changePp > STABLE_PP_EPSILON) {
    return 'INCREASED';
  }
  if (changePp < -STABLE_PP_EPSILON) {
    return 'DECREASED';
  }
  return 'STABLE';
}

function sortCurrentDesc(a: SupplierPeriodTotals, b: SupplierPeriodTotals): number {
  if (b.purchaseValue !== a.purchaseValue) {
    return b.purchaseValue - a.purchaseValue;
  }
  return a.supplierGstin.localeCompare(b.supplierGstin);
}

export function buildComparisonRows(
  previousMap: Map<string, SupplierPeriodTotals>,
  currentMap: Map<string, SupplierPeriodTotals>,
): SupplierComparisonRow[] {
  const previousActive = activeSuppliers(previousMap);
  const currentActive = activeSuppliers(currentMap);
  const previousTotal = identifiedSupplierTotal(previousMap);
  const currentTotal = identifiedSupplierTotal(currentMap);

  const gstins = new Set([
    ...previousActive.keys(),
    ...currentActive.keys(),
  ]);

  const rankedCurrent = [...currentActive.values()].sort(sortCurrentDesc);
  const rankByGstin = new Map<string, number>();
  rankedCurrent.forEach((row, index) => {
    rankByGstin.set(row.supplierGstin, index + 1);
  });

  const rows: SupplierComparisonRow[] = [];
  for (const gstin of gstins) {
    const previous = previousActive.get(gstin);
    const current = currentActive.get(gstin);
    const previousValue = previous ? previous.purchaseValue : 0;
    const currentValue = current ? current.purchaseValue : 0;
    const status = classifyStatus(previousValue, currentValue);
    const previousShare = previous
      ? dependencyShare(previousValue, previousTotal)
      : status === 'NEW'
        ? 0
        : null;
    const currentShare = current
      ? dependencyShare(currentValue, currentTotal)
      : status === 'LEFT'
        ? 0
        : null;
    const changePp = dependencyChangePp(currentShare, previousShare);
    rows.push({
      rank: rankByGstin.get(gstin) ?? null,
      supplierGstin: gstin,
      supplierName: current?.supplierName ?? previous?.supplierName ?? null,
      previousPurchaseValue: previous ? previousValue : status === 'NEW' ? 0 : null,
      currentPurchaseValue: current ? currentValue : status === 'LEFT' ? 0 : null,
      previousShare,
      currentShare,
      dependencyChangePp: changePp,
      dependencyChangePct: dependencyChangePct(currentShare, previousShare),
      status,
      interpretation: classifyMovement(status, changePp),
    });
  }

  return rows.sort((a, b) => {
    if (a.status === 'LEFT' && b.status !== 'LEFT') {
      return 1;
    }
    if (b.status === 'LEFT' && a.status !== 'LEFT') {
      return -1;
    }
    const aRank = a.rank ?? Number.MAX_SAFE_INTEGER;
    const bRank = b.rank ?? Number.MAX_SAFE_INTEGER;
    if (aRank !== bRank) {
      return aRank - bRank;
    }
    return a.supplierGstin.localeCompare(b.supplierGstin);
  });
}

export function top5Series(
  rows: SupplierComparisonRow[],
): SupplierConcentrationChartResponse['series'] {
  return rows
    .filter((row) => row.status !== 'LEFT' && row.rank !== null && row.rank <= 5)
    .slice(0, 5)
    .map((row) => ({
      rank: row.rank!,
      supplierGstin: row.supplierGstin,
      supplierName: row.supplierName,
      previousPurchaseValue: row.previousPurchaseValue,
      currentPurchaseValue: row.currentPurchaseValue,
      previousShare: row.previousShare,
      currentShare: row.currentShare,
      dependencyChangePp: row.dependencyChangePp,
      dependencyChangePct: row.dependencyChangePct,
      status: row.status,
    }));
}

export function top5ConcentrationPct(
  map: Map<string, SupplierPeriodTotals>,
): number | null {
  const active = [...activeSuppliers(map).values()].sort(sortCurrentDesc);
  const total = identifiedSupplierTotal(map);
  if (total <= 0 || active.length === 0) {
    return null;
  }
  const top5Value = active
    .slice(0, 5)
    .reduce((sum, row) => sum + row.purchaseValue, 0);
  return dependencyShare(top5Value, total);
}

export function buildChurnMetrics(
  rows: SupplierComparisonRow[],
  previousTotal: number,
  previousActiveCount: number,
): SupplierConcentrationChartResponse['churn'] {
  if (previousActiveCount === 0 && rows.length === 0) {
    return {
      newSupplierCount: null,
      newSupplierRate: null,
      attritionCount: null,
      attritionRate: null,
      attritionValue: null,
      attritionValueShare: null,
    };
  }

  const newcomers = rows.filter((row) => row.status === 'NEW');
  const leavers = rows.filter((row) => row.status === 'LEFT');
  const newCount = newcomers.length;
  const attritionCount = leavers.length;
  const attritionValue = round2(
    leavers.reduce((sum, row) => sum + (row.previousPurchaseValue ?? 0), 0),
  );

  return {
    newSupplierCount: newCount,
    newSupplierRate:
      previousActiveCount > 0
        ? round2((newCount / previousActiveCount) * 100)
        : null,
    attritionCount,
    attritionRate:
      previousActiveCount > 0
        ? round2((attritionCount / previousActiveCount) * 100)
        : null,
    attritionValue,
    attritionValueShare:
      previousTotal > 0 ? round2((attritionValue / previousTotal) * 100) : null,
  };
}

export function buildInterpretation(
  series: SupplierConcentrationChartResponse['series'],
  rows: SupplierComparisonRow[],
  previousTop5Pct: number | null,
  currentTop5Pct: number | null,
): SupplierConcentrationChartResponse['interpretation'] {
  return {
    concentrating:
      previousTop5Pct === null || currentTop5Pct === null
        ? null
        : currentTop5Pct > previousTop5Pct,
    materialLeavers: rows
      .filter(
        (row) =>
          row.status === 'LEFT' &&
          row.previousShare !== null &&
          row.previousShare >= MATERIAL_LEAVER_SHARE,
      )
      .map((row) => ({
        supplierGstin: row.supplierGstin,
        previousShare: row.previousShare!,
      })),
    newInTop5: series
      .filter((row) => row.status === 'NEW')
      .map((row) => row.supplierGstin),
  };
}

export function findMissing2bMonths(
  gstins: string[],
  windows: ComparisonWindows,
  presentKeys: Set<string>,
): SupplierConcentrationChartResponse['missing'] {
  const missing: SupplierConcentrationChartResponse['missing'] = [];
  for (const gstin of gstins) {
    for (const slot of allWindowMonths(windows)) {
      const key = `${gstin}|${monthKey(slot.year, slot.month)}`;
      if (presentKeys.has(key)) {
        continue;
      }
      const inPrevious = windows.previous.months.some(
        (m) => m.year === slot.year && m.month === slot.month,
      );
      missing.push({
        gstin,
        financialYear: inPrevious
          ? windows.previous.financialYear
          : windows.current.financialYear,
        year: slot.year,
        month: slot.month,
      });
    }
  }
  return missing;
}

export function monthPresenceKey(gstin: string, year: number, month: number): string {
  return `${gstin}|${monthKey(year, month)}`;
}
