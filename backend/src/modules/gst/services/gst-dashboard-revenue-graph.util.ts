export type RevenueRangeKey = '1y' | '3y' | '5y';
export type RevenueBucketKey =
  | 'monthly'
  | 'quarterly'
  | 'halfYearly'
  | 'yearly';

export interface GstWiseRevenue {
  gstin: string;
  revenue: number;
  /** Share of this period's total revenue (0–100), null if total is 0. */
  sharePercent: number | null;
  legalName: string | null;
  entityType: string | null;
  pan: string | null;
}

export interface RevenueGraphPoint {
  key: string;
  label: string;
  from: string;
  to: string;
  revenue: number;
  /**
   * % change vs previous bucket in the same series.
   * Formula: ((current - previous) / previous) * 100
   * null when there is no previous period, or previous revenue is 0.
   */
  percentageChange: number | null;
  /** GSTIN-level revenue for this bar (for click/hover detail). */
  gstWise: GstWiseRevenue[];
}

export interface RevenueBucketSeries {
  totalRevenue: number;
  points: RevenueGraphPoint[];
}

export interface RevenueRangeBlock {
  financialYears: string[];
  from: string;
  to: string;
  totalRevenue: number;
  monthly?: RevenueBucketSeries;
  quarterly?: RevenueBucketSeries;
  halfYearly?: RevenueBucketSeries;
  yearly?: RevenueBucketSeries;
}

/** Per GSTIN × calendar month taxable turnover from Mongo 3B. */
export interface MonthGstRevenueFact {
  year: number;
  month: number;
  gstin: string;
  revenue: number;
  legalName: string | null;
  entityType: string | null;
  pan: string | null;
}

/** @deprecated Prefer MonthGstRevenueFact */
export type MonthRevenueFact = MonthGstRevenueFact;

/** Calendar month is within [from, to] inclusive (date-only UTC-ish local). */
export function isYearMonthInRange(
  year: number,
  month: number,
  from: Date,
  to: Date,
): boolean {
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    month < 1 ||
    month > 12
  ) {
    return false;
  }
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  return end >= startOfDay(from) && start <= endOfDay(to);
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

/**
 * Indian FY containing `asOf`:
 * Apr–Dec → FY starts this calendar year
 * Jan–Mar → FY starts previous calendar year
 */
export function getCurrentFyStartYear(asOf: Date = new Date()): number {
  const month = asOf.getMonth();
  const year = asOf.getFullYear();
  return month >= 3 ? year : year - 1;
}

export function formatFyLabel(fyStartYear: number): string {
  const endYY = String((fyStartYear + 1) % 100).padStart(2, '0');
  return `FY ${fyStartYear}-${endYY}`;
}

export function fyWindow(
  fyStartYear: number,
): { from: Date; to: Date; label: string } {
  return {
    from: new Date(fyStartYear, 3, 1),
    to: new Date(fyStartYear + 1, 2, 31),
    label: formatFyLabel(fyStartYear),
  };
}

/** Past N financial years ending at the FY that contains `asOf`. */
export function resolveRangeWindow(
  rangeYears: 1 | 3 | 5,
  asOf: Date = new Date(),
): { from: Date; to: Date; fyStartYears: number[]; financialYears: string[] } {
  const currentStart = getCurrentFyStartYear(asOf);
  const firstStart = currentStart - (rangeYears - 1);
  const fyStartYears: number[] = [];
  for (let y = firstStart; y <= currentStart; y++) {
    fyStartYears.push(y);
  }
  const from = new Date(firstStart, 3, 1);
  const to = new Date(currentStart + 1, 2, 31);
  return {
    from,
    to,
    fyStartYears,
    financialYears: fyStartYears.map(formatFyLabel),
  };
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Correct % change: ((current - previous) / previous) * 100
 */
export function computePercentageChange(
  current: number,
  previous: number | null | undefined,
): number | null {
  if (previous == null || !Number.isFinite(previous) || previous === 0) {
    return null;
  }
  if (!Number.isFinite(current)) {
    return null;
  }
  return round2(((current - previous) / previous) * 100);
}

function withPercentageChange(
  points: Array<Omit<RevenueGraphPoint, 'percentageChange'>>,
): RevenueGraphPoint[] {
  return points.map((point, index) => {
    const previous = index === 0 ? null : points[index - 1].revenue;
    return {
      ...point,
      percentageChange: computePercentageChange(point.revenue, previous),
    };
  });
}

/**
 * Aggregate GSTIN-wise revenue for facts matching `pred`.
 * Sorted by revenue descending. sharePercent is % of period total.
 */
export function aggregateGstWise(
  facts: MonthGstRevenueFact[],
  pred: (f: MonthGstRevenueFact) => boolean,
): { revenue: number; gstWise: GstWiseRevenue[] } {
  const byGstin = new Map<
    string,
    {
      gstin: string;
      revenue: number;
      legalName: string | null;
      entityType: string | null;
      pan: string | null;
    }
  >();

  for (const f of facts) {
    if (!pred(f)) continue;
    const gstin =
      String(f.gstin ?? '')
        .trim()
        .toUpperCase() || 'UNKNOWN';
    const existing = byGstin.get(gstin);
    if (existing) {
      existing.revenue = round2(existing.revenue + Number(f.revenue || 0));
      if (!existing.legalName && f.legalName) existing.legalName = f.legalName;
      if (!existing.entityType && f.entityType) {
        existing.entityType = f.entityType;
      }
      if (!existing.pan && f.pan) existing.pan = f.pan;
    } else {
      byGstin.set(gstin, {
        gstin,
        revenue: round2(Number(f.revenue || 0)),
        legalName: f.legalName ?? null,
        entityType: f.entityType ?? null,
        pan: f.pan ?? null,
      });
    }
  }

  const list = [...byGstin.values()].sort((a, b) => b.revenue - a.revenue);
  const total = round2(list.reduce((s, item) => s + item.revenue, 0));
  const gstWise: GstWiseRevenue[] = list.map((item) => ({
    ...item,
    sharePercent: total === 0 ? null : round2((item.revenue / total) * 100),
  }));

  return { revenue: total, gstWise };
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Map calendar year/month → Indian FY quarter 1..4 (Apr=Q1). */
export function fyQuarter(month: number): 1 | 2 | 3 | 4 {
  if (month >= 4 && month <= 6) return 1;
  if (month >= 7 && month <= 9) return 2;
  if (month >= 10 && month <= 12) return 3;
  return 4;
}

export function fyHalf(month: number): 1 | 2 {
  return month >= 4 && month <= 9 ? 1 : 2;
}

export function fyStartYearForCalendar(year: number, month: number): number {
  return month >= 4 ? year : year - 1;
}

export function buildMonthlySeries(
  facts: MonthGstRevenueFact[],
  from: Date,
  to: Date,
): RevenueBucketSeries {
  const points: Array<Omit<RevenueGraphPoint, 'percentageChange'>> = [];
  let cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(to.getFullYear(), to.getMonth(), 1);

  while (cursor <= end) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth() + 1;
    const { revenue, gstWise } = aggregateGstWise(
      facts,
      (f) => f.year === year && f.month === month,
    );
    points.push({
      key: monthKey(year, month),
      label: `${MONTH_LABELS[month - 1]} ${year}`,
      from: fmtDate(new Date(year, month - 1, 1)),
      to: fmtDate(new Date(year, month, 0)),
      revenue,
      gstWise,
    });
    cursor = new Date(year, month, 1);
  }

  const withChange = withPercentageChange(points);
  return {
    totalRevenue: round2(withChange.reduce((s, p) => s + p.revenue, 0)),
    points: withChange,
  };
}

export function buildQuarterlySeries(
  facts: MonthGstRevenueFact[],
  fyStartYears: number[],
): RevenueBucketSeries {
  const points: Array<Omit<RevenueGraphPoint, 'percentageChange'>> = [];
  for (const fyStart of fyStartYears) {
    for (const q of [1, 2, 3, 4] as const) {
      const startMonth = q === 1 ? 4 : q === 2 ? 7 : q === 3 ? 10 : 1;
      const startYear = q === 4 ? fyStart + 1 : fyStart;
      const endMonth = q === 1 ? 6 : q === 2 ? 9 : q === 3 ? 12 : 3;
      const endYear = q === 4 ? fyStart + 1 : fyStart;
      const { revenue, gstWise } = aggregateGstWise(facts, (f) => {
        const fStart = fyStartYearForCalendar(f.year, f.month);
        return fStart === fyStart && fyQuarter(f.month) === q;
      });
      points.push({
        key: `FY${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}-Q${q}`,
        label: `Q${q} ${formatFyLabel(fyStart)}`,
        from: fmtDate(new Date(startYear, startMonth - 1, 1)),
        to: fmtDate(new Date(endYear, endMonth, 0)),
        revenue,
        gstWise,
      });
    }
  }
  const withChange = withPercentageChange(points);
  return {
    totalRevenue: round2(withChange.reduce((s, p) => s + p.revenue, 0)),
    points: withChange,
  };
}

export function buildHalfYearlySeries(
  facts: MonthGstRevenueFact[],
  fyStartYears: number[],
): RevenueBucketSeries {
  const points: Array<Omit<RevenueGraphPoint, 'percentageChange'>> = [];
  for (const fyStart of fyStartYears) {
    for (const h of [1, 2] as const) {
      const startMonth = h === 1 ? 4 : 10;
      const startYear = fyStart;
      const endMonth = h === 1 ? 9 : 3;
      const endYear = h === 1 ? fyStart : fyStart + 1;
      const { revenue, gstWise } = aggregateGstWise(facts, (f) => {
        const fStart = fyStartYearForCalendar(f.year, f.month);
        return fStart === fyStart && fyHalf(f.month) === h;
      });
      points.push({
        key: `FY${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}-H${h}`,
        label: `H${h} ${formatFyLabel(fyStart)}`,
        from: fmtDate(new Date(startYear, startMonth - 1, 1)),
        to: fmtDate(new Date(endYear, endMonth, 0)),
        revenue,
        gstWise,
      });
    }
  }
  const withChange = withPercentageChange(points);
  return {
    totalRevenue: round2(withChange.reduce((s, p) => s + p.revenue, 0)),
    points: withChange,
  };
}

export function buildYearlySeries(
  facts: MonthGstRevenueFact[],
  fyStartYears: number[],
): RevenueBucketSeries {
  const points: Array<Omit<RevenueGraphPoint, 'percentageChange'>> = [];
  for (const fyStart of fyStartYears) {
    const win = fyWindow(fyStart);
    const { revenue, gstWise } = aggregateGstWise(facts, (f) => {
      return fyStartYearForCalendar(f.year, f.month) === fyStart;
    });
    points.push({
      key: `FY${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}`,
      label: win.label,
      from: fmtDate(win.from),
      to: fmtDate(win.to),
      revenue,
      gstWise,
    });
  }
  const withChange = withPercentageChange(points);
  return {
    totalRevenue: round2(withChange.reduce((s, p) => s + p.revenue, 0)),
    points: withChange,
  };
}

export function buildRangeBlock(
  facts: MonthGstRevenueFact[],
  rangeYears: 1 | 3 | 5,
  asOf: Date,
): RevenueRangeBlock {
  const { from, to, fyStartYears, financialYears } = resolveRangeWindow(
    rangeYears,
    asOf,
  );
  const inRange = facts.filter((f) =>
    isYearMonthInRange(f.year, f.month, from, to),
  );
  const totalRevenue = round2(inRange.reduce((s, f) => s + f.revenue, 0));

  const block: RevenueRangeBlock = {
    financialYears,
    from: fmtDate(from),
    to: fmtDate(to),
    totalRevenue,
  };

  if (rangeYears === 1) {
    block.monthly = buildMonthlySeries(inRange, from, to);
    block.quarterly = buildQuarterlySeries(inRange, fyStartYears);
    block.halfYearly = buildHalfYearlySeries(inRange, fyStartYears);
  } else {
    block.quarterly = buildQuarterlySeries(inRange, fyStartYears);
    block.halfYearly = buildHalfYearlySeries(inRange, fyStartYears);
    block.yearly = buildYearlySeries(inRange, fyStartYears);
  }

  return block;
}

export function formatDateIso(d: Date): string {
  return fmtDate(d);
}
