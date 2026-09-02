/**
 * Registration Status chart — GSTREG1 / compliance search (Active / Cancelled / Suspended).
 * Yearly Sankey: FY buckets, status counts, GSTIN flows, net change.
 */

import {
  currentFyStartYear,
  formatFinancialYear,
  formatPeriodLabel,
  type ChartEntityType,
  type ChartRangeKey,
} from './gst-tax-payment-chart.util';

export type RegistrationStatus = 'ACTIVE' | 'CANCELLED' | 'SUSPENDED';

export interface FyPeriodSpec {
  financialYear: string;
  fyStartYear: number;
  period: string;
}

export interface GstRegistrationRecord {
  gstin: string;
  loanId: string;
  customerId: string;
  legalName: string | null;
  state: string | null;
  registrationDate: Date | null;
  cancellationDate: Date | null;
  /** Current normalized status from GSTREG1 search. */
  currentStatus: RegistrationStatus | null;
}

export interface RegistrationYearPoint {
  period: string;
  financialYear: string;
  active: number | null;
  cancelled: number | null;
  suspended: number | null;
  total: number | null;
  pctActive: number | null;
  pctCancelled: number | null;
  pctSuspended: number | null;
}

export interface RegistrationFlow {
  fromPeriod: string;
  toPeriod: string;
  fromStatus: RegistrationStatus;
  toStatus: RegistrationStatus;
  count: number;
}

export interface RegistrationNetChange {
  fromPeriod: string;
  toPeriod: string;
  active: number | null;
  cancelled: number | null;
  suspended: number | null;
}

export interface RegistrationMissingRow {
  gstin: string;
  financialYear: string;
}

export interface RegistrationDrilldownRow {
  gstin: string;
  status: RegistrationStatus;
  legalName: string | null;
  registrationDate: string | null;
  cancellationDate: string | null;
  state: string | null;
}

export interface RegistrationStatusChartResponse {
  series: RegistrationYearPoint[];
  flows: RegistrationFlow[];
  netChange: RegistrationNetChange | null;
  incomplete: boolean;
  missing: RegistrationMissingRow[];
  drilldown?: {
    period: string;
    financialYear: string;
    status: RegistrationStatus;
    rows: RegistrationDrilldownRow[];
  };
  fetch?: {
    jobs: Array<{
      jobId: string;
      status: string;
      checkStatusUrl: string;
    }>;
  };
}

export function normalizeRegistrationStatus(
  raw: string | null | undefined,
): RegistrationStatus | null {
  if (!raw) {
    return null;
  }
  const normalized = String(raw).trim().toUpperCase();
  if (normalized === 'ACTIVE' || normalized === 'ACT') {
    return 'ACTIVE';
  }
  if (
    normalized === 'CANCELLED' ||
    normalized === 'CANCELED' ||
    normalized === 'CNL'
  ) {
    return 'CANCELLED';
  }
  if (normalized === 'SUSPENDED' || normalized === 'SUSP') {
    return 'SUSPENDED';
  }
  return null;
}

/** FY ends 31 March of fyStartYear + 1. */
export function fyEndDate(fyStartYear: number): Date {
  return new Date(fyStartYear + 1, 2, 31, 23, 59, 59, 999);
}

export function buildFyPeriodSpecs(
  range: ChartRangeKey,
  referenceDate = new Date(),
): FyPeriodSpec[] {
  const count = range === '1y' ? 1 : range === '3y' ? 3 : 5;
  const fyStart = currentFyStartYear(referenceDate);
  const specs: FyPeriodSpec[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = fyStart - i;
    specs.push({
      financialYear: formatFinancialYear(start),
      fyStartYear: start,
      period: formatPeriodLabel(start, null),
    });
  }
  return specs;
}

export function parseGstDate(raw: unknown): Date | null {
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw;
  }
  const value = String(raw).trim();
  if (!value) {
    return null;
  }

  const dmy = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]) - 1;
    const year = Number(dmy[3]);
    const date = new Date(year, month, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const iso = new Date(value);
  return Number.isNaN(iso.getTime()) ? null : iso;
}

export function extractSearchBody(
  payload: Record<string, any> | null | undefined,
): Record<string, any> | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const nested = payload.data?.data;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return nested as Record<string, any>;
  }
  const level1 = payload.data;
  if (level1 && typeof level1 === 'object' && !Array.isArray(level1)) {
    return level1 as Record<string, any>;
  }
  return payload;
}

export function complianceDocToRegistrationRecord(doc: {
  gstin?: string;
  loanId?: string;
  customerId?: string;
  status?: string;
  legalName?: string;
  searchResponse?: Record<string, any>;
  verifyResponse?: Record<string, any>;
}): GstRegistrationRecord | null {
  const gstin = String(doc.gstin ?? '').trim().toUpperCase();
  const loanId = String(doc.loanId ?? '').trim();
  if (!gstin || !loanId) {
    return null;
  }

  const search = extractSearchBody(doc.searchResponse);
  const rawStatus =
    search?.sts ??
    doc.status ??
    doc.verifyResponse?.data?.data?.status ??
    doc.verifyResponse?.data?.status;

  const registrationDate = parseGstDate(
    search?.rgdt ?? search?.registrationDate ?? search?.dtReg,
  );
  const cancellationDate = parseGstDate(
    search?.cxdt ??
      search?.cancellationDate ??
      search?.dtDReg ??
      search?.cnclDt,
  );

  const stateCode = String(search?.gstin ?? gstin).slice(0, 2);
  const state =
    String(search?.pradr?.addr?.stcd ?? search?.stcd ?? '').trim() ||
    (stateCode.length === 2 ? stateCode : null);

  return {
    gstin,
    loanId,
    customerId: String(doc.customerId ?? '').trim(),
    legalName: String(
      search?.lgnm ?? doc.legalName ?? search?.tradeNam ?? '',
    ).trim() || null,
    state,
    registrationDate,
    cancellationDate,
    currentStatus: normalizeRegistrationStatus(rawStatus),
  };
}

/**
 * Status as of FY end using registration/cancellation dates when present,
 * otherwise current GSTREG1 snapshot status.
 */
export function statusAsOfFinancialYear(
  record: GstRegistrationRecord | null,
  fyStartYear: number,
): RegistrationStatus | null {
  if (!record) {
    return null;
  }

  const fyEnd = fyEndDate(fyStartYear);

  if (record.registrationDate && record.registrationDate > fyEnd) {
    return null;
  }

  if (
    record.cancellationDate &&
    record.cancellationDate.getTime() <= fyEnd.getTime()
  ) {
    return 'CANCELLED';
  }

  return record.currentStatus;
}

export function buildStatusMatrix(
  gstins: string[],
  specs: FyPeriodSpec[],
  recordsByGstin: Map<string, GstRegistrationRecord>,
): Map<string, Map<string, RegistrationStatus | null>> {
  const matrix = new Map<string, Map<string, RegistrationStatus | null>>();
  for (const gstin of gstins) {
    const record = recordsByGstin.get(gstin) ?? null;
    const byFy = new Map<string, RegistrationStatus | null>();
    for (const spec of specs) {
      byFy.set(
        spec.financialYear,
        statusAsOfFinancialYear(record, spec.fyStartYear),
      );
    }
    matrix.set(gstin, byFy);
  }
  return matrix;
}

function pct(count: number | null, total: number | null): number | null {
  if (count === null || total === null || total === 0) {
    return null;
  }
  return Math.round((count / total) * 10000) / 100;
}

export function buildYearlySeries(
  gstins: string[],
  specs: FyPeriodSpec[],
  statusMatrix: Map<string, Map<string, RegistrationStatus | null>>,
): RegistrationYearPoint[] {
  return specs.map((spec) => {
    let active = 0;
    let cancelled = 0;
    let suspended = 0;
    let total = 0;

    for (const gstin of gstins) {
      const status = statusMatrix.get(gstin)?.get(spec.financialYear) ?? null;
      if (status === null) {
        continue;
      }
      total += 1;
      if (status === 'ACTIVE') {
        active += 1;
      } else if (status === 'CANCELLED') {
        cancelled += 1;
      } else if (status === 'SUSPENDED') {
        suspended += 1;
      }
    }

    if (total === 0) {
      return {
        period: spec.period,
        financialYear: spec.financialYear,
        active: null,
        cancelled: null,
        suspended: null,
        total: null,
        pctActive: null,
        pctCancelled: null,
        pctSuspended: null,
      };
    }

    return {
      period: spec.period,
      financialYear: spec.financialYear,
      active,
      cancelled,
      suspended,
      total,
      pctActive: pct(active, total),
      pctCancelled: pct(cancelled, total),
      pctSuspended: pct(suspended, total),
    };
  });
}

export function buildSankeyFlows(
  gstins: string[],
  specs: FyPeriodSpec[],
  statusMatrix: Map<string, Map<string, RegistrationStatus | null>>,
): RegistrationFlow[] {
  if (specs.length < 2) {
    return [];
  }

  const flowIndex = new Map<string, number>();

  for (let i = 1; i < specs.length; i++) {
    const fromSpec = specs[i - 1];
    const toSpec = specs[i];
    for (const gstin of gstins) {
      const fromStatus = statusMatrix
        .get(gstin)
        ?.get(fromSpec.financialYear);
      const toStatus = statusMatrix.get(gstin)?.get(toSpec.financialYear);
      if (!fromStatus || !toStatus) {
        continue;
      }
      const key = `${fromSpec.period}|${fromStatus}|${toSpec.period}|${toStatus}`;
      flowIndex.set(key, (flowIndex.get(key) ?? 0) + 1);
    }
  }

  return [...flowIndex.entries()].map(([key, count]) => {
    const [fromPeriod, fromStatus, toPeriod, toStatus] = key.split('|');
    return {
      fromPeriod,
      toPeriod,
      fromStatus: fromStatus as RegistrationStatus,
      toStatus: toStatus as RegistrationStatus,
      count,
    };
  });
}

export function buildNetChange(
  series: RegistrationYearPoint[],
): RegistrationNetChange | null {
  if (series.length < 2) {
    return null;
  }
  const first = series[0];
  const last = series[series.length - 1];

  const delta = (
    current: number | null,
    previous: number | null,
  ): number | null => {
    if (current === null || previous === null) {
      return null;
    }
    return current - previous;
  };

  return {
    fromPeriod: first.period,
    toPeriod: last.period,
    active: delta(last.active, first.active),
    cancelled: delta(last.cancelled, first.cancelled),
    suspended: delta(last.suspended, first.suspended),
  };
}

export function findMissingRegistrationSlots(
  gstins: string[],
  specs: FyPeriodSpec[],
  recordsByGstin: Map<string, GstRegistrationRecord>,
): RegistrationMissingRow[] {
  const missing: RegistrationMissingRow[] = [];
  for (const gstin of gstins) {
    const record = recordsByGstin.get(gstin);
    if (!record || record.currentStatus === null) {
      for (const spec of specs) {
        missing.push({ gstin, financialYear: spec.financialYear });
      }
    }
  }
  return missing;
}

export function parseRegistrationStatusFilter(
  raw: string | undefined,
): RegistrationStatus | null {
  const value = String(raw ?? '')
    .trim()
    .toUpperCase();
  if (
    value === 'ACTIVE' ||
    value === 'CANCELLED' ||
    value === 'SUSPENDED'
  ) {
    return value;
  }
  return null;
}

export function parseFinancialYearFilter(raw: string): number {
  const value = String(raw ?? '').trim();
  const match = value.match(/^(?:FY\s*)?(\d{4})\s*[-/]\s*(\d{2}|\d{4})$/i);
  if (!match) {
    throw new Error(
      `Invalid financialYear "${raw}". Expected format like "2023-24".`,
    );
  }
  return Number(match[1]);
}

export function buildDrilldownRows(
  spec: FyPeriodSpec,
  gstins: string[],
  recordsByGstin: Map<string, GstRegistrationRecord>,
  statusMatrix: Map<string, Map<string, RegistrationStatus | null>>,
  statusFilter: RegistrationStatus,
): RegistrationDrilldownRow[] {
  const rows: RegistrationDrilldownRow[] = [];
  for (const gstin of gstins) {
    const status =
      statusMatrix.get(gstin)?.get(spec.financialYear) ?? null;
    if (status !== statusFilter) {
      continue;
    }
    const record = recordsByGstin.get(gstin);
    rows.push({
      gstin,
      status: statusFilter,
      legalName: record?.legalName ?? null,
      registrationDate: record?.registrationDate
        ? formatDateIso(record.registrationDate)
        : null,
      cancellationDate: record?.cancellationDate
        ? formatDateIso(record.cancellationDate)
        : null,
      state: record?.state ?? null,
    });
  }
  return rows;
}

function formatDateIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export type { ChartEntityType, ChartRangeKey };
