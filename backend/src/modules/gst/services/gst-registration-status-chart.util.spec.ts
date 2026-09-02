import {
  buildFyPeriodSpecs,
  buildNetChange,
  buildSankeyFlows,
  buildStatusMatrix,
  buildYearlySeries,
  complianceDocToRegistrationRecord,
  findMissingRegistrationSlots,
  normalizeRegistrationStatus,
  parseGstDate,
  statusAsOfFinancialYear,
} from './gst-registration-status-chart.util';

describe('gst-registration-status-chart.util', () => {
  const ref = new Date('2026-08-15T00:00:00Z');

  it('normalizes sandbox registration statuses', () => {
    expect(normalizeRegistrationStatus('Active')).toBe('ACTIVE');
    expect(normalizeRegistrationStatus('Cancelled')).toBe('CANCELLED');
    expect(normalizeRegistrationStatus('Suspended')).toBe('SUSPENDED');
    expect(normalizeRegistrationStatus('Unknown')).toBeNull();
  });

  it('builds trailing FY specs for 1y/3y/5y', () => {
    expect(buildFyPeriodSpecs('1y', ref)).toHaveLength(1);
    expect(buildFyPeriodSpecs('3y', ref)).toHaveLength(3);
    expect(buildFyPeriodSpecs('5y', ref)).toHaveLength(5);
    expect(buildFyPeriodSpecs('3y', ref)[2].period).toBe('FY26-27');
  });

  it('maps compliance doc to registration record', () => {
    const record = complianceDocToRegistrationRecord({
      gstin: '27AAACN0255D1ZM',
      loanId: 'L1',
      customerId: 'C1',
      searchResponse: {
        data: {
          data: {
            gstin: '27AAACN0255D1ZM',
            lgnm: 'ACME',
            sts: 'Active',
            rgdt: '01/04/2020',
            cxdt: '15/06/2024',
            pradr: { addr: { stcd: 'Maharashtra' } },
          },
        },
      },
    });

    expect(record?.currentStatus).toBe('ACTIVE');
    expect(record?.legalName).toBe('ACME');
    expect(record?.state).toBe('Maharashtra');
    expect(parseGstDate('01/04/2020')?.getFullYear()).toBe(2020);
  });

  it('derives cancelled status before FY end using cancellation date', () => {
    const record = complianceDocToRegistrationRecord({
      gstin: 'G1',
      loanId: 'L1',
      searchResponse: {
        data: {
          data: {
            sts: 'Active',
            rgdt: '01/04/2020',
            cxdt: '15/06/2024',
          },
        },
      },
    })!;

    expect(statusAsOfFinancialYear(record, 2023)).toBe('ACTIVE');
    expect(statusAsOfFinancialYear(record, 2024)).toBe('CANCELLED');
  });

  it('builds yearly series, flows, and net change', () => {
    const specs = buildFyPeriodSpecs('3y', ref);
    const gstins = ['G1', 'G2'];
    const records = new Map([
      [
        'G1',
        complianceDocToRegistrationRecord({
          gstin: 'G1',
          loanId: 'L1',
          searchResponse: { data: { data: { sts: 'Active', rgdt: '01/04/2020' } } },
        })!,
      ],
      [
        'G2',
        complianceDocToRegistrationRecord({
          gstin: 'G2',
          loanId: 'L1',
          searchResponse: {
            data: { data: { sts: 'Cancelled', rgdt: '01/04/2020' } },
          },
        })!,
      ],
    ]);
    const matrix = buildStatusMatrix(gstins, specs, records);
    const series = buildYearlySeries(gstins, specs, matrix);
    const flows = buildSankeyFlows(gstins, specs, matrix);
    const netChange = buildNetChange(series);

    expect(series.every((row) => row.total === 2)).toBe(true);
    expect(series[0].active).toBe(1);
    expect(series[0].cancelled).toBe(1);
    expect(flows.length).toBeGreaterThan(0);
    expect(netChange?.active).toBe(0);
  });

  it('lists missing slots when compliance record is absent', () => {
    const specs = buildFyPeriodSpecs('1y', ref);
    const gstins = ['G1'];
    const records = new Map();
    const missing = findMissingRegistrationSlots(gstins, specs, records);
    expect(missing).toHaveLength(1);
    expect(missing[0].gstin).toBe('G1');
  });
});
