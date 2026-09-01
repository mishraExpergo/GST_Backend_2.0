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
import { extractGstrTrackReturnPeriodRows } from './gst-gstr-track-aggregation.util';

export interface FilingBehaviourTotals {
  applicableCount: number;
  onTimeCount: number;
  delayedCount: number;
  notFiledCount: number;
  onTimeFilingPercent: number | null;
  delayedFilingPercent: number | null;
}

export interface GstWiseFilingBehaviour {
  gstin: string;
  legalName: string | null;
  entityType: string | null;
  pan: string | null;
  applicableCount: number;
  onTimeCount: number;
  delayedCount: number;
  notFiledCount: number;
  onTimeFilingPercent: number | null;
  delayedFilingPercent: number | null;
}

export interface FilingBehaviourPoint {
  key: string;
  label: string;
  periodLabel?: string;
  from: string;
  to: string;
  applicableCount: number;
  onTimeCount: number;
  delayedCount: number;
  notFiledCount: number;
  onTimeFilingPercent: number | null;
  delayedFilingPercent: number | null;
  percentageChange: number | null;
  /** Only on yearly points: current FY % − previous FY % (pp). */
  yoyChangePp?: number | null;
  gstWise: GstWiseFilingBehaviour[];
}

export interface FilingBehaviourBucketSeries {
  totals: FilingBehaviourTotals;
  points: FilingBehaviourPoint[];
}

export interface FilingBehaviourRangeBlock {
  financialYears: string[];
  from: string;
  to: string;
  totals: FilingBehaviourTotals;
  monthly?: FilingBehaviourBucketSeries;
  quarterly?: FilingBehaviourBucketSeries;
  halfYearly?: FilingBehaviourBucketSeries;
  yearly?: FilingBehaviourBucketSeries;
}

export interface MissingGstinTrackInfo {
  gstin: string;
  legalName: string | null;
  entityType: string | null;
  pan: string | null;
  missingSource: 'GSTR-1_TRACK';
  missingFinancialYears: string[];
}

/** One GSTR-1 filing fact for a borrower GSTIN × return month. */
export interface MonthFilingFact {
  year: number;
  month: number;
  gstin: string;
  legalName: string | null;
  entityType: string | null;
  pan: string | null;
  /** FILED | NOT FILED | other */
  filingStatus: string;
  /** 0 = on time; >0 delayed; null = unknown / not filed */
  filingDelayDays: number | null;
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

function yy(year: number): string {
  return String(year % 100).padStart(2, '0');
}

const MONTH_SHORT = [
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

export function computeOnTimeFilingPercent(
  onTimeCount: number,
  applicableCount: number,
): number | null {
  if (!Number.isFinite(applicableCount) || applicableCount <= 0) {
    return null;
  }
  if (!Number.isFinite(onTimeCount) || onTimeCount < 0) {
    return null;
  }
  return round2((onTimeCount / applicableCount) * 100);
}

/** Delayed % = delayedCount ÷ applicableCount × 100 (null if no applicable). */
export function computeDelayedFilingPercent(
  delayedCount: number,
  applicableCount: number,
): number | null {
  if (!Number.isFinite(applicableCount) || applicableCount <= 0) {
    return null;
  }
  if (!Number.isFinite(delayedCount) || delayedCount < 0) {
    return null;
  }
  return round2((delayedCount / applicableCount) * 100);
}

/** Non-filing % = notFiledCount ÷ applicableCount × 100 (null if no applicable). */
export function computeNonFilingPercent(
  notFiledCount: number,
  applicableCount: number,
): number | null {
  if (!Number.isFinite(applicableCount) || applicableCount <= 0) {
    return null;
  }
  if (!Number.isFinite(notFiledCount) || notFiledCount < 0) {
    return null;
  }
  return round2((notFiledCount / applicableCount) * 100);
}

/**
 * GSTR-1 monthly due date is the 11th of the following calendar month.
 * Non-filing only applies after that calendar day has ended (12th onward).
 */
export function isGstr1DueDatePassed(
  year: number,
  month: number,
  asOf: Date,
): boolean {
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    month < 1 ||
    month > 12
  ) {
    return false;
  }
  const dueMonth = month === 12 ? 1 : month + 1;
  const dueYear = month === 12 ? year + 1 : year;
  const dueDay = new Date(dueYear, dueMonth - 1, 11);
  const asOfDay = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  return asOfDay.getTime() > dueDay.getTime();
}

function emptyTotals(): FilingBehaviourTotals {
  return {
    applicableCount: 0,
    onTimeCount: 0,
    delayedCount: 0,
    notFiledCount: 0,
    onTimeFilingPercent: null,
    delayedFilingPercent: null,
  };
}

function classifyFact(f: MonthFilingFact): {
  applicable: boolean;
  onTime: boolean;
  delayed: boolean;
  notFiled: boolean;
} {
  const status = String(f.filingStatus ?? '')
    .trim()
    .toUpperCase()
    .replace(/_/g, ' ');
  const notFiled =
    status === 'NOT FILED' ||
    (status.includes('NOT FILED') && !status.includes('FILED ON'));
  const filed =
    status === 'FILED' ||
    (status.includes('FILED') && !status.includes('NOT'));

  if (notFiled) {
    return { applicable: true, onTime: false, delayed: false, notFiled: true };
  }
  if (filed) {
    if (f.filingDelayDays === 0) {
      return { applicable: true, onTime: true, delayed: false, notFiled: false };
    }
    if (f.filingDelayDays != null && f.filingDelayDays > 0) {
      return { applicable: true, onTime: false, delayed: true, notFiled: false };
    }
    // Filed but timing unknown — still applicable, not counted on-time
    return { applicable: true, onTime: false, delayed: false, notFiled: false };
  }
  // Unknown status with a track row — treat as applicable / not filed
  return { applicable: true, onTime: false, delayed: false, notFiled: true };
}

/**
 * Aggregate company + gstWise filing stats for facts matching `pred`.
 * Each GSTIN × return-month is one applicable unit.
 */
export function aggregateFilingBehaviour(
  facts: MonthFilingFact[],
  pred: (f: MonthFilingFact) => boolean,
): {
  totals: FilingBehaviourTotals;
  gstWise: GstWiseFilingBehaviour[];
} {
  const byGstin = new Map<
    string,
    {
      gstin: string;
      legalName: string | null;
      entityType: string | null;
      pan: string | null;
      applicableCount: number;
      onTimeCount: number;
      delayedCount: number;
      notFiledCount: number;
    }
  >();

  for (const f of facts) {
    if (!pred(f)) continue;
    const gstin =
      String(f.gstin ?? '')
        .trim()
        .toUpperCase() || 'UNKNOWN';
    let bucket = byGstin.get(gstin);
    if (!bucket) {
      bucket = {
        gstin,
        legalName: f.legalName ?? null,
        entityType: f.entityType ?? null,
        pan: f.pan ?? null,
        applicableCount: 0,
        onTimeCount: 0,
        delayedCount: 0,
        notFiledCount: 0,
      };
      byGstin.set(gstin, bucket);
    } else {
      if (!bucket.legalName && f.legalName) bucket.legalName = f.legalName;
      if (!bucket.entityType && f.entityType) bucket.entityType = f.entityType;
      if (!bucket.pan && f.pan) bucket.pan = f.pan;
    }

    const c = classifyFact(f);
    if (!c.applicable) continue;
    bucket.applicableCount += 1;
    if (c.onTime) bucket.onTimeCount += 1;
    if (c.delayed) bucket.delayedCount += 1;
    if (c.notFiled) bucket.notFiledCount += 1;
  }

  const list = [...byGstin.values()].sort((a, b) => {
    const ap =
      computeOnTimeFilingPercent(a.onTimeCount, a.applicableCount) ?? -1;
    const bp =
      computeOnTimeFilingPercent(b.onTimeCount, b.applicableCount) ?? -1;
    if (bp !== ap) return bp - ap;
    return a.gstin.localeCompare(b.gstin);
  });

  let applicableCount = 0;
  let onTimeCount = 0;
  let delayedCount = 0;
  let notFiledCount = 0;
  for (const item of list) {
    applicableCount += item.applicableCount;
    onTimeCount += item.onTimeCount;
    delayedCount += item.delayedCount;
    notFiledCount += item.notFiledCount;
  }

  const totals: FilingBehaviourTotals = {
    applicableCount,
    onTimeCount,
    delayedCount,
    notFiledCount,
    onTimeFilingPercent: computeOnTimeFilingPercent(
      onTimeCount,
      applicableCount,
    ),
    delayedFilingPercent: computeDelayedFilingPercent(
      delayedCount,
      applicableCount,
    ),
  };

  const gstWise: GstWiseFilingBehaviour[] = list.map((item) => ({
    ...item,
    onTimeFilingPercent: computeOnTimeFilingPercent(
      item.onTimeCount,
      item.applicableCount,
    ),
    delayedFilingPercent: computeDelayedFilingPercent(
      item.delayedCount,
      item.applicableCount,
    ),
  }));

  return { totals, gstWise };
}

function withPeriodChanges(
  points: Array<Omit<FilingBehaviourPoint, 'percentageChange' | 'yoyChangePp'>>,
  includeYoy: boolean,
): FilingBehaviourPoint[] {
  return points.map((point, index) => {
    const prev = index === 0 ? null : points[index - 1];
    const percentageChange = computePercentageChange(
      point.onTimeFilingPercent ?? NaN,
      prev?.onTimeFilingPercent,
    );
    const result: FilingBehaviourPoint = {
      ...point,
      percentageChange:
        point.onTimeFilingPercent == null || prev?.onTimeFilingPercent == null
          ? null
          : percentageChange,
    };
    if (includeYoy) {
      if (
        point.onTimeFilingPercent == null ||
        prev?.onTimeFilingPercent == null
      ) {
        result.yoyChangePp = null;
      } else {
        result.yoyChangePp = round2(
          point.onTimeFilingPercent - prev.onTimeFilingPercent,
        );
      }
    }
    return result;
  });
}

function seriesFromPoints(
  raw: Array<Omit<FilingBehaviourPoint, 'percentageChange' | 'yoyChangePp'>>,
  includeYoy = false,
): FilingBehaviourBucketSeries {
  const points = withPeriodChanges(raw, includeYoy);
  let applicableCount = 0;
  let onTimeCount = 0;
  let delayedCount = 0;
  let notFiledCount = 0;
  for (const p of points) {
    applicableCount += p.applicableCount;
    onTimeCount += p.onTimeCount;
    delayedCount += p.delayedCount;
    notFiledCount += p.notFiledCount;
  }
  return {
    totals: {
      applicableCount,
      onTimeCount,
      delayedCount,
      notFiledCount,
      onTimeFilingPercent: computeOnTimeFilingPercent(
        onTimeCount,
        applicableCount,
      ),
      delayedFilingPercent: computeDelayedFilingPercent(
        delayedCount,
        applicableCount,
      ),
    },
    points,
  };
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function buildMonthlyFilingSeries(
  facts: MonthFilingFact[],
  from: Date,
  to: Date,
): FilingBehaviourBucketSeries {
  const raw: Array<
    Omit<FilingBehaviourPoint, 'percentageChange' | 'yoyChangePp'>
  > = [];
  let cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(to.getFullYear(), to.getMonth(), 1);

  while (cursor <= end) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth() + 1;
    const { totals, gstWise } = aggregateFilingBehaviour(
      facts,
      (f) => f.year === year && f.month === month,
    );
    raw.push({
      key: monthKey(year, month),
      label: `${MONTH_SHORT[month - 1]} ${year}`,
      from: fmtDate(new Date(year, month - 1, 1)),
      to: fmtDate(new Date(year, month, 0)),
      ...totals,
      gstWise,
    });
    cursor = new Date(year, month, 1);
  }

  return seriesFromPoints(raw);
}

export function buildQuarterlyFilingSeries(
  facts: MonthFilingFact[],
  fyStartYears: number[],
): FilingBehaviourBucketSeries {
  const raw: Array<
    Omit<FilingBehaviourPoint, 'percentageChange' | 'yoyChangePp'>
  > = [];

  for (const fyStart of fyStartYears) {
    for (const q of [1, 2, 3, 4] as const) {
      const startMonth = q === 1 ? 4 : q === 2 ? 7 : q === 3 ? 10 : 1;
      const startYear = q === 4 ? fyStart + 1 : fyStart;
      const endMonth = q === 1 ? 6 : q === 2 ? 9 : q === 3 ? 12 : 3;
      const endYear = q === 4 ? fyStart + 1 : fyStart;
      const { totals, gstWise } = aggregateFilingBehaviour(facts, (f) => {
        const fStart = fyStartYearForCalendar(f.year, f.month);
        return fStart === fyStart && fyQuarter(f.month) === q;
      });
      raw.push({
        key: `FY${fyStart}-${yy(fyStart + 1)}-Q${q}`,
        label: `Q${q} ${formatFyLabel(fyStart)}`,
        periodLabel: `${MONTH_SHORT[startMonth - 1]} ${yy(startYear)}–${MONTH_SHORT[endMonth - 1]} ${yy(endYear)}`,
        from: fmtDate(new Date(startYear, startMonth - 1, 1)),
        to: fmtDate(new Date(endYear, endMonth, 0)),
        ...totals,
        gstWise,
      });
    }
  }

  return seriesFromPoints(raw);
}

export function buildHalfYearlyFilingSeries(
  facts: MonthFilingFact[],
  fyStartYears: number[],
): FilingBehaviourBucketSeries {
  const raw: Array<
    Omit<FilingBehaviourPoint, 'percentageChange' | 'yoyChangePp'>
  > = [];

  for (const fyStart of fyStartYears) {
    for (const h of [1, 2] as const) {
      const startMonth = h === 1 ? 4 : 10;
      const startYear = fyStart;
      const endMonth = h === 1 ? 9 : 3;
      const endYear = h === 1 ? fyStart : fyStart + 1;
      const { totals, gstWise } = aggregateFilingBehaviour(facts, (f) => {
        const fStart = fyStartYearForCalendar(f.year, f.month);
        return fStart === fyStart && fyHalf(f.month) === h;
      });
      raw.push({
        key: `FY${fyStart}-${yy(fyStart + 1)}-H${h}`,
        label: `H${h} ${formatFyLabel(fyStart)}`,
        periodLabel: `${MONTH_SHORT[startMonth - 1]} ${yy(startYear)}–${MONTH_SHORT[endMonth - 1]} ${yy(endYear)}`,
        from: fmtDate(new Date(startYear, startMonth - 1, 1)),
        to: fmtDate(new Date(endYear, endMonth, 0)),
        ...totals,
        gstWise,
      });
    }
  }

  return seriesFromPoints(raw);
}

export function buildYearlyFilingSeries(
  facts: MonthFilingFact[],
  fyStartYears: number[],
): FilingBehaviourBucketSeries {
  const raw: Array<
    Omit<FilingBehaviourPoint, 'percentageChange' | 'yoyChangePp'>
  > = [];

  for (const fyStart of fyStartYears) {
    const win = fyWindow(fyStart);
    const { totals, gstWise } = aggregateFilingBehaviour(facts, (f) => {
      return fyStartYearForCalendar(f.year, f.month) === fyStart;
    });
    raw.push({
      key: `FY${fyStart}-${yy(fyStart + 1)}`,
      label: win.label,
      periodLabel: win.label,
      from: fmtDate(win.from),
      to: fmtDate(win.to),
      ...totals,
      gstWise,
    });
  }

  return seriesFromPoints(raw, true);
}

export function buildFilingBehaviourRangeBlock(
  facts: MonthFilingFact[],
  rangeYears: 1 | 3 | 5,
  asOf: Date,
): FilingBehaviourRangeBlock {
  const { from, to, fyStartYears, financialYears } = resolveRangeWindow(
    rangeYears,
    asOf,
  );
  const inRange = facts.filter((f) =>
    isYearMonthInRange(f.year, f.month, from, to),
  );
  const { totals } = aggregateFilingBehaviour(inRange, () => true);

  const block: FilingBehaviourRangeBlock = {
    financialYears,
    from: fmtDate(from),
    to: fmtDate(to),
    totals: totals.applicableCount === 0 ? emptyTotals() : totals,
  };

  if (rangeYears === 1) {
    block.monthly = buildMonthlyFilingSeries(inRange, from, to);
    block.quarterly = buildQuarterlyFilingSeries(inRange, fyStartYears);
    block.halfYearly = buildHalfYearlyFilingSeries(inRange, fyStartYears);
  } else {
    block.quarterly = buildQuarterlyFilingSeries(inRange, fyStartYears);
    block.halfYearly = buildHalfYearlyFilingSeries(inRange, fyStartYears);
    block.yearly = buildYearlyFilingSeries(inRange, fyStartYears);
  }

  return block;
}

/**
 * Convert Mongo GSTR-1 track docs into per-GSTIN × month filing facts.
 */
export function trackDocsToMonthFilingFacts(
  docs: Array<Record<string, any>>,
  metaOf: (doc: Record<string, any>) => {
    gstin: string;
    legalName: string | null;
    entityType: string | null;
    pan: string | null;
  } | null,
): MonthFilingFact[] {
  const facts: MonthFilingFact[] = [];
  const seen = new Set<string>();

  for (const doc of docs) {
    const meta = metaOf(doc);
    if (!meta) continue;

    for (const row of extractGstrTrackReturnPeriodRows(doc)) {
      const match = String(row.returnPeriod ?? '').match(/^(\d{2})(\d{4})$/);
      if (!match) continue;
      const month = Number(match[1]);
      const year = Number(match[2]);
      if (month < 1 || month > 12 || !Number.isFinite(year)) continue;

      const key = `${meta.gstin}|${year}|${month}`;
      // Prefer FILED if duplicate sources for same GSTIN+month
      if (seen.has(key)) {
        const existingIdx = facts.findIndex(
          (f) =>
            f.gstin === meta.gstin && f.year === year && f.month === month,
        );
        if (existingIdx >= 0) {
          const existing = facts[existingIdx];
          if (
            existing.filingStatus !== 'FILED' &&
            row.filingStatus === 'FILED'
          ) {
            facts[existingIdx] = {
              ...meta,
              year,
              month,
              filingStatus: row.filingStatus,
              filingDelayDays: row.filingDelayDays,
            };
          }
        }
        continue;
      }
      seen.add(key);
      facts.push({
        ...meta,
        year,
        month,
        filingStatus: row.filingStatus,
        filingDelayDays: row.filingDelayDays,
      });
    }
  }

  return facts;
}

/**
 * GSTINs expected for the loan/pan that lack track coverage for one or more FYs.
 */
export function buildMissingGstinTrackInfo(
  expectedGstins: Array<{
    gstin: string;
    legalName: string | null;
    entityType: string | null;
    pan: string | null;
  }>,
  trackDocs: Array<Record<string, any>>,
  requiredFyLabels: string[],
): MissingGstinTrackInfo[] {
  const covered = new Map<string, Set<string>>();

  for (const doc of trackDocs) {
    const gstin = String(doc.gstin ?? doc.gstNo ?? '')
      .trim()
      .toUpperCase();
    if (!gstin) continue;

    const fyRaw = String(doc.financialYear ?? '').trim();
    const fyNorm = normalizeFyLabel(fyRaw);
    const hasRows = extractGstrTrackReturnPeriodRows(doc).length > 0;
    // NO_RECORD / empty still means we "checked" that FY — not missing fetch
    const status = String(doc.status ?? '')
      .trim()
      .toUpperCase();
    const coveredFy =
      hasRows ||
      status === 'NO_RECORD' ||
      status === 'FETCHED' ||
      status === 'INVALID_FY' ||
      Boolean(fyNorm);

    if (!coveredFy || !fyNorm) continue;

    if (!covered.has(gstin)) covered.set(gstin, new Set());
    covered.get(gstin)!.add(fyNorm);
  }

  const missing: MissingGstinTrackInfo[] = [];
  for (const g of expectedGstins) {
    const gstin = String(g.gstin ?? '')
      .trim()
      .toUpperCase();
    if (!gstin) continue;
    const have = covered.get(gstin) ?? new Set<string>();
    const missingFinancialYears = requiredFyLabels.filter(
      (fy) => !have.has(normalizeFyLabel(fy) ?? fy),
    );
    if (missingFinancialYears.length === 0) continue;
    missing.push({
      gstin,
      legalName: g.legalName,
      entityType: g.entityType,
      pan: g.pan,
      missingSource: 'GSTR-1_TRACK',
      missingFinancialYears,
    });
  }

  return missing.sort((a, b) => a.gstin.localeCompare(b.gstin));
}

function normalizeFyLabel(raw: string): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  // Already "FY 2021-22"
  const m1 = s.match(/^FY\s*(\d{4})\s*[-/]\s*(\d{2,4})$/i);
  if (m1) {
    const start = Number(m1[1]);
    return formatFyLabel(start);
  }
  // "2021-22"
  const m2 = s.match(/^(\d{4})\s*[-/]\s*(\d{2,4})$/);
  if (m2) {
    return formatFyLabel(Number(m2[1]));
  }
  return s.toUpperCase().startsWith('FY') ? s : `FY ${s}`;
}
