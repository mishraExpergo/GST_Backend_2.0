import {
  buildDelayedFilingRangeBlock,
  pickTopDefaultingGstins,
} from './gst-dashboard-delayed-filing-behaviour.util';
import { computeDelayedFilingPercent } from './gst-dashboard-filing-behaviour.util';

describe('gst-dashboard-delayed-filing-behaviour.util', () => {
  it('computes delayed percent (null when no applicable)', () => {
    expect(computeDelayedFilingPercent(1, 12)).toBe(8.33);
    expect(computeDelayedFilingPercent(3, 12)).toBe(25);
    expect(computeDelayedFilingPercent(0, 0)).toBeNull();
  });

  it('picks top defaulting GSTINs by delayed %', () => {
    const top = pickTopDefaultingGstins(
      [
        {
          gstin: 'G1',
          legalName: null,
          entityType: null,
          pan: null,
          applicableCount: 10,
          onTimeCount: 9,
          delayedCount: 1,
          notFiledCount: 0,
          delayedFilingPercent: 10,
        },
        {
          gstin: 'G2',
          legalName: null,
          entityType: null,
          pan: null,
          applicableCount: 10,
          onTimeCount: 5,
          delayedCount: 5,
          notFiledCount: 0,
          delayedFilingPercent: 50,
        },
        {
          gstin: 'G3',
          legalName: null,
          entityType: null,
          pan: null,
          applicableCount: 10,
          onTimeCount: 10,
          delayedCount: 0,
          notFiledCount: 0,
          delayedFilingPercent: 0,
        },
      ],
      2,
    );
    expect(top.map((g) => g.gstin)).toEqual(['G2', 'G1']);
  });

  it('builds half-yearly delayed series with percentageChange', () => {
    const asOf = new Date(2024, 7, 1); // FY 2024-25 → 3y includes FY 2022-23..
    const facts = [4, 5, 6, 7, 8, 9].flatMap((month) => [
      {
        year: 2022,
        month,
        gstin: 'G1',
        legalName: null,
        entityType: null,
        pan: null,
        filingStatus: 'FILED',
        filingDelayDays: month === 9 ? 2 : 0,
      },
      {
        year: 2022,
        month,
        gstin: 'G2',
        legalName: null,
        entityType: null,
        pan: null,
        filingStatus: 'FILED',
        filingDelayDays: 0,
      },
    ]);
    // 1 delayed of 12 → 8.33%
    const three = buildDelayedFilingRangeBlock(facts, 3, asOf);
    expect(three.halfYearly).toBeDefined();
    const h1 = three.halfYearly!.points.find(
      (p) => p.key.includes('2022') && p.key.includes('H1'),
    );
    expect(h1?.delayedFilingPercent).toBe(8.33);
    expect(h1?.topDefaultingGstins[0]?.gstin).toBe('G1');
    expect(h1?.percentageChange).toBeNull();

    // H2 empty → null (not 0)
    const h2 = three.halfYearly!.points.find(
      (p) => p.key.includes('2022') && p.key.includes('H2'),
    );
    expect(h2?.delayedFilingPercent).toBeNull();
  });

  it('includes yearly yoyChangePp for delayed %', () => {
    const asOf = new Date(2026, 7, 11);
    const facts = [
      {
        year: 2024,
        month: 4,
        gstin: 'G1',
        legalName: null,
        entityType: null,
        pan: null,
        filingStatus: 'FILED',
        filingDelayDays: 0,
      },
      {
        year: 2025,
        month: 4,
        gstin: 'G1',
        legalName: null,
        entityType: null,
        pan: null,
        filingStatus: 'FILED',
        filingDelayDays: 3,
      },
    ];
    const three = buildDelayedFilingRangeBlock(facts, 3, asOf);
    const fy25 = three.yearly!.points.find((p) => p.key === 'FY2025-26');
    expect(fy25?.delayedFilingPercent).toBe(100);
    expect(fy25?.yoyChangePp).toBe(100);
  });
});
