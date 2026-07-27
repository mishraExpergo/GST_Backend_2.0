export interface PrimaryGstrTrackAggregationMetrics {
  PRIMARY_TOTAL_RETURN_PERIODS: number;
  PRIMARY_FILED_RETURN_COUNT: number;
  PRIMARY_NON_FILED_RETURN_COUNT: number;
  PRIMARY_DELAYED_RETURN_COUNT: number;
  PRIMARY_ONTIME_RETURN_COUNT: number;
}

export interface ConsideredGstrTrackAggregationMetrics {
  CONSIDERED_TOTAL_RETURN_PERIODS: number;
  CONSIDERED_FILED_RETURN_COUNT: number;
  CONSIDERED_NON_FILED_RETURN_COUNT: number;
  CONSIDERED_DELAYED_RETURN_COUNT: number;
  CONSIDERED_ONTIME_RETURN_COUNT: number;
}

export interface GstrTrackReturnPeriodRow {
  returnPeriod: string;
  filingStatus: string;
  /** Days late vs due date; 0 = on time; null = unknown / not filed. */
  filingDelayDays: number | null;
}

const MONTH_NAME_TO_NUMBER: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

const MONTH_NUMBER_TO_NAME: Record<number, string> = {
  1: 'January',
  2: 'February',
  3: 'March',
  4: 'April',
  5: 'May',
  6: 'June',
  7: 'July',
  8: 'August',
  9: 'September',
  10: 'October',
  11: 'November',
  12: 'December',
};

export function normalizePan(pan: string | null | undefined): string | null {
  const normalized = (pan ?? '').trim().toUpperCase();
  return normalized || null;
}

export function getTrackRecordPan(record: Record<string, any>): string | null {
  const pan = normalizePan(record.pan);
  if (pan) {
    return pan;
  }

  const gstin = String(record.gstin ?? record.gstNo ?? '')
    .trim()
    .toUpperCase();
  if (gstin.length >= 12) {
    return gstin.substring(2, 12);
  }

  return null;
}

export function getTrackRecordsForPan(
  records: Array<Record<string, any>>,
  pan: string,
): Array<Record<string, any>> {
  return records.filter((record) => getTrackRecordPan(record) === pan);
}

/**
 * For one Considered Entity PAN: distinct return-period counts.
 * Loan-level metrics SUM these pan-level counts.
 */
export function computePanLevelGstrTrackCounts(
  records: Array<Record<string, any>>,
): {
  totalReturnPeriods: number;
  filedReturnCount: number;
  nonFiledReturnCount: number;
  delayedReturnCount: number;
  ontimeReturnCount: number;
} {
  const allReturnPeriods = new Set<string>();
  const filedReturnPeriods = new Set<string>();
  const nonFiledReturnPeriods = new Set<string>();
  const delayedReturnPeriods = new Set<string>();
  const ontimeReturnPeriods = new Set<string>();

  for (const record of records) {
    for (const row of extractGstrTrackReturnPeriodRows(record)) {
      allReturnPeriods.add(row.returnPeriod);

      if (row.filingStatus === 'FILED') {
        filedReturnPeriods.add(row.returnPeriod);
      } else if (row.filingStatus === 'NOT FILED' || row.filingStatus === 'NOT_FILED') {
        nonFiledReturnPeriods.add(row.returnPeriod);
      } else {
        nonFiledReturnPeriods.add(row.returnPeriod);
      }

      if (row.filingDelayDays !== null && row.filingDelayDays > 0) {
        delayedReturnPeriods.add(row.returnPeriod);
      } else if (row.filingDelayDays === 0) {
        ontimeReturnPeriods.add(row.returnPeriod);
      }
    }
  }

  return {
    totalReturnPeriods: allReturnPeriods.size,
    filedReturnCount: filedReturnPeriods.size,
    nonFiledReturnCount: nonFiledReturnPeriods.size,
    delayedReturnCount: delayedReturnPeriods.size,
    ontimeReturnCount: ontimeReturnPeriods.size,
  };
}

function sumPanLevelGstrTrackCounts(
  pans: string[],
  allTrackRecords: Array<Record<string, any>>,
): {
  totalReturnPeriods: number;
  filedReturnCount: number;
  nonFiledReturnCount: number;
  delayedReturnCount: number;
  ontimeReturnCount: number;
} {
  let totalReturnPeriods = 0;
  let filedReturnCount = 0;
  let nonFiledReturnCount = 0;
  let delayedReturnCount = 0;
  let ontimeReturnCount = 0;

  for (const pan of pans) {
    const panRecords = getTrackRecordsForPan(allTrackRecords, pan);
    const counts = computePanLevelGstrTrackCounts(panRecords);
    totalReturnPeriods += counts.totalReturnPeriods;
    filedReturnCount += counts.filedReturnCount;
    nonFiledReturnCount += counts.nonFiledReturnCount;
    delayedReturnCount += counts.delayedReturnCount;
    ontimeReturnCount += counts.ontimeReturnCount;
  }

  return {
    totalReturnPeriods,
    filedReturnCount,
    nonFiledReturnCount,
    delayedReturnCount,
    ontimeReturnCount,
  };
}

/**
 * Loan-level PRIMARY_* return metrics:
 * SUM(per Primary PAN counts) for the associated_loan_id.
 */
export function computePrimaryGstrTrackAggregationMetricsForPans(
  pans: string[],
  allTrackRecords: Array<Record<string, any>>,
): PrimaryGstrTrackAggregationMetrics {
  const counts = sumPanLevelGstrTrackCounts(pans, allTrackRecords);
  return {
    PRIMARY_TOTAL_RETURN_PERIODS: counts.totalReturnPeriods,
    PRIMARY_FILED_RETURN_COUNT: counts.filedReturnCount,
    PRIMARY_NON_FILED_RETURN_COUNT: counts.nonFiledReturnCount,
    PRIMARY_DELAYED_RETURN_COUNT: counts.delayedReturnCount,
    PRIMARY_ONTIME_RETURN_COUNT: counts.ontimeReturnCount,
  };
}

/**
 * Loan-level CONSIDERED_* return metrics:
 * SUM(per Considered Entity PAN counts) for the associated_loan_id.
 */
export function computeConsideredGstrTrackAggregationMetricsForPans(
  pans: string[],
  allTrackRecords: Array<Record<string, any>>,
): ConsideredGstrTrackAggregationMetrics {
  const counts = sumPanLevelGstrTrackCounts(pans, allTrackRecords);
  return {
    CONSIDERED_TOTAL_RETURN_PERIODS: counts.totalReturnPeriods,
    CONSIDERED_FILED_RETURN_COUNT: counts.filedReturnCount,
    CONSIDERED_NON_FILED_RETURN_COUNT: counts.nonFiledReturnCount,
    CONSIDERED_DELAYED_RETURN_COUNT: counts.delayedReturnCount,
    CONSIDERED_ONTIME_RETURN_COUNT: counts.ontimeReturnCount,
  };
}

export function extractGstrTrackReturnPeriodRows(
  record: Record<string, any>,
): GstrTrackReturnPeriodRow[] {
  const rows: GstrTrackReturnPeriodRow[] = [];

  if (Array.isArray(record.returns)) {
    for (const yearBlock of record.returns) {
      const year = Number(yearBlock?.year);
      const periods = Array.isArray(yearBlock?.periods) ? yearBlock.periods : [];

      for (const period of periods) {
        const returnPeriod = buildReturnPeriodFromYearMonth(
          year,
          String(period?.month ?? ''),
        );
        if (!returnPeriod) {
          continue;
        }

        const filingStatus = normalizeFilingStatus(period?.status);
        rows.push({
          returnPeriod,
          filingStatus,
          filingDelayDays: computeFilingDelayDays(
            returnPeriod,
            period?.filedDate ?? period?.dof ?? null,
            filingStatus,
            period?.filing_delay_days ?? period?.filingDelayDays,
          ),
        });
      }
    }
  }

  for (const entry of extractEFiledList(record)) {
    const returnPeriod = normalizeReturnPeriod(
      entry?.ret_prd ?? entry?.returnPeriod ?? entry?.return_period,
    );
    if (!returnPeriod) {
      continue;
    }

    const filingStatus = normalizeFilingStatus(entry?.status);
    rows.push({
      returnPeriod,
      filingStatus,
      filingDelayDays: computeFilingDelayDays(
        returnPeriod,
        entry?.dof ?? entry?.filedDate ?? null,
        filingStatus,
        entry?.filing_delay_days ?? entry?.filingDelayDays,
      ),
    });
  }

  return dedupeReturnPeriodRows(rows);
}

/** Builds normalized `returns[]` blocks from a Sandbox GSTR track response. */
export function buildGstr1ReturnsFromResponse(
  gstrResponse: Record<string, any>,
): Array<Record<string, any>> {
  const eFiledList = extractEFiledListFromResponse(gstrResponse).filter(
    (entry) => {
      const returnType = String(entry?.rtntype ?? entry?.returnType ?? '')
        .trim()
        .toUpperCase();
      return !returnType || returnType === 'GSTR1' || returnType === 'GSTR-1';
    },
  );

  const periodsByYear = new Map<number, Array<Record<string, any>>>();

  for (const entry of eFiledList) {
    const returnPeriod = normalizeReturnPeriod(
      entry?.ret_prd ?? entry?.returnPeriod ?? entry?.return_period,
    );
    if (!returnPeriod) {
      continue;
    }

    const match = returnPeriod.match(/^(\d{2})(\d{4})$/);
    if (!match) {
      continue;
    }

    const month = Number(match[1]);
    const year = Number(match[2]);
    const monthName = MONTH_NUMBER_TO_NAME[month];
    if (!monthName) {
      continue;
    }

    const periods = periodsByYear.get(year) ?? [];
    periods.push({
      month: monthName,
      status: entry?.status ?? null,
      valid:
        String(entry?.valid ?? '').trim().toUpperCase() === 'Y' ||
        entry?.valid === true,
      filedDate: entry?.dof ?? entry?.filedDate ?? null,
      returnPeriod,
      filing_delay_days: computeFilingDelayDays(
        returnPeriod,
        entry?.dof ?? entry?.filedDate ?? null,
        normalizeFilingStatus(entry?.status),
        entry?.filing_delay_days ?? entry?.filingDelayDays,
      ),
    });
    periodsByYear.set(year, periods);
  }

  return Array.from(periodsByYear.entries())
    .sort(([a], [b]) => a - b)
    .map(([year, periods]) => ({ year, periods }));
}

export function hasTrackFilingRecords(
  gstrResponse: Record<string, any>,
): boolean {
  return extractEFiledListFromResponse(gstrResponse).length > 0;
}

function extractEFiledList(record: Record<string, any>): Array<Record<string, any>> {
  return extractEFiledListFromResponse(record.gstrResponse ?? record.data ?? record);
}

function extractEFiledListFromResponse(
  response: Record<string, any>,
): Array<Record<string, any>> {
  const candidates = [
    response?.data?.data?.EFiledlist,
    response?.data?.EFiledlist,
    response?.EFiledlist,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function dedupeReturnPeriodRows(
  rows: GstrTrackReturnPeriodRow[],
): GstrTrackReturnPeriodRow[] {
  const byPeriod = new Map<string, GstrTrackReturnPeriodRow>();

  for (const row of rows) {
    const existing = byPeriod.get(row.returnPeriod);
    if (!existing) {
      byPeriod.set(row.returnPeriod, row);
      continue;
    }

    if (existing.filingStatus !== 'FILED' && row.filingStatus === 'FILED') {
      byPeriod.set(row.returnPeriod, row);
    }
  }

  return Array.from(byPeriod.values());
}

function buildReturnPeriodFromYearMonth(
  year: number,
  monthName: string,
): string | null {
  if (!Number.isFinite(year) || year <= 0) {
    return null;
  }

  const month = MONTH_NAME_TO_NUMBER[monthName.trim().toLowerCase()];
  if (!month) {
    return null;
  }

  return `${String(month).padStart(2, '0')}${year}`;
}

function normalizeReturnPeriod(raw: unknown): string | null {
  if (raw === undefined || raw === null) {
    return null;
  }

  const value = String(raw).trim();
  if (!value) {
    return null;
  }

  if (/^\d{6}$/.test(value)) {
    return value;
  }

  const yearMonthMatch = value.match(/^(\d{4})[-/](\d{1,2})$/);
  if (yearMonthMatch) {
    return `${yearMonthMatch[2].padStart(2, '0')}${yearMonthMatch[1]}`;
  }

  const monthYearMatch = value.match(/^([A-Za-z]+)[-/ ](\d{4})$/);
  if (monthYearMatch) {
    return buildReturnPeriodFromYearMonth(
      Number(monthYearMatch[2]),
      monthYearMatch[1],
    );
  }

  return null;
}

function normalizeFilingStatus(raw: unknown): string {
  const status = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/_/g, ' ');

  if (!status) {
    return 'NOT FILED';
  }

  if (
    status === 'FILED' ||
    (status.includes('FILED') && !status.includes('NOT'))
  ) {
    return 'FILED';
  }

  if (status === 'NOT FILED' || status.includes('NOT FILED')) {
    return 'NOT FILED';
  }

  return status;
}

function computeFilingDelayDays(
  returnPeriod: string,
  filedDateRaw: unknown,
  filingStatus: string,
  explicitDelayDays: unknown,
): number | null {
  if (
    explicitDelayDays !== undefined &&
    explicitDelayDays !== null &&
    String(explicitDelayDays).trim() !== ''
  ) {
    const parsed = Number(explicitDelayDays);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.trunc(parsed));
    }
  }

  if (filingStatus !== 'FILED') {
    return null;
  }

  const filedDate = parseDate(String(filedDateRaw ?? '').trim());
  const dueDate = getReturnDueDate(returnPeriod);
  if (!filedDate || !dueDate) {
    return null;
  }

  const msPerDay = 24 * 60 * 60 * 1000;
  const diffDays = Math.floor(
    (filedDate.getTime() - dueDate.getTime()) / msPerDay,
  );
  return Math.max(0, diffDays);
}

function getReturnDueDate(returnPeriod: string): Date | null {
  const match = returnPeriod.match(/^(\d{2})(\d{4})$/);
  if (!match) {
    return null;
  }

  const month = Number(match[1]);
  const year = Number(match[2]);
  if (month < 1 || month > 12) {
    return null;
  }

  // Monthly return due date: 11th of the month following the return period.
  const dueMonth = month === 12 ? 1 : month + 1;
  const dueYear = month === 12 ? year + 1 : year;
  return new Date(dueYear, dueMonth - 1, 11, 23, 59, 59, 999);
}

function parseDate(raw: string): Date | null {
  if (!raw) {
    return null;
  }

  const ddMmYyyy = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (ddMmYyyy) {
    return new Date(
      Number(ddMmYyyy[3]),
      Number(ddMmYyyy[2]) - 1,
      Number(ddMmYyyy[1]),
    );
  }

  const iso = Date.parse(raw);
  if (!Number.isNaN(iso)) {
    return new Date(iso);
  }

  return null;
}
