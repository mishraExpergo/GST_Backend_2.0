export interface PrimaryGstr1AggregationMetrics {
  PRIMARY_TOTAL_RETURN_PERIODS: number;
  PRIMARY_FILED_RETURN_COUNT: number;
  PRIMARY_NON_FILED_RETURN_COUNT: number;
  PRIMARY_DELAYED_RETURN_COUNT: number;
  PRIMARY_ONTIME_RETURN_COUNT: number;
}

export interface Gstr1ReturnPeriodRow {
  returnPeriod: string;
  filingStatus: string;
  delayIndicator: 'DELAYED' | 'ONTIME' | null;
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

const MONTH_NUMBER_TO_NAME = [
  '',
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Keys written by verify-and-fetch primary aggregation. */
export const PRIMARY_GST_COMPLIANCE_METRIC_KEYS = [
  'PRIMARY_TOTAL_GST_COUNT',
  'PRIMARY_ACTIVE_GST_COUNT',
  'PRIMARY_CANCELLED_GST_COUNT',
  'PRIMARY_SUSPENDED_GST_COUNT',
  'PRIMARY_ADDRESS_CHANGE',
  'PRIMARY_TOTAL_EINVOICE_COUNT',
  'PRIMARY_EINVOICE_ENABLED_COUNT',
] as const;

/** Keys written by GSTR-1 primary aggregation. */
export const PRIMARY_GSTR1_METRIC_KEYS = [
  'PRIMARY_TOTAL_RETURN_PERIODS',
  'PRIMARY_FILED_RETURN_COUNT',
  'PRIMARY_NON_FILED_RETURN_COUNT',
  'PRIMARY_DELAYED_RETURN_COUNT',
  'PRIMARY_ONTIME_RETURN_COUNT',
] as const;

export function normalizePan(
  pan: string | null | undefined,
): string | null {
  const normalized = (pan ?? '').trim().toUpperCase();
  return normalized || null;
}

export function resolveIdentityPan(
  rowPan: string | null | undefined,
  verifyPan: string | null | undefined,
  gstin: string,
): string {
  return (
    normalizePan(rowPan) ??
    normalizePan(verifyPan) ??
    gstin.substring(2, 12).toUpperCase()
  );
}

export function getGstr1RecordsForPan(
  records: Array<Record<string, any>>,
  pan: string,
): Array<Record<string, any>> {
  return records.filter((record) => getGstr1RecordPan(record) === pan);
}

/** Builds normalized `returns[]` blocks from a Sandbox GSTR track response. */
export function buildGstr1ReturnsFromResponse(
  gstrResponse: Record<string, any>,
): Array<Record<string, any>> {
  const eFiledList = extractEFiledListFromResponse(gstrResponse).filter((entry) => {
    const returnType = String(entry?.rtntype ?? entry?.returnType ?? '')
      .trim()
      .toUpperCase();
    return !returnType || returnType === 'GSTR1' || returnType === 'GSTR-1';
  });

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
    });
    periodsByYear.set(year, periods);
  }

  return Array.from(periodsByYear.entries())
    .sort(([a], [b]) => a - b)
    .map(([year, periods]) => ({ year, periods }));
}



export function getGstr1RecordPan(

  record: Record<string, any>,

): string | null {

  const pan = normalizePan(record.pan);
  if (pan) {
    return pan;
  }

  const gstin = String(record.gstin ?? '').trim().toUpperCase();
  if (gstin.length >= 12) {
    return gstin.substring(2, 12);
  }

  return null;
}

export function extractGstr1ReturnPeriodRows(
  record: Record<string, any>,
): Gstr1ReturnPeriodRow[] {
  const rows: Gstr1ReturnPeriodRow[] = [];

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
          delayIndicator: computeDelayIndicator(
            returnPeriod,
            period?.filedDate ?? period?.dof ?? null,
            filingStatus,
          ),
        });
      }
    }
  }

  const eFiledList = extractEFiledList(record);
  for (const entry of eFiledList) {
    const returnType = String(entry?.rtntype ?? entry?.returnType ?? '')
      .trim()
      .toUpperCase();
    if (returnType && returnType !== 'GSTR1' && returnType !== 'GSTR-1') {
      continue;
    }

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
      delayIndicator: computeDelayIndicator(
        returnPeriod,
        entry?.dof ?? entry?.filedDate ?? null,
        filingStatus,
      ),
    });
  }

  return dedupeReturnPeriodRows(rows);
}

export function computePrimaryGstr1AggregationMetrics(
  records: Array<Record<string, any>>,
): PrimaryGstr1AggregationMetrics {
  const allReturnPeriods = new Set<string>();
  const filedReturnPeriods = new Set<string>();
  const nonFiledReturnPeriods = new Set<string>();
  const delayedReturnPeriods = new Set<string>();
  const ontimeReturnPeriods = new Set<string>();

  for (const record of records) {
    for (const row of extractGstr1ReturnPeriodRows(record)) {
      allReturnPeriods.add(row.returnPeriod);

      if (row.filingStatus === 'FILED') {
        filedReturnPeriods.add(row.returnPeriod);
      } else {
        nonFiledReturnPeriods.add(row.returnPeriod);
      }

      if (row.delayIndicator === 'DELAYED') {
        delayedReturnPeriods.add(row.returnPeriod);
      } else if (row.delayIndicator === 'ONTIME') {
        ontimeReturnPeriods.add(row.returnPeriod);
      }
    }
  }

  return {
    PRIMARY_TOTAL_RETURN_PERIODS: allReturnPeriods.size,
    PRIMARY_FILED_RETURN_COUNT: filedReturnPeriods.size,
    PRIMARY_NON_FILED_RETURN_COUNT: nonFiledReturnPeriods.size,
    PRIMARY_DELAYED_RETURN_COUNT: delayedReturnPeriods.size,
    PRIMARY_ONTIME_RETURN_COUNT: ontimeReturnPeriods.size,
  };
}

export function mergeAggregationVariable(
  existingJson: string | null | undefined,
  newMetrics: Record<string, unknown>,
): string {
  let existing: Record<string, unknown> = {};

  if (existingJson) {
    try {
      const parsed = JSON.parse(existingJson);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>;
      }
    } catch {
      existing = {};
    }
  }

  return JSON.stringify({ ...existing, ...newMetrics });
}

export function preserveMetricKeys(
  existingJson: string | null | undefined,
  keysToPreserve: readonly string[],
): Record<string, unknown> {
  if (!existingJson) {
    return {};
  }

  try {
    const parsed = JSON.parse(existingJson) as Record<string, unknown>;
    const preserved: Record<string, unknown> = {};
    for (const key of keysToPreserve) {
      if (parsed[key] !== undefined) {
        preserved[key] = parsed[key];
      }
    }
    return preserved;
  } catch {
    return {};
  }
}

function extractEFiledList(
  record: Record<string, any>,
): Array<Record<string, any>> {
  const raw = record as Record<string, any>;
  return extractEFiledListFromResponse(
    raw.gstrResponse ?? raw.data ?? raw,
  );
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

function dedupeReturnPeriodRows(rows: Gstr1ReturnPeriodRow[]): Gstr1ReturnPeriodRow[] {
  const byPeriod = new Map<string, Gstr1ReturnPeriodRow>();

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
    return buildReturnPeriodFromYearMonth(Number(monthYearMatch[2]), monthYearMatch[1]);
  }

  return value.toUpperCase();
}

function normalizeFilingStatus(raw: unknown): string {
  const status = String(raw ?? '')
    .trim()
    .toUpperCase();

  if (!status) {
    return 'NOT_FILED';
  }

  if (status === 'FILED' || status.includes('FILED')) {
    return 'FILED';
  }

  return status;
}

function computeDelayIndicator(
  returnPeriod: string,
  filedDateRaw: unknown,
  filingStatus: string,
): 'DELAYED' | 'ONTIME' | null {
  if (filingStatus !== 'FILED') {
    return null;
  }

  const filedDate = parseDate(String(filedDateRaw ?? '').trim());
  const dueDate = getGstr1DueDate(returnPeriod);
  if (!filedDate || !dueDate) {
    return null;
  }

  return filedDate.getTime() > dueDate.getTime() ? 'DELAYED' : 'ONTIME';
}

function getGstr1DueDate(returnPeriod: string): Date | null {
  const match = returnPeriod.match(/^(\d{2})(\d{4})$/);
  if (!match) {
    return null;
  }

  const month = Number(match[1]);
  const year = Number(match[2]);
  if (month < 1 || month > 12) {
    return null;
  }

  // GSTR-1 monthly due date: 11th of the month following the return period.
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

