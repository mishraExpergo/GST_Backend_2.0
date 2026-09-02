/**
 * Legal Risk donut — notices from gst_notices_data.
 * FY from issue date; High / Medium / Low from form-code / notice-type mapping.
 */

import {
  currentFyStartYear,
  formatFinancialYear,
} from './gst-tax-payment-chart.util';

export type LegalRiskLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export type LegalNoticeFamily =
  | 'COMPLIANCE'
  | 'DEMAND'
  | 'RECOVERY'
  | 'REGISTRATION'
  | 'ASSESSMENT'
  | 'INVESTIGATION'
  | 'REFUND'
  | 'APPEAL'
  | 'OTHER';

export interface FlattenedLegalNotice {
  gstin: string;
  loanId: string;
  customerId: string;
  referenceId: string | null;
  formCode: string | null;
  noticeName: string | null;
  purpose: string | null;
  issueDate: Date | null;
  dueDate: Date | null;
  status: string | null;
  currentStatus: string | null;
  noticeType: string | null;
  risk: LegalRiskLevel | null;
  noticeFamily: LegalNoticeFamily;
  financialYear: string | null;
}

export interface LegalRiskDonutCounts {
  financialYear: string;
  total: number | null;
  high: number | null;
  medium: number | null;
  low: number | null;
  pctHigh: number | null;
  pctMedium: number | null;
  pctLow: number | null;
  previousYearTotal: number | null;
}

export interface LegalRiskInterpretation {
  activeCount: number | null;
  highRiskActiveCount: number | null;
  overdueActiveCount: number | null;
  yoyChange: number | null;
  repeatedNotices: Array<{
    gstin: string;
    formCode: string | null;
    noticeType: string | null;
    count: number;
  }>;
}

export interface LegalRiskMissingRow {
  gstin: string;
  financialYear: string;
}

export interface LegalRiskDrilldownRow {
  gstin: string;
  risk: LegalRiskLevel;
  formCode: string | null;
  noticeName: string | null;
  purpose: string | null;
  issueDate: string | null;
  dueDate: string | null;
  status: string | null;
  currentStatus: string | null;
  noticeFamily: LegalNoticeFamily | null;
  referenceId: string | null;
}

export interface LegalRiskChartResponse {
  financialYear: string;
  total: number | null;
  high: number | null;
  medium: number | null;
  low: number | null;
  pctHigh: number | null;
  pctMedium: number | null;
  pctLow: number | null;
  previousYearTotal: number | null;
  interpretation: LegalRiskInterpretation;
  incomplete: boolean;
  missing: LegalRiskMissingRow[];
  drilldown?: {
    financialYear: string;
    risk: LegalRiskLevel;
    rows: LegalRiskDrilldownRow[];
  };
  fetch?: {
    jobs: Array<{
      jobId: string;
      status: string;
      checkStatusUrl: string;
    }>;
  };
}

/** Placeholder until the approved classification file arrives. */
const HIGH_TOKENS = [
  'DRC',
  'SCN',
  'SUMMON',
  'INSPECTION',
  'SEARCH',
  'SEIZURE',
  'ARREST',
  'PROSECUTION',
  '73',
  '74',
  '75',
  '79',
  '83',
  'DEMAND',
  'RECOVERY',
];

const MEDIUM_TOKENS = [
  'ASMT',
  'SCRUTINY',
  'AUDIT',
  'MISMATCH',
  '61',
  '71',
  '72',
  'ASSESSMENT',
];

const LOW_TOKENS = [
  'REG',
  'REFUND',
  'RFD',
  'REMINDER',
  'GENERAL',
  'CMP',
  'LATE FEE',
];

export function parseLegalRiskFilter(
  raw: string | undefined,
): LegalRiskLevel | null {
  const value = String(raw ?? '')
    .trim()
    .toUpperCase();
  if (value === 'HIGH' || value === 'MEDIUM' || value === 'LOW') {
    return value;
  }
  return null;
}

export function parseFinancialYearParam(raw?: string): string {
  const value = String(raw ?? '').trim();
  if (!value) {
    return formatFinancialYear(currentFyStartYear());
  }
  const match = value.match(/^(?:FY\s*)?(\d{4})\s*[-/]\s*(\d{2}|\d{4})$/i);
  if (!match) {
    throw new Error(
      `Invalid financialYear "${raw}". Expected format like "2025-26".`,
    );
  }
  return formatFinancialYear(Number(match[1]));
}

export function previousFinancialYear(financialYear: string): string {
  const start = Number(financialYear.slice(0, 4));
  return formatFinancialYear(start - 1);
}

export function parseNoticeDate(raw: unknown): Date | null {
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
    const date = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const iso = new Date(value);
  return Number.isNaN(iso.getTime()) ? null : iso;
}

export function issueDateToFinancialYear(date: Date | null): string | null {
  if (!date) {
    return null;
  }
  return formatFinancialYear(currentFyStartYear(date));
}

export function classifyLegalRisk(
  formCode: string | null,
  noticeType: string | null,
): LegalRiskLevel | null {
  const haystack = `${formCode ?? ''} ${noticeType ?? ''}`.toUpperCase();
  if (!haystack.trim()) {
    return null;
  }
  if (HIGH_TOKENS.some((token) => haystack.includes(token))) {
    return 'HIGH';
  }
  if (MEDIUM_TOKENS.some((token) => haystack.includes(token))) {
    return 'MEDIUM';
  }
  if (LOW_TOKENS.some((token) => haystack.includes(token))) {
    return 'LOW';
  }
  return null;
}

export function classifyNoticeFamily(
  formCode: string | null,
  noticeType: string | null,
): LegalNoticeFamily {
  const haystack = `${formCode ?? ''} ${noticeType ?? ''}`.toUpperCase();
  if (/(RECOVERY|79|83)/.test(haystack)) {
    return 'RECOVERY';
  }
  if (/(DRC|DEMAND|73|74|75|SCN)/.test(haystack)) {
    return 'DEMAND';
  }
  if (/(SUMMON|INSPECT|SEARCH|SEIZURE|ARREST|PROSECUT)/.test(haystack)) {
    return 'INVESTIGATION';
  }
  if (/(ASMT|ASSESS|SCRUTINY|AUDIT)/.test(haystack)) {
    return 'ASSESSMENT';
  }
  if (/(REG)/.test(haystack)) {
    return 'REGISTRATION';
  }
  if (/(RFD|REFUND)/.test(haystack)) {
    return 'REFUND';
  }
  if (/(APPEAL|APL)/.test(haystack)) {
    return 'APPEAL';
  }
  if (haystack.trim()) {
    return 'COMPLIANCE';
  }
  return 'OTHER';
}

function pickString(obj: Record<string, any>, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return null;
}

export function extractNoticeItems(payload: unknown): Record<string, any>[] {
  if (!payload) {
    return [];
  }
  if (Array.isArray(payload)) {
    return payload.filter((item) => item && typeof item === 'object');
  }
  if (typeof payload !== 'object') {
    return [];
  }
  const body = payload as Record<string, any>;
  const candidates = [
    body.notices,
    body.data?.notices,
    body.data?.data?.notices,
    body.data?.data,
    body.data,
    body.result,
    body.noticeList,
    body.response?.notices,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter((item) => item && typeof item === 'object');
    }
  }
  return [];
}

export function flattenNoticeItem(
  gstin: string,
  loanId: string,
  customerId: string,
  item: Record<string, any>,
): FlattenedLegalNotice {
  const formCode = pickString(item, [
    'formCode',
    'formCd',
    'form_cd',
    'formCd',
    'ntcTyp',
    'noticeType',
    'type',
  ]);
  const noticeType = pickString(item, [
    'noticeType',
    'ntcTyp',
    'type',
    'formCode',
    'formCd',
  ]);
  const issueDate = parseNoticeDate(
    pickString(item, [
      'issueDate',
      'dtIssue',
      'dateOfIssue',
      'ntcDt',
      'noticeDate',
      'dt',
      'dtIssue',
    ]),
  );
  const dueDate = parseNoticeDate(
    pickString(item, [
      'dueDate',
      'dtReply',
      'replyDueDate',
      'dueDt',
      'dtDue',
      'dtReply',
    ]),
  );
  const risk = classifyLegalRisk(formCode, noticeType);

  return {
    gstin,
    loanId,
    customerId,
    referenceId: pickString(item, [
      'referenceId',
      'refId',
      'arn',
      'ntcId',
      'noticeId',
      'id',
      'refId',
    ]),
    formCode,
    noticeName: pickString(item, [
      'noticeName',
      'formName',
      'ntcDesc',
      'desc',
      'title',
      'ntcDesc',
    ]),
    purpose: pickString(item, [
      'purpose',
      'description',
      'ntcDesc',
      'remark',
    ]),
    issueDate,
    dueDate,
    status: pickString(item, ['status', 'ntcSts', 'sts']),
    currentStatus: pickString(item, [
      'currentStatus',
      'caseStatus',
      'status',
    ]),
    noticeType,
    risk,
    noticeFamily: classifyNoticeFamily(formCode, noticeType),
    financialYear: issueDateToFinancialYear(issueDate),
  };
}

export function dedupeNotices(
  notices: FlattenedLegalNotice[],
): FlattenedLegalNotice[] {
  const byKey = new Map<string, FlattenedLegalNotice>();
  for (const notice of notices) {
    const key = `${notice.gstin}|${notice.referenceId ?? ''}|${notice.formCode ?? ''}|${notice.issueDate?.toISOString().slice(0, 10) ?? ''}`;
    if (!byKey.has(key)) {
      byKey.set(key, notice);
    }
  }
  return [...byKey.values()];
}

function roundPct(count: number, total: number): number {
  return Math.round((count / total) * 10000) / 100;
}

export function buildDonutCounts(
  notices: FlattenedLegalNotice[],
  financialYear: string,
): LegalRiskDonutCounts {
  const inYear = notices.filter(
    (notice) => notice.financialYear === financialYear && notice.risk,
  );
  const previousYear = previousFinancialYear(financialYear);
  const previousMapped = notices.filter(
    (notice) => notice.financialYear === previousYear && notice.risk,
  );

  if (inYear.length === 0) {
    return {
      financialYear,
      total: null,
      high: null,
      medium: null,
      low: null,
      pctHigh: null,
      pctMedium: null,
      pctLow: null,
      previousYearTotal: previousMapped.length > 0 ? previousMapped.length : null,
    };
  }

  const high = inYear.filter((n) => n.risk === 'HIGH').length;
  const medium = inYear.filter((n) => n.risk === 'MEDIUM').length;
  const low = inYear.filter((n) => n.risk === 'LOW').length;
  const total = high + medium + low;

  return {
    financialYear,
    total,
    high,
    medium,
    low,
    pctHigh: total ? roundPct(high, total) : null,
    pctMedium: total ? roundPct(medium, total) : null,
    pctLow: total ? roundPct(low, total) : null,
    previousYearTotal: previousMapped.length > 0 ? previousMapped.length : null,
  };
}

function isClosedStatus(raw: string | null): boolean {
  const value = String(raw ?? '').toUpperCase();
  return (
    value.includes('CLOSE') ||
    value.includes('RESOLV') ||
    value.includes('DISPOSE') ||
    value.includes('REPLIED')
  );
}

function isActiveNotice(notice: FlattenedLegalNotice, now: Date): boolean {
  if (isClosedStatus(notice.currentStatus) || isClosedStatus(notice.status)) {
    return false;
  }
  return true;
}

export function buildInterpretation(
  notices: FlattenedLegalNotice[],
  financialYear: string,
  previousYearTotal: number | null,
  now = new Date(),
): LegalRiskInterpretation {
  const inYear = notices.filter((n) => n.financialYear === financialYear);
  const mapped = inYear.filter((n) => n.risk);
  if (mapped.length === 0) {
    return {
      activeCount: null,
      highRiskActiveCount: null,
      overdueActiveCount: null,
      yoyChange: null,
      repeatedNotices: [],
    };
  }

  const active = mapped.filter((n) => isActiveNotice(n, now));
  const highRiskActive = active.filter((n) => n.risk === 'HIGH').length;
  const overdue = active.filter(
    (n) => n.dueDate !== null && n.dueDate.getTime() < now.getTime(),
  ).length;

  const groups = new Map<string, FlattenedLegalNotice[]>();
  for (const notice of mapped) {
    const key = `${notice.gstin}|${notice.formCode ?? notice.noticeType ?? ''}`;
    const list = groups.get(key) ?? [];
    list.push(notice);
    groups.set(key, list);
  }
  const repeatedNotices = [...groups.values()]
    .filter((list) => list.length >= 2)
    .map((list) => ({
      gstin: list[0].gstin,
      formCode: list[0].formCode,
      noticeType: list[0].noticeType,
      count: list.length,
    }));

  return {
    activeCount: active.length,
    highRiskActiveCount: highRiskActive,
    overdueActiveCount: overdue,
    yoyChange:
      previousYearTotal === null ? null : mapped.length - previousYearTotal,
    repeatedNotices,
  };
}

export function findMissingNoticeGstins(
  gstins: string[],
  gstinsWithListRecord: Set<string>,
  financialYear: string,
): LegalRiskMissingRow[] {
  return gstins
    .filter((gstin) => !gstinsWithListRecord.has(gstin))
    .map((gstin) => ({ gstin, financialYear }));
}

export function buildDrilldownRows(
  notices: FlattenedLegalNotice[],
  financialYear: string,
  risk: LegalRiskLevel,
): LegalRiskDrilldownRow[] {
  const rank: Record<LegalRiskLevel, number> = {
    HIGH: 0,
    MEDIUM: 1,
    LOW: 2,
  };
  return notices
    .filter((n) => n.financialYear === financialYear && n.risk === risk)
    .sort((a, b) => {
      const byRisk = rank[a.risk!] - rank[b.risk!];
      if (byRisk !== 0) {
        return byRisk;
      }
      const aTime = a.issueDate?.getTime() ?? 0;
      const bTime = b.issueDate?.getTime() ?? 0;
      return bTime - aTime;
    })
    .map((n) => ({
      gstin: n.gstin,
      risk: n.risk!,
      formCode: n.formCode,
      noticeName: n.noticeName,
      purpose: n.purpose,
      issueDate: n.issueDate ? n.issueDate.toISOString().slice(0, 10) : null,
      dueDate: n.dueDate ? n.dueDate.toISOString().slice(0, 10) : null,
      status: n.status,
      currentStatus: n.currentStatus,
      noticeFamily: n.noticeFamily,
      referenceId: n.referenceId,
    }));
}

export function toDdMmYyyy(date = new Date()): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getFullYear()}`;
}

export const uniqueNotices = dedupeNotices;
