import {
  computePercentageChange,
  isYearMonthInRange,
  resolveRangeWindow,
} from './gst-dashboard-revenue-graph.util';
import {
  aggregateFilingBehaviour,
  buildFilingBehaviourRangeBlock,
  computeDelayedFilingPercent,
  type FilingBehaviourBucketSeries,
  type FilingBehaviourPoint,
  type FilingBehaviourRangeBlock,
  type GstWiseFilingBehaviour,
  type MonthFilingFact,
  type MissingGstinTrackInfo,
} from './gst-dashboard-filing-behaviour.util';

export type { MissingGstinTrackInfo };

export interface DelayedGstWise {
  gstin: string;
  legalName: string | null;
  entityType: string | null;
  pan: string | null;
  applicableCount: number;
  onTimeCount: number;
  delayedCount: number;
  notFiledCount: number;
  delayedFilingPercent: number | null;
}

export interface DelayedFilingTotals {
  applicableCount: number;
  onTimeCount: number;
  delayedCount: number;
  notFiledCount: number;
  delayedFilingPercent: number | null;
}

export interface DelayedFilingPoint {
  key: string;
  label: string;
  periodLabel?: string;
  from: string;
  to: string;
  applicableCount: number;
  onTimeCount: number;
  delayedCount: number;
  notFiledCount: number;
  delayedFilingPercent: number | null;
  /** vs previous bar’s delayed %; null if first / previous null / previous 0 */
  percentageChange: number | null;
  /** yearly only: current delayed % − previous delayed % (pp) */
  yoyChangePp?: number | null;
  /** GSTINs sorted by delayed % desc (worst first) */
  gstWise: DelayedGstWise[];
  /** Top defaulting GSTINs for this period (interpretation list) */
  topDefaultingGstins: DelayedGstWise[];
}

export interface DelayedFilingBucketSeries {
  totals: DelayedFilingTotals;
  points: DelayedFilingPoint[];
}

export interface DelayedFilingRangeBlock {
  financialYears: string[];
  from: string;
  to: string;
  totals: DelayedFilingTotals;
  /** Worst delayed GSTINs across the whole range window */
  topDefaultingGstins: DelayedGstWise[];
  monthly?: DelayedFilingBucketSeries;
  quarterly?: DelayedFilingBucketSeries;
  halfYearly?: DelayedFilingBucketSeries;
  yearly?: DelayedFilingBucketSeries;
}

const DEFAULT_TOP_N = 5;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function toDelayedGstWise(g: GstWiseFilingBehaviour): DelayedGstWise {
  return {
    gstin: g.gstin,
    legalName: g.legalName,
    entityType: g.entityType,
    pan: g.pan,
    applicableCount: g.applicableCount,
    onTimeCount: g.onTimeCount,
    delayedCount: g.delayedCount,
    notFiledCount: g.notFiledCount,
    delayedFilingPercent:
      g.delayedFilingPercent ??
      computeDelayedFilingPercent(g.delayedCount, g.applicableCount),
  };
}

/** Sort worst delayed first; drop GSTINs with zero delayed filings. */
export function pickTopDefaultingGstins(
  gstWise: DelayedGstWise[],
  limit = DEFAULT_TOP_N,
): DelayedGstWise[] {
  return [...gstWise]
    .filter((g) => g.delayedCount > 0)
    .sort((a, b) => {
      const ap = a.delayedFilingPercent ?? -1;
      const bp = b.delayedFilingPercent ?? -1;
      if (bp !== ap) return bp - ap;
      if (b.delayedCount !== a.delayedCount) {
        return b.delayedCount - a.delayedCount;
      }
      return a.gstin.localeCompare(b.gstin);
    })
    .slice(0, Math.max(0, limit));
}

function sortGstWiseByDelayed(gstWise: DelayedGstWise[]): DelayedGstWise[] {
  return [...gstWise].sort((a, b) => {
    const ap = a.delayedFilingPercent ?? -1;
    const bp = b.delayedFilingPercent ?? -1;
    if (bp !== ap) return bp - ap;
    if (b.delayedCount !== a.delayedCount) return b.delayedCount - a.delayedCount;
    return a.gstin.localeCompare(b.gstin);
  });
}

function toDelayedTotals(
  point: Pick<
    FilingBehaviourPoint,
    | 'applicableCount'
    | 'onTimeCount'
    | 'delayedCount'
    | 'notFiledCount'
    | 'delayedFilingPercent'
  >,
): DelayedFilingTotals {
  return {
    applicableCount: point.applicableCount,
    onTimeCount: point.onTimeCount,
    delayedCount: point.delayedCount,
    notFiledCount: point.notFiledCount,
    delayedFilingPercent:
      point.delayedFilingPercent ??
      computeDelayedFilingPercent(point.delayedCount, point.applicableCount),
  };
}

function mapSeries(
  series: FilingBehaviourBucketSeries | undefined,
  includeYoy: boolean,
  topN: number,
): DelayedFilingBucketSeries | undefined {
  if (!series) return undefined;

  const raw = series.points.map((p) => {
    const gstWise = sortGstWiseByDelayed(p.gstWise.map(toDelayedGstWise));
    const delayedFilingPercent =
      p.delayedFilingPercent ??
      computeDelayedFilingPercent(p.delayedCount, p.applicableCount);
    return {
      key: p.key,
      label: p.label,
      periodLabel: p.periodLabel,
      from: p.from,
      to: p.to,
      applicableCount: p.applicableCount,
      onTimeCount: p.onTimeCount,
      delayedCount: p.delayedCount,
      notFiledCount: p.notFiledCount,
      delayedFilingPercent,
      gstWise,
      topDefaultingGstins: pickTopDefaultingGstins(gstWise, topN),
    };
  });

  const points: DelayedFilingPoint[] = raw.map((point, index) => {
    const prev = index === 0 ? null : raw[index - 1];
    const percentageChange =
      point.delayedFilingPercent == null ||
      prev?.delayedFilingPercent == null
        ? null
        : computePercentageChange(
            point.delayedFilingPercent,
            prev.delayedFilingPercent,
          );

    const result: DelayedFilingPoint = {
      ...point,
      percentageChange,
    };

    if (includeYoy) {
      if (
        point.delayedFilingPercent == null ||
        prev?.delayedFilingPercent == null
      ) {
        result.yoyChangePp = null;
      } else {
        result.yoyChangePp = round2(
          point.delayedFilingPercent - prev.delayedFilingPercent,
        );
      }
    }

    return result;
  });

  return {
    totals: toDelayedTotals(series.totals),
    points,
  };
}

/**
 * Build delayed-filing range block from the same GSTR-1 facts as on-time API.
 */
export function buildDelayedFilingRangeBlock(
  facts: MonthFilingFact[],
  rangeYears: 1 | 3 | 5,
  asOf: Date,
  topN = DEFAULT_TOP_N,
): DelayedFilingRangeBlock {
  const block: FilingBehaviourRangeBlock = buildFilingBehaviourRangeBlock(
    facts,
    rangeYears,
    asOf,
  );

  const { from, to } = resolveRangeWindow(rangeYears, asOf);
  const inRange = facts.filter((f) =>
    isYearMonthInRange(f.year, f.month, from, to),
  );
  const rangeGstWise = sortGstWiseByDelayed(
    aggregateFilingBehaviour(inRange, () => true).gstWise.map(toDelayedGstWise),
  );

  return {
    financialYears: block.financialYears,
    from: block.from,
    to: block.to,
    totals: toDelayedTotals(block.totals),
    topDefaultingGstins: pickTopDefaultingGstins(rangeGstWise, topN),
    monthly: mapSeries(block.monthly, false, topN),
    quarterly: mapSeries(block.quarterly, false, topN),
    halfYearly: mapSeries(block.halfYearly, false, topN),
    yearly: mapSeries(block.yearly, true, topN),
  };
}
