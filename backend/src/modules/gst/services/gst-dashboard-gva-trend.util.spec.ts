import { computeGstr2bPurchaseTaxableValue } from './gst-gstr2b-aggregation.util';
import {
  aggregateGstWiseGva,
  buildGvaRangeBlock,
  buildMonthlyGvaSeries,
  computeGva,
  computeGvaMargin,
  computeMarginChangePp,
  mergeMonthGvaFacts,
} from './gst-dashboard-gva-trend.util';

describe('gst-dashboard-gva-trend.util', () => {
  it('computes gva and margin', () => {
    expect(computeGva(1000000, 600000)).toBe(400000);
    expect(computeGvaMargin(400000, 1000000)).toBe(40);
    expect(computeGvaMargin(100, 0)).toBeNull();
    expect(computeMarginChangePp(32.92, 31.54)).toBe(1.38);
    expect(computeMarginChangePp(20, null)).toBeNull();
  });

  it('merges 2B purchases and 3B revenue by gstin+month', () => {
    const facts = mergeMonthGvaFacts(
      [
        {
          year: 2026,
          month: 4,
          gstin: '09AAAAA0000A1Z5',
          purchases: 350000,
          legalName: 'A',
          entityType: 'PRIMARY',
          pan: 'AAAAA0000A',
        },
      ],
      [
        {
          year: 2026,
          month: 4,
          gstin: '09AAAAA0000A1Z5',
          revenue: 600000,
          legalName: 'A',
          entityType: 'PRIMARY',
          pan: 'AAAAA0000A',
        },
        {
          year: 2026,
          month: 4,
          gstin: '27BBBBB0000B1Z5',
          revenue: 400000,
          legalName: 'B',
          entityType: 'COAPPLICANT_ENTITY',
          pan: 'BBBBB0000B',
        },
      ],
    );
    expect(facts).toHaveLength(2);
    const a = facts.find((f) => f.gstin.startsWith('09'));
    expect(a).toMatchObject({ purchases: 350000, revenue: 600000 });
    const b = facts.find((f) => f.gstin.startsWith('27'));
    expect(b).toMatchObject({ purchases: 0, revenue: 400000 });
  });

  it('builds monthly points with gstWise purchases/revenue/gva', () => {
    const series = buildMonthlyGvaSeries(
      [
        {
          year: 2026,
          month: 4,
          gstin: '09AAAAA0000A1Z5',
          purchases: 350000,
          revenue: 600000,
          legalName: 'A Co',
          entityType: 'PRIMARY',
          pan: 'AAAAA0000A',
        },
        {
          year: 2026,
          month: 4,
          gstin: '27BBBBB0000B1Z5',
          purchases: 250000,
          revenue: 400000,
          legalName: 'B Co',
          entityType: 'COAPPLICANT_ENTITY',
          pan: 'BBBBB0000B',
        },
        {
          year: 2026,
          month: 5,
          gstin: '09AAAAA0000A1Z5',
          purchases: 400000,
          revenue: 500000,
          legalName: 'A Co',
          entityType: 'PRIMARY',
          pan: 'AAAAA0000A',
        },
      ],
      new Date(2026, 3, 1),
      new Date(2027, 2, 31),
    );

    expect(series.points).toHaveLength(12);
    expect(series.points[0]).toMatchObject({
      key: '2026-04',
      purchases: 600000,
      revenue: 1000000,
      gva: 400000,
      gvaMargin: 40,
      purchasesPercentageChange: null,
      revenuePercentageChange: null,
      gvaPercentageChange: null,
      gvaMarginChangePp: null,
    });
    expect(series.points[0].gstWise).toHaveLength(2);
    expect(series.points[1]).toMatchObject({
      purchases: 400000,
      revenue: 500000,
      gva: 100000,
      gvaMargin: 20,
      purchasesPercentageChange: -33.33,
      revenuePercentageChange: -50,
      gvaPercentageChange: -75,
      gvaMarginChangePp: -20,
    });
  });

  it('aggregates gstWise across months', () => {
    const agg = aggregateGstWiseGva(
      [
        {
          year: 2026,
          month: 4,
          gstin: 'G1',
          purchases: 10,
          revenue: 30,
          legalName: null,
          entityType: null,
          pan: null,
        },
        {
          year: 2026,
          month: 5,
          gstin: 'G1',
          purchases: 20,
          revenue: 40,
          legalName: null,
          entityType: null,
          pan: null,
        },
      ],
      () => true,
    );
    expect(agg).toMatchObject({
      purchases: 30,
      revenue: 70,
      gva: 40,
      gvaMargin: 57.14,
    });
    expect(agg.gstWise[0].sharePercent.revenue).toBe(100);
  });

  it('includes expected buckets for 1y vs 3y', () => {
    const asOf = new Date(2026, 7, 11);
    const facts = [
      {
        year: 2026,
        month: 4,
        gstin: 'G1',
        purchases: 10,
        revenue: 20,
        legalName: null,
        entityType: null,
        pan: null,
      },
    ];
    const one = buildGvaRangeBlock(facts, 1, asOf);
    expect(one.monthly).toBeDefined();
    expect(one.yearly).toBeUndefined();
    const three = buildGvaRangeBlock(facts, 3, asOf);
    expect(three.monthly).toBeUndefined();
    expect(three.yearly?.points).toHaveLength(3);
  });
});

describe('computeGstr2bPurchaseTaxableValue', () => {
  it('sums structured b2b invoice txval', () => {
    const value = computeGstr2bPurchaseTaxableValue([
      {
        gstr2bResponse: {
          data: {
            docdata: {
              b2b: [
                {
                  ctin: '27AAAAA0000A1Z5',
                  inv: [
                    { inum: 'INV1', txval: 1000 },
                    { inum: 'INV2', txval: 500.5 },
                  ],
                },
              ],
              cdnr: [{ nt: [{ ntnum: 'CN1', ntty: 'C', txval: 200 }] }],
            },
          },
        },
      },
    ]);
    expect(value).toBe(1300.5);
  });

  it('falls back to invoice-level txval walk', () => {
    const value = computeGstr2bPurchaseTaxableValue([
      {
        gstr2bResponse: {
          invoices: [{ inum: 'A1', taxable_value: 250 }, { inum: 'A2', txval: 50 }],
        },
      },
    ]);
    expect(value).toBe(300);
  });
});
