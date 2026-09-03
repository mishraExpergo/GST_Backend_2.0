import {
  activeSuppliers,
  buildChurnMetrics,
  buildComparisonRows,
  buildComparisonWindows,
  buildInterpretation,
  classifyStatus,
  dependencyChangePp,
  dependencyShare,
  extractSupplierPurchases,
  findMissing2bMonths,
  monthPresenceKey,
  rollUpBySupplier,
  top5ConcentrationPct,
  top5Series,
} from './gst-supplier-concentration-chart.util';

describe('gst-supplier-concentration-chart.util', () => {
  it('builds 1y as two halves and 3y/5y as two FYs', () => {
    const asOf = new Date('2026-08-15T00:00:00Z');
    const oneYear = buildComparisonWindows('1y', asOf);
    expect(oneYear.previous.half).toBe('H2');
    expect(oneYear.current.half).toBe('H1');
    expect(oneYear.previous.financialYear).toBe('2025-26');
    expect(oneYear.current.financialYear).toBe('2026-27');
    expect(oneYear.previous.months).toHaveLength(6);
    expect(oneYear.current.months).toHaveLength(6);

    const threeYear = buildComparisonWindows('3y', asOf);
    expect(threeYear.previous.half).toBeNull();
    expect(threeYear.current.half).toBeNull();
    expect(threeYear.previous.financialYear).toBe('2025-26');
    expect(threeYear.current.financialYear).toBe('2026-27');

    const fiveYear = buildComparisonWindows('5y', asOf);
    expect(fiveYear.previous.financialYear).toBe(threeYear.previous.financialYear);
    expect(fiveYear.current.financialYear).toBe(threeYear.current.financialYear);
  });

  it('extracts GSTR-2B taxable value by supplier GSTIN and nets credit notes', () => {
    const lines = extractSupplierPurchases({
      data: {
        docdata: {
          b2b: [
            {
              ctin: '27AAAAA0000A1Z5',
              trdnm: 'Alpha Supplies',
              inv: [
                {
                  inum: 'INV-1',
                  itms: [{ itm_det: { txval: 1000 } }, { itm_det: { txval: 500 } }],
                },
              ],
            },
          ],
          cdnr: [
            {
              ctin: '27AAAAA0000A1Z5',
              nt: [
                {
                  ntty: 'C',
                  itms: [{ itm_det: { txval: 200 } }],
                },
              ],
            },
          ],
        },
      },
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].supplierGstin).toBe('27AAAAA0000A1Z5');
    expect(lines[0].supplierName).toBe('Alpha Supplies');
    expect(lines[0].taxableValue).toBe(1300);
  });

  it('computes shares, Top 5 rank, and NEW/LEFT even when net count is unchanged', () => {
    const previous = rollUpBySupplier([
      { supplierGstin: 'S1', supplierName: 'One', taxableValue: 60 },
      { supplierGstin: 'S2', supplierName: 'Two', taxableValue: 40 },
    ]);
    const current = rollUpBySupplier([
      { supplierGstin: 'S1', supplierName: 'One', taxableValue: 70 },
      { supplierGstin: 'S3', supplierName: 'Three', taxableValue: 30 },
    ]);

    expect(dependencyShare(70, 100)).toBe(70);
    expect(dependencyChangePp(70, 60)).toBe(10);
    expect(classifyStatus(60, 0)).toBe('LEFT');
    expect(classifyStatus(0, 30)).toBe('NEW');

    const rows = buildComparisonRows(previous, current);
    expect(rows.map((r) => r.status).sort()).toEqual(['EXISTING', 'LEFT', 'NEW']);
    expect(activeSuppliers(previous).size).toBe(2);
    expect(activeSuppliers(current).size).toBe(2);

    const series = top5Series(rows);
    expect(series[0].supplierGstin).toBe('S1');
    expect(series[0].rank).toBe(1);
    expect(series.some((row) => row.status === 'LEFT')).toBe(false);

    const churn = buildChurnMetrics(rows, 100, 2);
    expect(churn.newSupplierCount).toBe(1);
    expect(churn.attritionCount).toBe(1);
    expect(churn.newSupplierRate).toBe(50);
    expect(churn.attritionRate).toBe(50);
    expect(churn.attritionValue).toBe(40);
    expect(churn.attritionValueShare).toBe(40);

    expect(top5ConcentrationPct(current)).toBe(100);
    const interpretation = buildInterpretation(
      series,
      rows,
      100,
      100,
    );
    expect(interpretation.concentrating).toBe(false);
    expect(interpretation.newInTop5).toContain('S3');
    expect(interpretation.materialLeavers[0]?.supplierGstin).toBe('S2');
  });

  it('treats missing GSTIN-months as missing, not zero', () => {
    const windows = buildComparisonWindows('1y', new Date('2026-08-15T00:00:00Z'));
    const present = new Set([
      monthPresenceKey('G1', windows.current.months[0].year, windows.current.months[0].month),
    ]);
    const missing = findMissing2bMonths(['G1', 'G2'], windows, present);
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.some((row) => row.gstin === 'G2')).toBe(true);
    expect(missing.some((row) => row.gstin === 'G1')).toBe(true);
  });

  it('keeps shares null when the period total is missing', () => {
    expect(dependencyShare(10, null)).toBeNull();
    expect(dependencyShare(10, 0)).toBeNull();
    expect(dependencyChangePp(null, 10)).toBeNull();
  });
});
