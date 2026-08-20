import {
  computePercentageChange,
  formatFyLabel,
  fyHalf,
  fyQuarter,
  fyStartYearForCalendar,
  fyWindow,
  isYearMonthInRange,
  resolveRangeWindow,
} from './gst-dashboard-revenue-graph.util';

export interface GvaSharePercent {
  purchases: number | null;
  revenue: number | null;
  gva: number | null;
}

export interface GstWiseGva {
  gstin: string;
  purchases: number;
  revenue: number;
  gva: number;
  gvaMargin: number | null;
  sharePercent: GvaSharePercent;
  legalName: string | null;
  entityType: string | null;
  pan: string | null;
}

export interface GvaTrendPoint {
  key: string;
  label: string;
  from: string;
  to: string;
  purchases: number;
  revenue: number;
  gva: number;
  gvaMargin: number | null;
  purchasesPercentageChange: number | null;
  revenuePercentageChange: number | null;
  gvaPercentageChange: number | null;
  /** Percentage-point change vs previous bar (not %). */
  gvaMarginChangePp: number | null;
  gstWise: GstWiseGva[];
}

export interface GvaBucketSeries {
  totals: GvaTotals;
  points: GvaTrendPoint[];
}

export interface GvaTotals {
  purchases: number;
  revenue: number;
  gva: number;
  gvaMargin: number | null;
}

export interface GvaRangeBlock {
  financialYears: string[];
  from: string;
  to: string;
  totals: GvaTotals;
  monthly?: GvaBucketSeries;
  quarterly?: GvaBucketSeries;
  halfYearly?: GvaBucketSeries;
  yearly?: GvaBucketSeries;
}

/** Per borrower GSTIN × calendar month: 2B purchases + 3B revenue. */
export interface MonthGvaFact {
  year: number;
  month: number;
  gstin: string;
  purchases: number;
  revenue: number;
  legalName: string | null;
  entityType: string | null;
  pan: string | null;
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

export function computeGva(revenue: number, purchases: number): number {
  return round2(Number(revenue || 0) - Number(purchases || 0));
}

export function computeGvaMargin(
  gva: number,
  revenue: number,
): number | null {
  if (!Number.isFinite(revenue) || revenue === 0) return null;
  if (!Number.isFinite(gva)) return null;
  return round2((gva / revenue) * 100);
}

export function computeMarginChangePp(
  current: number | null,
  previous: number | null | undefined,
): number | null {
  if (current == null || previous == null) return null;
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  return round2(current - previous);
}

function makeTotals(purchases: number, revenue: number): GvaTotals {
  const gva = computeGva(revenue, purchases);
  return {
    purchases: round2(purchases),
    revenue: round2(revenue),
    gva,
    gvaMargin: computeGvaMargin(gva, revenue),
  };
}

function shareOf(part: number, total: number): number | null {
  if (!Number.isFinite(total) || total === 0) return null;
  return round2((part / total) * 100);
}

/**
 * Aggregate borrower-GSTIN purchases/revenue for facts matching `pred`.
 */
export function aggregateGstWiseGva(
  facts: MonthGvaFact[],
  pred: (f: MonthGvaFact) => boolean,
): {
  purchases: number;
  revenue: number;
  gva: number;
  gvaMargin: number | null;
  gstWise: GstWiseGva[];
} {
  const byGstin = new Map<
    string,
    {
      gstin: string;
      purchases: number;
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
      existing.purchases = round2(existing.purchases + Number(f.purchases || 0));
      existing.revenue = round2(existing.revenue + Number(f.revenue || 0));
      if (!existing.legalName && f.legalName) existing.legalName = f.legalName;
      if (!existing.entityType && f.entityType) {
        existing.entityType = f.entityType;
      }
      if (!existing.pan && f.pan) existing.pan = f.pan;
    } else {
      byGstin.set(gstin, {
        gstin,
        purchases: round2(Number(f.purchases || 0)),
        revenue: round2(Number(f.revenue || 0)),
        legalName: f.legalName ?? null,
        entityType: f.entityType ?? null,
        pan: f.pan ?? null,
      });
    }
  }

  const list = [...byGstin.values()].sort((a, b) => {
    const gvaDiff = computeGva(b.revenue, b.purchases) - computeGva(a.revenue, a.purchases);
    if (gvaDiff !== 0) return gvaDiff;
    return b.revenue - a.revenue;
  });

  const purchases = round2(list.reduce((s, i) => s + i.purchases, 0));
  const revenue = round2(list.reduce((s, i) => s + i.revenue, 0));
  const gva = computeGva(revenue, purchases);
  const gvaMargin = computeGvaMargin(gva, revenue);

  const gstWise: GstWiseGva[] = list.map((item) => {
    const itemGva = computeGva(item.revenue, item.purchases);
    return {
      ...item,
      gva: itemGva,
      gvaMargin: computeGvaMargin(itemGva, item.revenue),
      sharePercent: {
        purchases: shareOf(item.purchases, purchases),
        revenue: shareOf(item.revenue, revenue),
        gva: shareOf(itemGva, gva),
      },
    };
  });

  return { purchases, revenue, gva, gvaMargin, gstWise };
}

function withPeriodChanges(
  points: Array<
    Omit<
      GvaTrendPoint,
      | 'purchasesPercentageChange'
      | 'revenuePercentageChange'
      | 'gvaPercentageChange'
      | 'gvaMarginChangePp'
    >
  >,
): GvaTrendPoint[] {
  return points.map((point, index) => {
    const prev = index === 0 ? null : points[index - 1];
    return {
      ...point,
      purchasesPercentageChange: computePercentageChange(
        point.purchases,
        prev?.purchases,
      ),
      revenuePercentageChange: computePercentageChange(
        point.revenue,
        prev?.revenue,
      ),
      gvaPercentageChange: computePercentageChange(point.gva, prev?.gva),
      gvaMarginChangePp: computeMarginChangePp(
        point.gvaMargin,
        prev?.gvaMargin,
      ),
    };
  });
}

function seriesFromPoints(
  raw: Array<
    Omit<
      GvaTrendPoint,
      | 'purchasesPercentageChange'
      | 'revenuePercentageChange'
      | 'gvaPercentageChange'
      | 'gvaMarginChangePp'
    >
  >,
): GvaBucketSeries {
  const points = withPeriodChanges(raw);
  const purchases = round2(points.reduce((s, p) => s + p.purchases, 0));
  const revenue = round2(points.reduce((s, p) => s + p.revenue, 0));
  return {
    totals: makeTotals(purchases, revenue),
    points,
  };
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

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function buildMonthlyGvaSeries(
  facts: MonthGvaFact[],
  from: Date,
  to: Date,
): GvaBucketSeries {
  const raw: Array<
    Omit<
      GvaTrendPoint,
      | 'purchasesPercentageChange'
      | 'revenuePercentageChange'
      | 'gvaPercentageChange'
      | 'gvaMarginChangePp'
    >
  > = [];
  let cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(to.getFullYear(), to.getMonth(), 1);

  while (cursor <= end) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth() + 1;
    const agg = aggregateGstWiseGva(
      facts,
      (f) => f.year === year && f.month === month,
    );
    raw.push({
      key: monthKey(year, month),
      label: `${MONTH_LABELS[month - 1]} ${year}`,
      from: fmtDate(new Date(year, month - 1, 1)),
      to: fmtDate(new Date(year, month, 0)),
      purchases: agg.purchases,
      revenue: agg.revenue,
      gva: agg.gva,
      gvaMargin: agg.gvaMargin,
      gstWise: agg.gstWise,
    });
    cursor = new Date(year, month, 1);
  }

  return seriesFromPoints(raw);
}

export function buildQuarterlyGvaSeries(
  facts: MonthGvaFact[],
  fyStartYears: number[],
): GvaBucketSeries {
  const raw: Array<
    Omit<
      GvaTrendPoint,
      | 'purchasesPercentageChange'
      | 'revenuePercentageChange'
      | 'gvaPercentageChange'
      | 'gvaMarginChangePp'
    >
  > = [];

  for (const fyStart of fyStartYears) {
    for (const q of [1, 2, 3, 4] as const) {
      const startMonth = q === 1 ? 4 : q === 2 ? 7 : q === 3 ? 10 : 1;
      const startYear = q === 4 ? fyStart + 1 : fyStart;
      const endMonth = q === 1 ? 6 : q === 2 ? 9 : q === 3 ? 12 : 3;
      const endYear = q === 4 ? fyStart + 1 : fyStart;
      const agg = aggregateGstWiseGva(facts, (f) => {
        const fStart = fyStartYearForCalendar(f.year, f.month);
        return fStart === fyStart && fyQuarter(f.month) === q;
      });
      raw.push({
        key: `FY${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}-Q${q}`,
        label: `Q${q} ${formatFyLabel(fyStart)}`,
        from: fmtDate(new Date(startYear, startMonth - 1, 1)),
        to: fmtDate(new Date(endYear, endMonth, 0)),
        purchases: agg.purchases,
        revenue: agg.revenue,
        gva: agg.gva,
        gvaMargin: agg.gvaMargin,
        gstWise: agg.gstWise,
      });
    }
  }

  return seriesFromPoints(raw);
}

export function buildHalfYearlyGvaSeries(
  facts: MonthGvaFact[],
  fyStartYears: number[],
): GvaBucketSeries {
  const raw: Array<
    Omit<
      GvaTrendPoint,
      | 'purchasesPercentageChange'
      | 'revenuePercentageChange'
      | 'gvaPercentageChange'
      | 'gvaMarginChangePp'
    >
  > = [];

  for (const fyStart of fyStartYears) {
    for (const h of [1, 2] as const) {
      const startMonth = h === 1 ? 4 : 10;
      const startYear = fyStart;
      const endMonth = h === 1 ? 9 : 3;
      const endYear = h === 1 ? fyStart : fyStart + 1;
      const agg = aggregateGstWiseGva(facts, (f) => {
        const fStart = fyStartYearForCalendar(f.year, f.month);
        return fStart === fyStart && fyHalf(f.month) === h;
      });
      raw.push({
        key: `FY${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}-H${h}`,
        label: `H${h} ${formatFyLabel(fyStart)}`,
        from: fmtDate(new Date(startYear, startMonth - 1, 1)),
        to: fmtDate(new Date(endYear, endMonth, 0)),
        purchases: agg.purchases,
        revenue: agg.revenue,
        gva: agg.gva,
        gvaMargin: agg.gvaMargin,
        gstWise: agg.gstWise,
      });
    }
  }

  return seriesFromPoints(raw);
}

export function buildYearlyGvaSeries(
  facts: MonthGvaFact[],
  fyStartYears: number[],
): GvaBucketSeries {
  const raw: Array<
    Omit<
      GvaTrendPoint,
      | 'purchasesPercentageChange'
      | 'revenuePercentageChange'
      | 'gvaPercentageChange'
      | 'gvaMarginChangePp'
    >
  > = [];

  for (const fyStart of fyStartYears) {
    const win = fyWindow(fyStart);
    const agg = aggregateGstWiseGva(facts, (f) => {
      return fyStartYearForCalendar(f.year, f.month) === fyStart;
    });
    raw.push({
      key: `FY${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}`,
      label: win.label,
      from: fmtDate(win.from),
      to: fmtDate(win.to),
      purchases: agg.purchases,
      revenue: agg.revenue,
      gva: agg.gva,
      gvaMargin: agg.gvaMargin,
      gstWise: agg.gstWise,
    });
  }

  return seriesFromPoints(raw);
}

export function buildGvaRangeBlock(
  facts: MonthGvaFact[],
  rangeYears: 1 | 3 | 5,
  asOf: Date,
): GvaRangeBlock {
  const { from, to, fyStartYears, financialYears } = resolveRangeWindow(
    rangeYears,
    asOf,
  );
  const inRange = facts.filter((f) =>
    isYearMonthInRange(f.year, f.month, from, to),
  );
  const purchases = round2(inRange.reduce((s, f) => s + f.purchases, 0));
  const revenue = round2(inRange.reduce((s, f) => s + f.revenue, 0));

  const block: GvaRangeBlock = {
    financialYears,
    from: fmtDate(from),
    to: fmtDate(to),
    totals: makeTotals(purchases, revenue),
  };

  if (rangeYears === 1) {
    block.monthly = buildMonthlyGvaSeries(inRange, from, to);
    block.quarterly = buildQuarterlyGvaSeries(inRange, fyStartYears);
    block.halfYearly = buildHalfYearlyGvaSeries(inRange, fyStartYears);
  } else {
    block.quarterly = buildQuarterlyGvaSeries(inRange, fyStartYears);
    block.halfYearly = buildHalfYearlyGvaSeries(inRange, fyStartYears);
    block.yearly = buildYearlyGvaSeries(inRange, fyStartYears);
  }

  return block;
}

/**
 * Merge 2B purchase facts and 3B revenue facts keyed by year|month|gstin.
 */
export function mergeMonthGvaFacts(
  purchaseFacts: Array<Omit<MonthGvaFact, 'revenue'> & { revenue?: number }>,
  revenueFacts: Array<Omit<MonthGvaFact, 'purchases'> & { purchases?: number }>,
): MonthGvaFact[] {
  const map = new Map<string, MonthGvaFact>();

  const keyOf = (year: number, month: number, gstin: string) =>
    `${year}|${month}|${gstin}`;

  for (const f of purchaseFacts) {
    const gstin = String(f.gstin ?? '')
      .trim()
      .toUpperCase();
    if (!gstin) continue;
    const key = keyOf(f.year, f.month, gstin);
    const existing = map.get(key);
    if (existing) {
      existing.purchases = round2(existing.purchases + Number(f.purchases || 0));
      if (!existing.legalName && f.legalName) existing.legalName = f.legalName;
      if (!existing.entityType && f.entityType) {
        existing.entityType = f.entityType;
      }
      if (!existing.pan && f.pan) existing.pan = f.pan;
    } else {
      map.set(key, {
        year: f.year,
        month: f.month,
        gstin,
        purchases: round2(Number(f.purchases || 0)),
        revenue: 0,
        legalName: f.legalName ?? null,
        entityType: f.entityType ?? null,
        pan: f.pan ?? null,
      });
    }
  }

  for (const f of revenueFacts) {
    const gstin = String(f.gstin ?? '')
      .trim()
      .toUpperCase();
    if (!gstin) continue;
    const key = keyOf(f.year, f.month, gstin);
    const existing = map.get(key);
    if (existing) {
      existing.revenue = round2(existing.revenue + Number(f.revenue || 0));
      if (!existing.legalName && f.legalName) existing.legalName = f.legalName;
      if (!existing.entityType && f.entityType) {
        existing.entityType = f.entityType;
      }
      if (!existing.pan && f.pan) existing.pan = f.pan;
    } else {
      map.set(key, {
        year: f.year,
        month: f.month,
        gstin,
        purchases: 0,
        revenue: round2(Number(f.revenue || 0)),
        legalName: f.legalName ?? null,
        entityType: f.entityType ?? null,
        pan: f.pan ?? null,
      });
    }
  }

  return [...map.values()];
}
