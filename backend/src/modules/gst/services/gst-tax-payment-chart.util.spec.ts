import {
  buildChartSeries,
  buildPeriodSpecs,
  calendarMonthToFyHalf,
  calendarMonthToFyQuarter,
  filterMonthsUpTo,
  findMissingSlots,
  formatFinancialYear,
  monthsForHalf,
  monthsForQuarter,
  pctChange,
  resolvePeriodSpec,
} from './gst-tax-payment-chart.util';

describe('gst-tax-payment-chart.util', () => {
  const ref = new Date('2026-08-15T00:00:00Z');

  it('maps calendar months to Indian FY halves', () => {
    expect(calendarMonthToFyHalf(2024, 4)).toEqual({
      fyStartYear: 2024,
      half: 'H1',
    });
    expect(calendarMonthToFyHalf(2024, 10)).toEqual({
      fyStartYear: 2024,
      half: 'H2',
    });
    expect(calendarMonthToFyHalf(2025, 2)).toEqual({
      fyStartYear: 2024,
      half: 'H2',
    });
  });

  it('maps calendar months to Indian FY quarters', () => {
    expect(calendarMonthToFyQuarter(2026, 8)).toEqual({
      fyStartYear: 2026,
      quarter: 'Q2',
      half: 'H1',
    });
    expect(calendarMonthToFyQuarter(2026, 1)).toEqual({
      fyStartYear: 2025,
      quarter: 'Q4',
      half: 'H2',
    });
  });

  it('builds H1 months for a FY', () => {
    expect(monthsForHalf(2023, 'H1')).toEqual([
      { year: 2023, month: 4 },
      { year: 2023, month: 5 },
      { year: 2023, month: 6 },
      { year: 2023, month: 7 },
      { year: 2023, month: 8 },
      { year: 2023, month: 9 },
    ]);
  });

  it('builds Q1 months for a FY', () => {
    expect(monthsForQuarter(2024, 'Q1')).toEqual([
      { year: 2024, month: 4 },
      { year: 2024, month: 5 },
      { year: 2024, month: 6 },
    ]);
  });

  it('builds default half-yearly / annual specs from range', () => {
    const oneYear = buildPeriodSpecs('1y', { referenceDate: ref });
    expect(oneYear).toHaveLength(2);
    expect(oneYear.map((s) => s.period)).toEqual([
      'H2 FY25-26',
      'H1 FY26-27',
    ]);
    expect(oneYear.every((s) => s.granularity === 'half-yearly')).toBe(true);

    const threeYear = buildPeriodSpecs('3y', { referenceDate: ref });
    expect(threeYear).toHaveLength(6);
    expect(threeYear[0].period).toBe('H2 FY23-24');
    expect(threeYear[5].period).toBe('H1 FY26-27');

    const fiveYear = buildPeriodSpecs('5y', { referenceDate: ref });
    expect(fiveYear).toHaveLength(5);
    expect(fiveYear.every((s) => s.granularity === 'annual')).toBe(true);
    expect(fiveYear[0].financialYear).toBe(formatFinancialYear(2022));
    expect(fiveYear[4].financialYear).toBe(formatFinancialYear(2026));
  });

  it('builds monthly and quarterly series for 1y', () => {
    const monthly = buildPeriodSpecs('1y', {
      granularity: 'monthly',
      referenceDate: ref,
    });
    expect(monthly).toHaveLength(12);
    expect(monthly[0].period).toBe('Sep 2025');
    expect(monthly[11].period).toBe('Aug 2026');
    expect(monthly.every((s) => s.granularity === 'monthly')).toBe(true);

    const quarterly = buildPeriodSpecs('1y', {
      granularity: 'quarterly',
      referenceDate: ref,
    });
    expect(quarterly).toHaveLength(4);
    expect(quarterly.map((s) => s.period)).toEqual([
      'Q3 FY25-26',
      'Q4 FY25-26',
      'Q1 FY26-27',
      'Q2 FY26-27',
    ]);
  });

  it('never coerces missing periods to zero and keeps null pctChange', () => {
    const specs = buildPeriodSpecs('1y', { referenceDate: ref });
    const series = buildChartSeries(specs, ['27AAACN0255D1ZM'], [], ref);

    expect(series).toHaveLength(2);
    for (const row of series) {
      expect(row.itcUtilised).toBeNull();
      expect(row.cashTaxPaid).toBeNull();
      expect(row.totalPayments).toBeNull();
      expect(row.pctChangeTotal).toBeNull();
      expect(row.pctChangeItc).toBeNull();
      expect(row.pctChangeCash).toBeNull();
    }
  });

  it('sums available months as PARTIAL and computes pctChange', () => {
    const specs = buildPeriodSpecs('1y', { referenceDate: ref });
    const gstin = '27AAACN0255D1ZM';
    const payments = [
      {
        gstin,
        loanId: 'L1',
        customerId: 'C1',
        year: 2025,
        month: 10,
        itcUtilised: 100,
        cashTaxPaid: 50,
      },
      {
        gstin,
        loanId: 'L1',
        customerId: 'C1',
        year: 2025,
        month: 11,
        itcUtilised: 100,
        cashTaxPaid: 50,
      },
      {
        gstin,
        loanId: 'L1',
        customerId: 'C1',
        year: 2026,
        month: 4,
        itcUtilised: 200,
        cashTaxPaid: 100,
      },
    ];

    const series = buildChartSeries(specs, [gstin], payments, ref);
    expect(series[0].itcUtilised).toBe(200);
    expect(series[0].cashTaxPaid).toBe(100);
    expect(series[0].totalPayments).toBe(300);
    expect(series[1].totalPayments).toBe(300);
    expect(series[1].pctChangeTotal).toBe(0);
    expect(series[1].pctChangeItc).toBe(0);
  });

  it('lists missing GSTR-3B months only', () => {
    const spec = resolvePeriodSpec({ financialYear: '2024-25', half: 'H1' });
    const expected = filterMonthsUpTo(spec.months, new Date('2024-08-01'));
    expect(expected).toHaveLength(5); // Apr–Aug

    const missing = findMissingSlots(
      [spec],
      [{ gstin: 'G1', loanId: 'L1', customerId: 'C1' }],
      [
        {
          gstin: 'G1',
          loanId: 'L1',
          customerId: 'C1',
          year: 2024,
          month: 4,
          itcUtilised: 1,
          cashTaxPaid: 1,
        },
      ],
      new Date('2024-08-01'),
    );

    expect(missing.map((m) => m.month).sort((a, b) => a - b)).toEqual([
      5, 6, 7, 8,
    ]);
  });

  it('marks COMPLETE when GSTR-3B exists for all expected months', () => {
    const spec = resolvePeriodSpec({ financialYear: '2024-25', half: 'H1' });
    const refDate = new Date('2024-05-15');
    const gstin = 'G1';
    const payments = [
      {
        gstin,
        loanId: 'L1',
        customerId: 'C1',
        year: 2024,
        month: 4,
        itcUtilised: 20,
        cashTaxPaid: 5,
      },
      {
        gstin,
        loanId: 'L1',
        customerId: 'C1',
        year: 2024,
        month: 5,
        itcUtilised: 25,
        cashTaxPaid: 5,
      },
    ];

    const series = buildChartSeries([spec], [gstin], payments, refDate);
    expect(series[0].itcUtilised).toBe(45);
    expect(series[0].cashTaxPaid).toBe(10);
    expect(series[0].totalPayments).toBe(55);
  });

  it('resolves quarterly and monthly drilldown specs', () => {
    const q = resolvePeriodSpec({ financialYear: '2024-25', quarter: 'Q2' });
    expect(q.period).toBe('Q2 FY24-25');
    expect(q.months).toEqual([
      { year: 2024, month: 7 },
      { year: 2024, month: 8 },
      { year: 2024, month: 9 },
    ]);

    const m = resolvePeriodSpec({ year: 2026, month: 8 });
    expect(m.period).toBe('Aug 2026');
    expect(m.granularity).toBe('monthly');
  });

  it('pctChange returns null when previous is zero and current is not', () => {
    expect(pctChange(10, 0)).toBeNull();
    expect(pctChange(0, 0)).toBe(0);
    expect(pctChange(150, 100)).toBe(50);
  });
});
