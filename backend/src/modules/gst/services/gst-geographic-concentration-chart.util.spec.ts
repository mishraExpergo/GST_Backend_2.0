import {
  CONCENTRATION_BANDS,
  STRESS_BANDS,
} from '../config/geographic-risk-config';
import {
  buildStateRows,
  extractOutwardTaxLiability,
  outstandingTax,
  pctShare,
  renormalizedComposite,
  resolveMapFinancialYear,
  returnPeriodInMonths,
  scoreFromBands,
  stateCodeFromGstin,
} from './gst-geographic-concentration-chart.util';

describe('gst-geographic-concentration-chart.util', () => {
  it('uses the latest FY in range as the map year', () => {
    const asOf = new Date('2026-08-15T12:00:00Z');
    const oneYear = resolveMapFinancialYear('1y', asOf);
    expect(oneYear.financialYear).toBe('2026-27');
    expect(oneYear.months).toHaveLength(12);

    const threeYear = resolveMapFinancialYear('3y', asOf);
    expect(threeYear.financialYear).toBe('2026-27');
  });

  it('maps GSTIN prefix to state and scores concentration bands', () => {
    expect(stateCodeFromGstin('27AAACN0255D1ZM')).toBe('27');
    expect(scoreFromBands(8, CONCENTRATION_BANDS).label).toBe('VERY_LOW');
    expect(scoreFromBands(25, CONCENTRATION_BANDS).label).toBe('MEDIUM');
    expect(scoreFromBands(12, STRESS_BANDS).label).toBe('MEDIUM');
    expect(pctShare(40, 100)).toBe(40);
    expect(pctShare(10, null)).toBeNull();
    expect(pctShare(10, 0)).toBeNull();
  });

  it('nets outstanding tax at zero instead of negative', () => {
    expect(outstandingTax(100, 40, 70)).toBe(0);
    expect(outstandingTax(100, 40, 50)).toBe(10);
  });

  it('reads outward tax from GSTR-3B osup_det', () => {
    expect(
      extractOutwardTaxLiability({
        data: {
          data: {
            sup_details: {
              osup_det: { iamt: 10, camt: 5, samt: 5, csamt: 1, txval: 100 },
            },
          },
        },
      }),
    ).toBe(21);
  });

  it('builds state composites from company shares and renormalizes missing factors', () => {
    const rows = buildStateRows(
      [
        {
          gstin: '27AAAAA0000A1Z5',
          stateCode: '27',
          status: 'ACTIVE',
          purchaseValue: 80,
          revenue: 90,
          outstandingTax: 30,
          delayedReturnCount: 2,
          activeNoticeCount: 1,
        },
        {
          gstin: '29BBBBB0000B1Z6',
          stateCode: '29',
          status: 'CANCELLED',
          purchaseValue: 20,
          revenue: 10,
          outstandingTax: 0,
          delayedReturnCount: 0,
          activeNoticeCount: 0,
        },
      ],
      true,
      true,
      true,
      true,
    );
    expect(rows[0].stateCode).toBe('27');
    expect(rows[0].factors.revenue.rawPct).toBe(90);
    expect(rows[0].factors.gstinCancelled.rawPct).toBe(0);
    expect(rows[1].factors.gstinCancelled.rawPct).toBe(100);
    expect(rows[0].compositeScore).not.toBeNull();
    expect(
      renormalizedComposite([
        { score: 100, weight: 0.3 },
        { score: null, weight: 0.7 },
      ]),
    ).toBe(100);
  });

  it('matches GSTR-1 return periods to FY months', () => {
    expect(
      returnPeriodInMonths('042026', [{ year: 2026, month: 4 }]),
    ).toBe(true);
    expect(
      returnPeriodInMonths('032026', [{ year: 2026, month: 4 }]),
    ).toBe(false);
  });
});
