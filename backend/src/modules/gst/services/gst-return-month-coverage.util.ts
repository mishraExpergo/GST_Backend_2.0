export interface MonthYear {
  year: number;
  month: number;
}

export type ReturnCoverageSource = 'GSTR-2B' | 'GSTR-3B';

/** Months 1..12 for past years, or 1..current month for the current calendar year. */
export function getRequiredMonthsForYear(year: number, referenceDate = new Date()): number[] {
  const currentYear = referenceDate.getFullYear();
  const currentMonth = referenceDate.getMonth() + 1;

  if (year > currentYear) {
    return [];
  }
  if (year < currentYear) {
    return Array.from({ length: 12 }, (_, index) => index + 1);
  }
  return Array.from({ length: currentMonth }, (_, index) => index + 1);
}

export function parseMmYyyy(raw: unknown): MonthYear | null {
  const value = String(raw ?? '').trim();
  const match = value.match(/^(\d{2})(\d{4})$/);
  if (!match) {
    return null;
  }

  const month = Number(match[1]);
  const year = Number(match[2]);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }
  if (!Number.isInteger(year) || year < 2017 || year > 2100) {
    return null;
  }

  return { year, month };
}

export function parseDdMmYyyy(raw: unknown): MonthYear | null {
  const value = String(raw ?? '').trim();
  const match = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (day < 1 || day > 31 || month < 1 || month > 12) {
    return null;
  }

  return { year, month };
}

export function parseDocYearMonth(doc: Record<string, any>): MonthYear | null {
  const year = Number(doc?.year);
  const month = Number(doc?.month);
  if (
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    year >= 2017 &&
    year <= 2100 &&
    month >= 1 &&
    month <= 12
  ) {
    return { year, month };
  }
  return null;
}

function addMonthYear(
  target: Set<number>,
  parsed: MonthYear | null,
  filterYear: number,
): void {
  if (!parsed || parsed.year !== filterYear) {
    return;
  }
  target.add(parsed.month);
}

/**
 * GSTR-2B monthly document (`gst_2b_compliance_data`).
 *
 * Coverage is based only on the stored fetch period (doc.year/month) and, if
 * present, the return-period fields on the response envelope.
 *
 * Do NOT use invoice-level `supprd` / `supfildt`: those are supplier filing
 * periods inside one month's GSTR-2B and would falsely mark other months as
 * already fetched.
 */
export function extractCoveredMonthsFromGstr2b(
  doc: Record<string, any> | null | undefined,
  year: number,
): Set<number> {
  const covered = new Set<number>();
  if (!doc) {
    return covered;
  }

  addMonthYear(covered, parseDocYearMonth(doc), year);

  const payload = doc.gstr2bResponse ?? doc;
  const nested = payload?.data?.data ?? payload?.data ?? payload;
  const payloadYear = Number(nested?.year ?? payload?.year ?? doc?.year);
  const payloadMonth = Number(nested?.month ?? payload?.month ?? doc?.month);
  if (
    Number.isInteger(payloadYear) &&
    Number.isInteger(payloadMonth) &&
    payloadMonth >= 1 &&
    payloadMonth <= 12
  ) {
    addMonthYear(covered, { year: payloadYear, month: payloadMonth }, year);
  }

  const fromPeriod = parseMmYyyy(
    nested?.ret_period ??
      nested?.ret_prd ??
      nested?.fp ??
      payload?.ret_period ??
      payload?.ret_prd,
  );
  addMonthYear(covered, fromPeriod, year);

  return covered;
}

/** GSTR-3B monthly document (`gst_3b_compliance_data`). */
export function extractCoveredMonthsFromGstr3b(
  doc: Record<string, any> | null | undefined,
  year: number,
): Set<number> {
  const covered = new Set<number>();
  if (!doc) {
    return covered;
  }

  addMonthYear(covered, parseDocYearMonth(doc), year);

  const payload = doc.gstr3bResponse ?? doc;
  const nested = payload?.data?.data ?? payload?.data ?? payload;
  const payloadYear = Number(nested?.year ?? payload?.year);
  const payloadMonth = Number(nested?.month ?? payload?.month);
  if (
    Number.isInteger(payloadYear) &&
    Number.isInteger(payloadMonth) &&
    payloadMonth >= 1 &&
    payloadMonth <= 12
  ) {
    addMonthYear(covered, { year: payloadYear, month: payloadMonth }, year);
  }

  const fromPeriod = parseMmYyyy(
    nested?.ret_period ??
      nested?.ret_prd ??
      nested?.fp ??
      payload?.ret_period ??
      payload?.ret_prd,
  );
  addMonthYear(covered, fromPeriod, year);

  return covered;
}

export function getMissingMonths(
  requiredMonths: number[],
  coveredMonths: Set<number>,
): number[] {
  return requiredMonths.filter((month) => !coveredMonths.has(month));
}
