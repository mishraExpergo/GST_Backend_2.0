import {
  buildNonFilingRangeBlock,
  pickTopNonFilingGstins,
} from './gst-dashboard-non-filing-behaviour.util';
import {
  computeNonFilingPercent,
  isGstr1DueDatePassed,
} from './gst-dashboard-filing-behaviour.util';

describe('gst-dashboard-non-filing-behaviour.util', () => {
  it('computes non-filing percent', () => {
    expect(computeNonFilingPercent(1, 12)).toBe(8.33);
    expect(computeNonFilingPercent(0, 0)).toBeNull();
  });

  it('only treats returns as due after the 11th of next month', () => {
    // Apr 2022 due = 11 May 2022 → non-filing applies from 12 May
    expect(isGstr1DueDatePassed(2022, 4, new Date(2022, 4, 12))).toBe(true);
    expect(isGstr1DueDatePassed(2022, 4, new Date(2022, 4, 11))).toBe(false);
    expect(isGstr1DueDatePassed(2022, 4, new Date(2022, 4, 10))).toBe(false);
  });

  it('picks top non-filing GSTINs', () => {
    const top = pickTopNonFilingGstins(
      [
        {
          gstin: 'G1',
          legalName: null,
          entityType: null,
          pan: null,
          applicableCount: 10,
          onTimeCount: 8,
          delayedCount: 0,
          notFiledCount: 2,
          nonFilingPercent: 20,
        },
        {
          gstin: 'G2',
          legalName: null,
          entityType: null,
          pan: null,
          applicableCount: 10,
          onTimeCount: 5,
          delayedCount: 0,
          notFiledCount: 5,
          nonFilingPercent: 50,
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
          nonFilingPercent: 0,
        },
      ],
      2,
    );
    expect(top.map((g) => g.gstin)).toEqual(['G2', 'G1']);
  });

  it('builds half-yearly non-filing series (null when empty)', () => {
    const asOf = new Date(2024, 7, 1);
    const facts = [4, 5, 6, 7, 8, 9].flatMap((month) => [
      {
        year: 2022,
        month,
        gstin: 'G1',
        legalName: null,
        entityType: null,
        pan: null,
        filingStatus: month === 9 ? 'NOT FILED' : 'FILED',
        filingDelayDays: month === 9 ? null : 0,
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
    // 1 non-filed of 12 → 8.33%
    const three = buildNonFilingRangeBlock(facts, 3, asOf);
    const h1 = three.halfYearly!.points.find(
      (p) => p.key.includes('2022') && p.key.includes('H1'),
    );
    expect(h1?.nonFilingPercent).toBe(8.33);
    expect(h1?.topDefaultingGstins[0]?.gstin).toBe('G1');
    expect(h1?.percentageChange).toBeNull();

    const h2 = three.halfYearly!.points.find(
      (p) => p.key.includes('2022') && p.key.includes('H2'),
    );
    expect(h2?.nonFilingPercent).toBeNull();
  });

  it('excludes returns whose due date has not passed yet', () => {
    // asOf = 5 May 2022 → Apr 2022 due is 11 May → exclude Apr
    const asOf = new Date(2022, 4, 5);
    const facts = [
      {
        year: 2022,
        month: 4,
        gstin: 'G1',
        legalName: null,
        entityType: null,
        pan: null,
        filingStatus: 'NOT FILED',
        filingDelayDays: null,
      },
    ];
    const one = buildNonFilingRangeBlock(facts, 1, asOf);
    const apr = one.monthly!.points.find((p) => p.key === '2022-04');
    expect(apr?.applicableCount).toBe(0);
    expect(apr?.nonFilingPercent).toBeNull();
  });
});
