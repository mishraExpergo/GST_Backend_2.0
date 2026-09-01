import {
  aggregateFilingBehaviour,
  buildFilingBehaviourRangeBlock,
  buildHalfYearlyFilingSeries,
  buildMissingGstinTrackInfo,
  computeOnTimeFilingPercent,
  trackDocsToMonthFilingFacts,
} from './gst-dashboard-filing-behaviour.util';

describe('gst-dashboard-filing-behaviour.util', () => {
  it('computes on-time percent and null when no applicable', () => {
    expect(computeOnTimeFilingPercent(9, 10)).toBe(90);
    expect(computeOnTimeFilingPercent(0, 0)).toBeNull();
  });

  it('aggregates company on-time across GSTINs', () => {
    const { totals, gstWise } = aggregateFilingBehaviour(
      [
        {
          year: 2021,
          month: 4,
          gstin: 'G1',
          legalName: 'A',
          entityType: 'PRIMARY',
          pan: 'P1',
          filingStatus: 'FILED',
          filingDelayDays: 0,
        },
        {
          year: 2021,
          month: 4,
          gstin: 'G2',
          legalName: 'B',
          entityType: 'COAPPLICANT_ENTITY',
          pan: 'P2',
          filingStatus: 'FILED',
          filingDelayDays: 5,
        },
        {
          year: 2021,
          month: 5,
          gstin: 'G1',
          legalName: 'A',
          entityType: 'PRIMARY',
          pan: 'P1',
          filingStatus: 'NOT FILED',
          filingDelayDays: null,
        },
      ],
      () => true,
    );

    expect(totals).toMatchObject({
      applicableCount: 3,
      onTimeCount: 1,
      delayedCount: 1,
      notFiledCount: 1,
      onTimeFilingPercent: 33.33,
    });
    expect(gstWise).toHaveLength(2);
  });

  it('builds half-yearly points with percentageChange and null empty periods', () => {
    const asOf = new Date(2024, 7, 1); // Aug 2024 → FY 2024-25
    // Use 3y half-yearly window via range block
    const facts = [
      // FY21 H1 — all on time for two months × 1 gstin → need more for 90%
      ...[4, 5, 6, 7, 8, 9].flatMap((month) => [
        {
          year: 2021,
          month,
          gstin: 'G1',
          legalName: null,
          entityType: null,
          pan: null,
          filingStatus: 'FILED' as const,
          filingDelayDays: month === 9 ? 2 : 0,
        },
        {
          year: 2021,
          month,
          gstin: 'G2',
          legalName: null,
          entityType: null,
          pan: null,
          filingStatus: 'FILED' as const,
          filingDelayDays: 0,
        },
      ]),
    ];

    // 12 applicable, 11 on time → 91.67 ≈ chart style
    const series = buildHalfYearlyFilingSeries(facts, [2021]);
    expect(series.points).toHaveLength(2);
    expect(series.points[0].onTimeFilingPercent).toBe(91.67);
    expect(series.points[0].percentageChange).toBeNull();
    // H2 has no facts → null percent (not 0)
    expect(series.points[1]).toMatchObject({
      applicableCount: 0,
      onTimeFilingPercent: null,
      percentageChange: null,
      gstWise: [],
    });
  });

  it('includes yearly yoyChangePp on 3y block', () => {
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
    const three = buildFilingBehaviourRangeBlock(facts, 3, asOf);
    expect(three.monthly).toBeUndefined();
    expect(three.yearly?.points).toHaveLength(3);
    const fy25 = three.yearly!.points.find((p) => p.key === 'FY2025-26');
    expect(fy25?.onTimeFilingPercent).toBe(0);
    expect(fy25?.yoyChangePp).toBe(-100);
  });

  it('extracts facts from track docs and lists missing GSTINs', () => {
    const facts = trackDocsToMonthFilingFacts(
      [
        {
          gstin: '09AAAAA0000A1Z5',
          legalName: 'A',
          entityType: 'PRIMARY',
          pan: 'AAAAA0000A',
          financialYear: 'FY 2021-22',
          returns: [
            {
              year: 2021,
              periods: [
                {
                  month: 'April',
                  status: 'Filed',
                  filedDate: '10-05-2021',
                  returnPeriod: '042021',
                  filing_delay_days: 0,
                },
              ],
            },
          ],
        },
      ],
      (doc) => ({
        gstin: String(doc.gstin),
        legalName: doc.legalName,
        entityType: doc.entityType,
        pan: doc.pan,
      }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      year: 2021,
      month: 4,
      filingStatus: 'FILED',
      filingDelayDays: 0,
    });

    const missing = buildMissingGstinTrackInfo(
      [
        {
          gstin: '09AAAAA0000A1Z5',
          legalName: 'A',
          entityType: 'PRIMARY',
          pan: 'AAAAA0000A',
        },
        {
          gstin: '27BBBBB0000B1Z5',
          legalName: 'B',
          entityType: 'COAPPLICANT_ENTITY',
          pan: 'BBBBB0000B',
        },
      ],
      [
        {
          gstin: '09AAAAA0000A1Z5',
          financialYear: 'FY 2021-22',
          status: 'FETCHED',
          returns: [{ year: 2021, periods: [{ month: 'April' }] }],
        },
      ],
      ['FY 2021-22', 'FY 2022-23'],
    );
    expect(missing).toEqual([
      {
        gstin: '09AAAAA0000A1Z5',
        legalName: 'A',
        entityType: 'PRIMARY',
        pan: 'AAAAA0000A',
        missingSource: 'GSTR-1_TRACK',
        missingFinancialYears: ['FY 2022-23'],
      },
      {
        gstin: '27BBBBB0000B1Z5',
        legalName: 'B',
        entityType: 'COAPPLICANT_ENTITY',
        pan: 'BBBBB0000B',
        missingSource: 'GSTR-1_TRACK',
        missingFinancialYears: ['FY 2021-22', 'FY 2022-23'],
      },
    ]);
  });
});
