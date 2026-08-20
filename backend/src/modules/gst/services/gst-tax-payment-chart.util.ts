/**
 * Tax Payment Chart — GSTR-3B only (ITC Utilised + Cash Tax Paid + Total).
 *
 * Indian FY: Y-(Y+1) = Apr Y … Mar Y+1
 * H1 = Apr–Sep · H2 = Oct–Mar
 * Q1 = Apr–Jun · Q2 = Jul–Sep · Q3 = Oct–Dec · Q4 = Jan–Mar
 *
 * Graph: stacked bars (ITC green + Cash blue) + dotted line (Total).
 */

export type ChartEntityType = 'PAN' | 'LOAN';
export type ChartRangeKey = '1y' | '3y' | '5y';
export type ChartHalf = 'H1' | 'H2';
export type ChartQuarter = 'Q1' | 'Q2' | 'Q3' | 'Q4';
export type ChartDataStatus = 'COMPLETE' | 'MISSING' | 'PARTIAL';
export type ChartGranularity =
  | 'monthly'
  | 'quarterly'
  | 'half-yearly'
  | 'annual';

export interface CalendarMonth {
  year: number;
  month: number;
}

export interface ChartPeriodSpec {
  financialYear: string; // "2023-24"
  fyStartYear: number; // 2023
  half: ChartHalf | null;
  quarter: ChartQuarter | null;
  /** Set for monthly buckets (calendar year/month). */
  calendarYear: number | null;
  calendarMonth: number | null;
  granularity: ChartGranularity;
  period: string;
  months: CalendarMonth[];
}

export interface MonthlyTaxPayment {
  gstin: string;
  loanId: string;
  customerId: string;
  year: number;
  month: number;
  /** ITC utilised from GSTR-3B (IGST+CGST+SGST+CESS); null when 3B absent. */
  itcUtilised: number | null;
  /** Cash tax paid from GSTR-3B (IGST+CGST+SGST+CESS); null when 3B absent. */
  cashTaxPaid: number | null;
}

/** One X-axis bucket for the Tax Payment graph. */
export interface TaxPaymentPeriod {
  /** X-axis label, e.g. "H1 FY23-24" or "FY23-24". */
  period: string;
  financialYear: string;
  half: ChartHalf | null;
  /** Green stacked bar. */
  itcUtilised: number | null;
  /** Blue stacked bar. */
  cashTaxPaid: number | null;
  /** Dotted line — ITC + cash. */
  totalPayments: number | null;
  prevPeriodTotal: number | null;
  pctChangeTotal: number | null;
  pctChangeItc: number | null;
  pctChangeCash: number | null;
}

export interface TaxPaymentChartResponse {
  series: TaxPaymentPeriod[];
  incomplete: boolean;
  missing: TaxPaymentMissingRow[];
  drilldown?: {
    period: string;
    financialYear: string;
    half: ChartHalf | null;
    rows: TaxPaymentDrilldownRow[];
  };
  fetch?: {
    jobs: Array<{
      jobId: string;
      status: string;
      checkStatusUrl: string;
    }>;
  };
}

export interface TaxPaymentMissingRow {
  gstin: string;
  financialYear: string;
  half: ChartHalf | null;
  year: number;
  month: number;
}

export interface TaxPaymentDrilldownRow {
  gstin: string;
  itcUtilised: number | null;
  cashTaxPaid: number | null;
  totalPayments: number | null;
}

export function hasGstr3b(row: MonthlyTaxPayment): boolean {
  return row.itcUtilised !== null && row.cashTaxPaid !== null;
}

const MONTH_LABELS = [
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
] as const;

export function formatFinancialYear(fyStartYear: number): string {
  const end = (fyStartYear + 1) % 100;
  return `${fyStartYear}-${String(end).padStart(2, '0')}`;
}

export function fyShort(fyStartYear: number): string {
  return `${String(fyStartYear).slice(-2)}-${String((fyStartYear + 1) % 100).padStart(2, '0')}`;
}

export function formatPeriodLabel(
  fyStartYear: number,
  half: ChartHalf | null,
): string {
  if (half) {
    return `${half} FY${fyShort(fyStartYear)}`;
  }
  return `FY${fyShort(fyStartYear)}`;
}

export function formatQuarterLabel(
  fyStartYear: number,
  quarter: ChartQuarter,
): string {
  return `${quarter} FY${fyShort(fyStartYear)}`;
}

export function formatMonthLabel(year: number, month: number): string {
  return `${MONTH_LABELS[month - 1]} ${year}`;
}

/** H1 / H2 calendar months for an Indian FY starting in `fyStartYear`. */
export function monthsForHalf(
  fyStartYear: number,
  half: ChartHalf,
): CalendarMonth[] {
  if (half === 'H1') {
    return [4, 5, 6, 7, 8, 9].map((month) => ({ year: fyStartYear, month }));
  }
  return [
    { year: fyStartYear, month: 10 },
    { year: fyStartYear, month: 11 },
    { year: fyStartYear, month: 12 },
    { year: fyStartYear + 1, month: 1 },
    { year: fyStartYear + 1, month: 2 },
    { year: fyStartYear + 1, month: 3 },
  ];
}

export function monthsForQuarter(
  fyStartYear: number,
  quarter: ChartQuarter,
): CalendarMonth[] {
  switch (quarter) {
    case 'Q1':
      return [4, 5, 6].map((month) => ({ year: fyStartYear, month }));
    case 'Q2':
      return [7, 8, 9].map((month) => ({ year: fyStartYear, month }));
    case 'Q3':
      return [10, 11, 12].map((month) => ({ year: fyStartYear, month }));
    case 'Q4':
      return [1, 2, 3].map((month) => ({
        year: fyStartYear + 1,
        month,
      }));
  }
}

export function monthsForFinancialYear(fyStartYear: number): CalendarMonth[] {
  return [
    ...monthsForHalf(fyStartYear, 'H1'),
    ...monthsForHalf(fyStartYear, 'H2'),
  ];
}

export function calendarMonthToFyHalf(
  year: number,
  month: number,
): { fyStartYear: number; half: ChartHalf } {
  if (month >= 4 && month <= 9) {
    return { fyStartYear: year, half: 'H1' };
  }
  if (month >= 10) {
    return { fyStartYear: year, half: 'H2' };
  }
  return { fyStartYear: year - 1, half: 'H2' };
}

export function calendarMonthToFyQuarter(
  year: number,
  month: number,
): { fyStartYear: number; quarter: ChartQuarter; half: ChartHalf } {
  if (month >= 4 && month <= 6) {
    return { fyStartYear: year, quarter: 'Q1', half: 'H1' };
  }
  if (month >= 7 && month <= 9) {
    return { fyStartYear: year, quarter: 'Q2', half: 'H1' };
  }
  if (month >= 10 && month <= 12) {
    return { fyStartYear: year, quarter: 'Q3', half: 'H2' };
  }
  return { fyStartYear: year - 1, quarter: 'Q4', half: 'H2' };
}

/** Current Indian FY start year as of `referenceDate`. */
export function currentFyStartYear(referenceDate = new Date()): number {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth() + 1;
  return month >= 4 ? year : year - 1;
}

export function currentHalf(referenceDate = new Date()): ChartHalf {
  const month = referenceDate.getMonth() + 1;
  return month >= 4 && month <= 9 ? 'H1' : 'H2';
}

export function defaultGranularityForRange(
  range: ChartRangeKey,
): ChartGranularity {
  return range === '5y' ? 'annual' : 'half-yearly';
}

function periodCount(range: ChartRangeKey, granularity: ChartGranularity): number {
  const years = range === '1y' ? 1 : range === '3y' ? 3 : 5;
  switch (granularity) {
    case 'monthly':
      return years * 12;
    case 'quarterly':
      return years * 4;
    case 'half-yearly':
      return years * 2;
    case 'annual':
      return years;
  }
}

function shiftCalendarMonth(
  year: number,
  month: number,
  delta: number,
): CalendarMonth {
  const absolute = year * 12 + (month - 1) + delta;
  return {
    year: Math.floor(absolute / 12),
    month: (absolute % 12) + 1,
  };
}

function emptyBucketFields(): Pick<
  ChartPeriodSpec,
  'half' | 'quarter' | 'calendarYear' | 'calendarMonth'
> {
  return {
    half: null,
    quarter: null,
    calendarYear: null,
    calendarMonth: null,
  };
}

/**
 * Build trailing chart period specs ending at the current period.
 * Default granularity: half-yearly (1y/3y) or annual (5y).
 */
export function buildPeriodSpecs(
  range: ChartRangeKey,
  options?: {
    granularity?: ChartGranularity;
    referenceDate?: Date;
  },
): ChartPeriodSpec[] {
  const referenceDate = options?.referenceDate ?? new Date();
  const granularity =
    options?.granularity ?? defaultGranularityForRange(range);
  const count = periodCount(range, granularity);
  const fyStart = currentFyStartYear(referenceDate);
  const refYear = referenceDate.getFullYear();
  const refMonth = referenceDate.getMonth() + 1;

  if (granularity === 'annual') {
    const specs: ChartPeriodSpec[] = [];
    for (let i = count - 1; i >= 0; i--) {
      const start = fyStart - i;
      specs.push({
        ...emptyBucketFields(),
        financialYear: formatFinancialYear(start),
        fyStartYear: start,
        granularity: 'annual',
        period: formatPeriodLabel(start, null),
        months: monthsForFinancialYear(start),
      });
    }
    return specs;
  }

  if (granularity === 'half-yearly') {
    const half = currentHalf(referenceDate);
    const halves: Array<{ fyStartYear: number; half: ChartHalf }> = [];
    let cursorFy = fyStart;
    let cursorHalf: ChartHalf = half;

    for (let i = 0; i < count; i++) {
      halves.unshift({ fyStartYear: cursorFy, half: cursorHalf });
      if (cursorHalf === 'H2') {
        cursorHalf = 'H1';
      } else {
        cursorHalf = 'H2';
        cursorFy -= 1;
      }
    }

    return halves.map(({ fyStartYear, half: h }) => ({
      ...emptyBucketFields(),
      financialYear: formatFinancialYear(fyStartYear),
      fyStartYear,
      half: h,
      granularity: 'half-yearly' as const,
      period: formatPeriodLabel(fyStartYear, h),
      months: monthsForHalf(fyStartYear, h),
    }));
  }

  if (granularity === 'quarterly') {
    const { quarter } = calendarMonthToFyQuarter(refYear, refMonth);
    const quarters: ChartQuarter[] = ['Q1', 'Q2', 'Q3', 'Q4'];
    let cursorFy = fyStart;
    let cursorQ = quarter;
    const list: Array<{ fyStartYear: number; quarter: ChartQuarter }> = [];

    for (let i = 0; i < count; i++) {
      list.unshift({ fyStartYear: cursorFy, quarter: cursorQ });
      const idx = quarters.indexOf(cursorQ);
      if (idx === 0) {
        cursorQ = 'Q4';
        cursorFy -= 1;
      } else {
        cursorQ = quarters[idx - 1];
      }
    }

    return list.map(({ fyStartYear, quarter: q }) => {
      const half: ChartHalf = q === 'Q1' || q === 'Q2' ? 'H1' : 'H2';
      return {
        ...emptyBucketFields(),
        financialYear: formatFinancialYear(fyStartYear),
        fyStartYear,
        half,
        quarter: q,
        granularity: 'quarterly' as const,
        period: formatQuarterLabel(fyStartYear, q),
        months: monthsForQuarter(fyStartYear, q),
      };
    });
  }

  // monthly
  const months: CalendarMonth[] = [];
  for (let i = count - 1; i >= 0; i--) {
    months.push(shiftCalendarMonth(refYear, refMonth, -i));
  }

  return months.map((slot) => {
    const mapped = calendarMonthToFyQuarter(slot.year, slot.month);
    return {
      financialYear: formatFinancialYear(mapped.fyStartYear),
      fyStartYear: mapped.fyStartYear,
      half: mapped.half,
      quarter: mapped.quarter,
      calendarYear: slot.year,
      calendarMonth: slot.month,
      granularity: 'monthly' as const,
      period: formatMonthLabel(slot.year, slot.month),
      months: [slot],
    };
  });
}

/** Drop months strictly after `referenceDate`. */
export function filterMonthsUpTo(
  months: CalendarMonth[],
  referenceDate = new Date(),
): CalendarMonth[] {
  const y = referenceDate.getFullYear();
  const m = referenceDate.getMonth() + 1;
  return months.filter(
    (slot) => slot.year < y || (slot.year === y && slot.month <= m),
  );
}

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function pctChange(
  current: number | null,
  previous: number | null,
): number | null {
  if (current === null || previous === null) {
    return null;
  }
  if (previous === 0) {
    return current === 0 ? 0 : null;
  }
  return round2(((current - previous) / Math.abs(previous)) * 100);
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function buildChartSeries(
  specs: ChartPeriodSpec[],
  gstins: string[],
  payments: MonthlyTaxPayment[],
  referenceDate = new Date(),
): TaxPaymentChartResponse['series'] {
  const gstinTotal = gstins.length;
  const paymentIndex = new Map<string, MonthlyTaxPayment>();
  for (const row of payments) {
    paymentIndex.set(`${row.gstin}|${monthKey(row.year, row.month)}`, row);
  }

  const series: TaxPaymentPeriod[] = [];

  for (const spec of specs) {
    const expectedMonths = filterMonthsUpTo(spec.months, referenceDate);
    let itcSum = 0;
    let cashSum = 0;
    let any3b = false;
    let gstinsComplete = 0;

    for (const gstin of gstins) {
      let monthsWith3b = 0;
      for (const slot of expectedMonths) {
        const hit = paymentIndex.get(
          `${gstin}|${monthKey(slot.year, slot.month)}`,
        );
        if (!hit) {
          continue;
        }
        if (hit.itcUtilised !== null) {
          any3b = true;
          itcSum += hit.itcUtilised;
        }
        if (hit.cashTaxPaid !== null) {
          any3b = true;
          cashSum += hit.cashTaxPaid;
        }
        if (hasGstr3b(hit)) {
          monthsWith3b += 1;
        }
      }
      if (
        expectedMonths.length > 0 &&
        monthsWith3b === expectedMonths.length
      ) {
        gstinsComplete += 1;
      }
    }

    let dataStatus: ChartDataStatus;
    if (gstinTotal === 0 || expectedMonths.length === 0 || !any3b) {
      dataStatus = 'MISSING';
    } else if (gstinsComplete === gstinTotal) {
      dataStatus = 'COMPLETE';
    } else {
      dataStatus = 'PARTIAL';
    }

    const itcUtilised =
      dataStatus === 'MISSING' || !any3b ? null : round2(itcSum);
    const cashTaxPaid =
      dataStatus === 'MISSING' || !any3b ? null : round2(cashSum);
    const totalPayments =
      itcUtilised === null || cashTaxPaid === null
        ? null
        : round2(itcUtilised + cashTaxPaid);

    series.push({
      period: spec.period,
      financialYear: spec.financialYear,
      half: spec.half,
      itcUtilised,
      cashTaxPaid,
      totalPayments,
      prevPeriodTotal: null,
      pctChangeTotal: null,
      pctChangeItc: null,
      pctChangeCash: null,
    });
  }

  for (let i = 0; i < series.length; i++) {
    const prev = i > 0 ? series[i - 1] : null;
    series[i].prevPeriodTotal = prev?.totalPayments ?? null;
    series[i].pctChangeTotal = pctChange(
      series[i].totalPayments,
      prev?.totalPayments ?? null,
    );
    series[i].pctChangeItc = pctChange(
      series[i].itcUtilised,
      prev?.itcUtilised ?? null,
    );
    series[i].pctChangeCash = pctChange(
      series[i].cashTaxPaid,
      prev?.cashTaxPaid ?? null,
    );
  }

  return series;
}

export function findMissingSlots(
  specs: ChartPeriodSpec[],
  units: Array<{ gstin: string }>,
  payments: MonthlyTaxPayment[],
  referenceDate = new Date(),
): TaxPaymentMissingRow[] {
  const paymentIndex = new Map<string, MonthlyTaxPayment>();
  for (const row of payments) {
    paymentIndex.set(`${row.gstin}|${monthKey(row.year, row.month)}`, row);
  }
  const missing: TaxPaymentMissingRow[] = [];

  for (const spec of specs) {
    const expectedMonths = filterMonthsUpTo(spec.months, referenceDate);
    for (const unit of units) {
      for (const slot of expectedMonths) {
        const hit = paymentIndex.get(
          `${unit.gstin}|${monthKey(slot.year, slot.month)}`,
        );
        if (!hit || !hasGstr3b(hit)) {
          missing.push({
            gstin: unit.gstin,
            financialYear: spec.financialYear,
            half: spec.half,
            year: slot.year,
            month: slot.month,
          });
        }
      }
    }
  }

  return missing;
}

export function buildDrilldownRows(
  spec: ChartPeriodSpec,
  units: Array<{ gstin: string }>,
  payments: MonthlyTaxPayment[],
  referenceDate = new Date(),
): TaxPaymentDrilldownRow[] {
  const expectedMonths = filterMonthsUpTo(spec.months, referenceDate);
  const byGstin = new Map<string, MonthlyTaxPayment[]>();
  for (const row of payments) {
    const list = byGstin.get(row.gstin) ?? [];
    list.push(row);
    byGstin.set(row.gstin, list);
  }

  return units.map((unit) => {
    const rows = (byGstin.get(unit.gstin) ?? []).filter((row) =>
      expectedMonths.some(
        (slot) => slot.year === row.year && slot.month === row.month,
      ),
    );
    const monthsExpected = expectedMonths.length;
    let itc = 0;
    let cash = 0;
    let monthsPresent = 0;
    let any3b = false;

    for (const row of rows) {
      if (hasGstr3b(row)) {
        monthsPresent += 1;
        any3b = true;
        itc += row.itcUtilised!;
        cash += row.cashTaxPaid!;
      }
    }

    let dataStatus: ChartDataStatus;
    if (monthsExpected === 0 || !any3b) {
      dataStatus = 'MISSING';
    } else if (monthsPresent === monthsExpected) {
      dataStatus = 'COMPLETE';
    } else {
      dataStatus = 'PARTIAL';
    }

    const itcUtilised =
      dataStatus === 'MISSING' || !any3b ? null : round2(itc);
    const cashTaxPaid =
      dataStatus === 'MISSING' || !any3b ? null : round2(cash);

    return {
      gstin: unit.gstin,
      itcUtilised,
      cashTaxPaid,
      totalPayments:
        itcUtilised === null || cashTaxPaid === null
          ? null
          : round2(itcUtilised + cashTaxPaid),
    };
  });
}

export function parseFinancialYear(raw: string): number {
  const value = String(raw ?? '').trim();
  const match = value.match(/^(?:FY\s*)?(\d{4})\s*[-/]\s*(\d{2}|\d{4})$/i);
  if (!match) {
    throw new Error(
      `Invalid financialYear "${raw}". Expected format like "2023-24" or "FY 2023-24".`,
    );
  }
  return Number(match[1]);
}

export function resolvePeriodSpec(params: {
  financialYear?: string;
  half?: ChartHalf | string | null;
  quarter?: ChartQuarter | string | null;
  year?: number | string | null;
  month?: number | string | null;
}): ChartPeriodSpec {
  const yearNum = Number(params.year);
  const monthNum = Number(params.month);
  if (
    Number.isInteger(yearNum) &&
    Number.isInteger(monthNum) &&
    monthNum >= 1 &&
    monthNum <= 12
  ) {
    const mapped = calendarMonthToFyQuarter(yearNum, monthNum);
    return {
      financialYear: formatFinancialYear(mapped.fyStartYear),
      fyStartYear: mapped.fyStartYear,
      half: mapped.half,
      quarter: mapped.quarter,
      calendarYear: yearNum,
      calendarMonth: monthNum,
      granularity: 'monthly',
      period: formatMonthLabel(yearNum, monthNum),
      months: [{ year: yearNum, month: monthNum }],
    };
  }

  const fyRaw = String(params.financialYear ?? '').trim();
  if (!fyRaw) {
    throw new Error(
      'Provide financialYear (and optional half/quarter), or year+month for monthly drilldown.',
    );
  }

  const fyStartYear = parseFinancialYear(fyRaw);
  const quarter =
    params.quarter === 'Q1' ||
    params.quarter === 'Q2' ||
    params.quarter === 'Q3' ||
    params.quarter === 'Q4'
      ? (params.quarter as ChartQuarter)
      : null;
  const half =
    params.half === 'H1' || params.half === 'H2'
      ? (params.half as ChartHalf)
      : null;

  if (quarter) {
    const derivedHalf: ChartHalf =
      quarter === 'Q1' || quarter === 'Q2' ? 'H1' : 'H2';
    return {
      ...emptyBucketFields(),
      financialYear: formatFinancialYear(fyStartYear),
      fyStartYear,
      half: derivedHalf,
      quarter,
      granularity: 'quarterly',
      period: formatQuarterLabel(fyStartYear, quarter),
      months: monthsForQuarter(fyStartYear, quarter),
    };
  }

  if (half) {
    return {
      ...emptyBucketFields(),
      financialYear: formatFinancialYear(fyStartYear),
      fyStartYear,
      half,
      granularity: 'half-yearly',
      period: formatPeriodLabel(fyStartYear, half),
      months: monthsForHalf(fyStartYear, half),
    };
  }

  return {
    ...emptyBucketFields(),
    financialYear: formatFinancialYear(fyStartYear),
    fyStartYear,
    granularity: 'annual',
    period: formatPeriodLabel(fyStartYear, null),
    months: monthsForFinancialYear(fyStartYear),
  };
}
