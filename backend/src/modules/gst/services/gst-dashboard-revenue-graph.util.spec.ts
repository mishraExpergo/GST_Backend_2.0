import {
  aggregateGstWise,
  buildMonthlySeries,
  buildRangeBlock,
  computePercentageChange,
  formatFyLabel,
  getCurrentFyStartYear,
  resolveRangeWindow,
} from './gst-dashboard-revenue-graph.util';

describe('gst-dashboard-revenue-graph.util', () => {
  it('resolves current FY from asOf date (Aug 2026 → FY 2026-27)', () => {
    const asOf = new Date(2026, 7, 11);
    expect(getCurrentFyStartYear(asOf)).toBe(2026);
    expect(formatFyLabel(2026)).toBe('FY 2026-27');

    const one = resolveRangeWindow(1, asOf);
    expect(one.financialYears).toEqual(['FY 2026-27']);
    expect(one.from).toEqual(new Date(2026, 3, 1));
    expect(one.to).toEqual(new Date(2027, 2, 31));

    const three = resolveRangeWindow(3, asOf);
    expect(three.financialYears).toEqual([
      'FY 2024-25',
      'FY 2025-26',
      'FY 2026-27',
    ]);
  });

  it('builds monthly points with gstWise breakdown', () => {
    const from = new Date(2026, 3, 1);
    const to = new Date(2027, 2, 31);
    const series = buildMonthlySeries(
      [
        {
          year: 2026,
          month: 4,
          gstin: '09AAAAA0000A1Z5',
          revenue: 60,
          legalName: 'A Co',
          entityType: 'PRIMARY',
          pan: 'AAAAA0000A',
        },
        {
          year: 2026,
          month: 4,
          gstin: '27BBBBB0000B1Z5',
          revenue: 40,
          legalName: 'B Co',
          entityType: 'COAPPLICANT_ENTITY',
          pan: 'BBBBB0000B',
        },
        {
          year: 2026,
          month: 5,
          gstin: '09AAAAA0000A1Z5',
          revenue: 200,
          legalName: 'A Co',
          entityType: 'PRIMARY',
          pan: 'AAAAA0000A',
        },
      ],
      from,
      to,
    );
    expect(series.points).toHaveLength(12);
    expect(series.points[0]).toMatchObject({
      key: '2026-04',
      revenue: 100,
      percentageChange: null,
    });
    expect(series.points[0].gstWise).toEqual([
      {
        gstin: '09AAAAA0000A1Z5',
        revenue: 60,
        sharePercent: 60,
        legalName: 'A Co',
        entityType: 'PRIMARY',
        pan: 'AAAAA0000A',
      },
      {
        gstin: '27BBBBB0000B1Z5',
        revenue: 40,
        sharePercent: 40,
        legalName: 'B Co',
        entityType: 'COAPPLICANT_ENTITY',
        pan: 'BBBBB0000B',
      },
    ]);
    expect(series.points[1]).toMatchObject({
      revenue: 200,
      percentageChange: 100,
    });
    expect(series.points[1].gstWise).toHaveLength(1);
    expect(series.points[2]).toMatchObject({
      revenue: 0,
      percentageChange: -100,
      gstWise: [],
    });
    expect(series.totalRevenue).toBe(300);
  });

  it('aggregates gstWise across months in a period', () => {
    const { revenue, gstWise } = aggregateGstWise(
      [
        {
          year: 2026,
          month: 4,
          gstin: 'G1',
          revenue: 10,
          legalName: null,
          entityType: null,
          pan: null,
        },
        {
          year: 2026,
          month: 5,
          gstin: 'G1',
          revenue: 15,
          legalName: null,
          entityType: null,
          pan: null,
        },
        {
          year: 2026,
          month: 5,
          gstin: 'G2',
          revenue: 5,
          legalName: null,
          entityType: null,
          pan: null,
        },
      ],
      (f) => f.month === 4 || f.month === 5,
    );
    expect(revenue).toBe(30);
    expect(gstWise[0]).toMatchObject({ gstin: 'G1', revenue: 25, sharePercent: 83.33 });
    expect(gstWise[1]).toMatchObject({ gstin: 'G2', revenue: 5, sharePercent: 16.67 });
  });

  it('computes percentage change and handles zero previous', () => {
    expect(computePercentageChange(200, 100)).toBe(100);
    expect(computePercentageChange(50, 100)).toBe(-50);
    expect(computePercentageChange(100, 0)).toBeNull();
    expect(computePercentageChange(100, null)).toBeNull();
  });

  it('includes expected buckets for 1y vs 3y', () => {
    const asOf = new Date(2026, 7, 11);
    const facts = [
      {
        year: 2026,
        month: 4,
        gstin: 'G1',
        revenue: 10,
        legalName: null,
        entityType: null,
        pan: null,
      },
      {
        year: 2025,
        month: 4,
        gstin: 'G1',
        revenue: 20,
        legalName: null,
        entityType: null,
        pan: null,
      },
    ];
    const one = buildRangeBlock(facts, 1, asOf);
    expect(one.monthly).toBeDefined();
    expect(one.quarterly).toBeDefined();
    expect(one.halfYearly).toBeDefined();
    expect(one.yearly).toBeUndefined();
    expect(one.monthly!.points[0].gstWise).toBeDefined();

    const three = buildRangeBlock(facts, 3, asOf);
    expect(three.monthly).toBeUndefined();
    expect(three.yearly?.points).toHaveLength(3);
    expect(three.yearly!.points.every((p) => Array.isArray(p.gstWise))).toBe(
      true,
    );
  });
});
