import {
  computePercentageChange,
  isYearMonthInRange,
  resolveRangeWindow,
} from './gst-dashboard-revenue-graph.util';
import {
  aggregateFilingBehaviour,
  buildFilingBehaviourRangeBlock,
  computeNonFilingPercent,
  isGstr1DueDatePassed,
  type FilingBehaviourBucketSeries,
  type FilingBehaviourPoint,
  type FilingBehaviourRangeBlock,
  type GstWiseFilingBehaviour,
  type MonthFilingFact,
  type MissingGstinTrackInfo,
} from './gst-dashboard-filing-behaviour.util';

export type { MissingGstinTrackInfo };

export interface NonFilingGstWise {
  gstin: string;
  legalName: string | null;
  entityType: string | null;
  pan: string | null;
  applicableCount: number;
  onTimeCount: number;
  delayedCount: number;
  notFiledCount: number;
  nonFilingPercent: number | null;
}

export interface NonFilingTotals {
  applicableCount: number;
  onTimeCount: number;
  delayedCount: number;
  notFiledCount: number;
  nonFilingPercent: number | null;
}

export interface NonFilingPoint {
  key: string;
  label: string;
  periodLabel?: string;
  from: string;
  to: string;
  applicableCount: number;
  onTimeCount: number;
  delayedCount: number;
  notFiledCount: number;
  nonFilingPercent: number | null;
  percentageChange: number | null;
  yoyChangePp?: number | null;
  gstWise: NonFilingGstWise[];
  topDefaultingGstins: NonFilingGstWise[];
}

export interface NonFilingBucketSeries {
  totals: NonFilingTotals;
  points: NonFilingPoint[];
}

export interface NonFilingRangeBlock {
  financialYears: string[];
  from: string;
  to: string;
  totals: NonFilingTotals;
  topDefaultingGstins: NonFilingGstWise[];
  monthly?: NonFilingBucketSeries;
  quarterly?: NonFilingBucketSeries;
  halfYearly?: NonFilingBucketSeries;
  yearly?: NonFilingBucketSeries;
}

const DEFAULT_TOP_N = 5;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function toNonFilingGstWise(g: GstWiseFilingBehaviour): NonFilingGstWise {
  return {
    gstin: g.gstin,
    legalName: g.legalName,
    entityType: g.entityType,
    pan: g.pan,
    applicableCount: g.applicableCount,
    onTimeCount: g.onTimeCount,
    delayedCount: g.delayedCount,
    notFiledCount: g.notFiledCount,
    nonFilingPercent: computeNonFilingPercent(
      g.notFiledCount,
      g.applicableCount,
    ),
  };
}

/** Worst non-filers first; drop GSTINs with zero non-filed returns. */
export function pickTopNonFilingGstins(
  gstWise: NonFilingGstWise[],
  limit = DEFAULT_TOP_N,
): NonFilingGstWise[] {
  return [...gstWise]
    .filter((g) => g.notFiledCount > 0)
    .sort((a, b) => {
      const ap = a.nonFilingPercent ?? -1;
      const bp = b.nonFilingPercent ?? -1;
      if (bp !== ap) return bp - ap;
      if (b.notFiledCount !== a.notFiledCount) {
        return b.notFiledCount - a.notFiledCount;
      }
      return a.gstin.localeCompare(b.gstin);
    })
    .slice(0, Math.max(0, limit));
}

function sortGstWiseByNonFiling(gstWise: NonFilingGstWise[]): NonFilingGstWise[] {
  return [...gstWise].sort((a, b) => {
    const ap = a.nonFilingPercent ?? -1;
    const bp = b.nonFilingPercent ?? -1;
    if (bp !== ap) return bp - ap;
    if (b.notFiledCount !== a.notFiledCount) {
      return b.notFiledCount - a.notFiledCount;
    }
    return a.gstin.localeCompare(b.gstin);
  });
}

function toNonFilingTotals(
  point: Pick<
    FilingBehaviourPoint,
    | 'applicableCount'
    | 'onTimeCount'
    | 'delayedCount'
    | 'notFiledCount'
  >,
): NonFilingTotals {
  return {
    applicableCount: point.applicableCount,
    onTimeCount: point.onTimeCount,
    delayedCount: point.delayedCount,
    notFiledCount: point.notFiledCount,
    nonFilingPercent: computeNonFilingPercent(
      point.notFiledCount,
      point.applicableCount,
    ),
  };
}

function mapSeries(
  series: FilingBehaviourBucketSeries | undefined,
  includeYoy: boolean,
  topN: number,
): NonFilingBucketSeries | undefined {
  if (!series) return undefined;

  const raw = series.points.map((p) => {
    const gstWise = sortGstWiseByNonFiling(p.gstWise.map(toNonFilingGstWise));
    const nonFilingPercent = computeNonFilingPercent(
      p.notFiledCount,
      p.applicableCount,
    );
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
      nonFilingPercent,
      gstWise,
      topDefaultingGstins: pickTopNonFilingGstins(gstWise, topN),
    };
  });

  const points: NonFilingPoint[] = raw.map((point, index) => {
    const prev = index === 0 ? null : raw[index - 1];
    const percentageChange =
      point.nonFilingPercent == null || prev?.nonFilingPercent == null
        ? null
        : computePercentageChange(
            point.nonFilingPercent,
            prev.nonFilingPercent,
          );

    const result: NonFilingPoint = {
      ...point,
      percentageChange,
    };

    if (includeYoy) {
      if (
        point.nonFilingPercent == null ||
        prev?.nonFilingPercent == null
      ) {
        result.yoyChangePp = null;
      } else {
        result.yoyChangePp = round2(
          point.nonFilingPercent - prev.nonFilingPercent,
        );
      }
    }

    return result;
  });

  return {
    totals: toNonFilingTotals(series.totals),
    points,
  };
}

/**
 * Build non-filing range block.
 * Only returns whose GSTR-1 due date has passed (asOf) are included —
 * missing track data is never treated as non-filing.
 */
export function buildNonFilingRangeBlock(
  facts: MonthFilingFact[],
  rangeYears: 1 | 3 | 5,
  asOf: Date,
  topN = DEFAULT_TOP_N,
): NonFilingRangeBlock {
  const dueFacts = facts.filter((f) =>
    isGstr1DueDatePassed(f.year, f.month, asOf),
  );

  const block: FilingBehaviourRangeBlock = buildFilingBehaviourRangeBlock(
    dueFacts,
    rangeYears,
    asOf,
  );

  const { from, to } = resolveRangeWindow(rangeYears, asOf);
  const inRange = dueFacts.filter((f) =>
    isYearMonthInRange(f.year, f.month, from, to),
  );
  const rangeGstWise = sortGstWiseByNonFiling(
    aggregateFilingBehaviour(inRange, () => true).gstWise.map(
      toNonFilingGstWise,
    ),
  );

  return {
    financialYears: block.financialYears,
    from: block.from,
    to: block.to,
    totals: toNonFilingTotals(block.totals),
    topDefaultingGstins: pickTopNonFilingGstins(rangeGstWise, topN),
    monthly: mapSeries(block.monthly, false, topN),
    quarterly: mapSeries(block.quarterly, false, topN),
    halfYearly: mapSeries(block.halfYearly, false, topN),
    yearly: mapSeries(block.yearly, true, topN),
  };
}
