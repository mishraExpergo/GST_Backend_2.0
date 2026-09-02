import {
  buildDonutCounts,
  buildDrilldownRows,
  buildInterpretation,
  classifyLegalRisk,
  extractNoticeItems,
  findMissingNoticeGstins,
  flattenNoticeItem,
  parseFinancialYearParam,
  parseNoticeDate,
  uniqueNotices,
} from './gst-legal-risk-chart.util';

describe('gst-legal-risk-chart.util', () => {
  it('classifies demand/recovery as HIGH and refund as LOW', () => {
    expect(classifyLegalRisk('DRC-07', 'Demand')).toBe('HIGH');
    expect(classifyLegalRisk('ASMT-10', 'Scrutiny')).toBe('MEDIUM');
    expect(classifyLegalRisk('RFD-01', 'Refund')).toBe('LOW');
    expect(classifyLegalRisk(null, null)).toBeNull();
  });

  it('parses issue dates and maps to Indian FY', () => {
    const date = parseNoticeDate('15/06/2025');
    expect(date?.getFullYear()).toBe(2025);
    expect(parseFinancialYearParam(undefined)).toMatch(/^\d{4}-\d{2}$/);
    expect(parseFinancialYearParam('2024-25')).toBe('2024-25');
  });

  it('flattens nested notice payloads', () => {
    const items = extractNoticeItems({
      data: {
        notices: [
          {
            formCd: 'DRC-01',
            ntcDesc: 'Show cause',
            dtIssue: '01/05/2025',
            dtReply: '20/05/2025',
            refId: 'REF-1',
          },
        ],
      },
    });
    expect(items).toHaveLength(1);
    const notice = flattenNoticeItem('27AAACN0255D1ZM', 'L1', 'C1', items[0]);
    expect(notice.risk).toBe('HIGH');
    expect(notice.financialYear).toBe('2025-26');
    expect(notice.formCode).toBe('DRC-01');
  });

  it('builds donut counts and percentages that sum to 100', () => {
    const notices = [
      flattenNoticeItem('G1', 'L1', 'C1', {
        formCd: 'DRC-07',
        dtIssue: '10/04/2025',
      }),
      flattenNoticeItem('G1', 'L1', 'C1', {
        formCd: 'ASMT-10',
        dtIssue: '11/04/2025',
      }),
      flattenNoticeItem('G2', 'L1', 'C1', {
        formCd: 'RFD-01',
        dtIssue: '12/04/2025',
      }),
    ];
    const counts = buildDonutCounts(notices, '2025-26');
    expect(counts.total).toBe(3);
    expect(counts.high).toBe(1);
    expect(counts.medium).toBe(1);
    expect(counts.low).toBe(1);
    expect(
      Number(counts.pctHigh) + Number(counts.pctMedium) + Number(counts.pctLow),
    ).toBeCloseTo(100, 1);
  });

  it('keeps counts null when the FY has no classified notices', () => {
    const counts = buildDonutCounts([], '2025-26');
    expect(counts.total).toBeNull();
    expect(counts.high).toBeNull();
  });

  it('detects repeated notices and missing GSTINs', () => {
    const notices = uniqueNotices([
      flattenNoticeItem('G1', 'L1', 'C1', {
        formCd: 'DRC-01',
        dtIssue: '01/05/2025',
        refId: 'A',
      }),
      flattenNoticeItem('G1', 'L1', 'C1', {
        formCd: 'DRC-01',
        dtIssue: '02/06/2025',
        refId: 'B',
      }),
    ]);
    const interpretation = buildInterpretation(notices, '2025-26', null);
    expect(interpretation.repeatedNotices[0]?.count).toBe(2);
    expect(findMissingNoticeGstins(['G1', 'G2'], new Set(['G1']), '2025-26')).toEqual(
      [{ gstin: 'G2', financialYear: '2025-26' }],
    );
  });

  it('returns High-risk drilldown newest first', () => {
    const notices = [
      flattenNoticeItem('G1', 'L1', 'C1', {
        formCd: 'DRC-01',
        dtIssue: '01/05/2025',
        refId: 'OLD',
      }),
      flattenNoticeItem('G1', 'L1', 'C1', {
        formCd: 'DRC-07',
        dtIssue: '01/08/2025',
        refId: 'NEW',
      }),
    ];
    const rows = buildDrilldownRows(notices, '2025-26', 'HIGH');
    expect(rows).toHaveLength(2);
    expect(rows[0].referenceId).toBe('NEW');
  });
});
