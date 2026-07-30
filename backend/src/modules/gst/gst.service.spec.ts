import { GstService } from './gst.service';

describe('GstService.getCustomerGstrStatusCounts', () => {
  it('uses uploaded customer-loan-GSTIN units and matches their latest API-log status', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce([{ column_name: 'updated_at' }])
      .mockResolvedValueOnce([
        { customer_id: 'C1', loan_id: 'L1', gst_number: 'GST1' },
        { customer_id: 'C1', loan_id: 'L2', gst_number: 'GST1' },
        { customer_id: 'C2', loan_id: 'L3', gst_number: 'GST2' },
      ])
      .mockResolvedValueOnce([
        {
          customer_id: 'C1',
          loan_id: 'L1',
          gst_number: 'GST1',
          gstr_type: 'GSTR-1',
          status: 'SUCCESS',
        },
        {
          customer_id: 'C1',
          loan_id: 'L2',
          gst_number: 'GST1',
          gstr_type: 'GSTR-1',
          status: 'FAILED',
        },
        {
          customer_id: 'C1',
          loan_id: 'L1',
          gst_number: 'GST1',
          gstr_type: 'GSTR-2B',
          status: 'PROCESSING',
        },
        {
          customer_id: 'C2',
          loan_id: 'L3',
          gst_number: 'GST2',
          gstr_type: 'GSTR-3B',
          status: 'SUCCESS',
        },
        {
          customer_id: 'C2',
          loan_id: 'L3',
          gst_number: 'GST2',
          gstr_type: 'GSTREG-1',
          status: 'SUCCESS',
        },
      ]);
    const service = new GstService(
      { query } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(service.getCustomerGstrStatusCounts()).resolves.toEqual({
      C1: {
        GSTREG1: { updated: 0, pending: 2, failed: 0 },
        GSTR1: { updated: 1, pending: 0, failed: 1 },
        GSTR2B: { updated: 0, pending: 2, failed: 0 },
        GSTR3B: { updated: 0, pending: 2, failed: 0 },
      },
      C2: {
        GSTREG1: { updated: 1, pending: 0, failed: 0 },
        GSTR1: { updated: 0, pending: 1, failed: 0 },
        GSTR2B: { updated: 0, pending: 1, failed: 0 },
        GSTR3B: { updated: 1, pending: 0, failed: 0 },
      },
    });

    expect(query.mock.calls[2][0]).toContain('primary_gst_no');
    expect(query.mock.calls[2][0]).toContain('considered_entity_gst_no');
    expect(query.mock.calls[3][0]).toContain('TRIM(associated_loan_id)');
  });

  it('returns empty object when gst_uploaded_file_data is missing', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ exists: false }]);
    const service = new GstService(
      { query } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(service.getCustomerGstrStatusCounts()).resolves.toEqual({});
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('loads loan and GSTIN API-log caches with one batch query', async () => {
    const rows = [
      {
        id: '1',
        associated_loan_id: 'L1',
        gst_number: 'GST1',
        updated_at: '2026-07-17T06:00:00.000Z',
      },
      {
        id: '2',
        associated_loan_id: 'L2',
        gst_number: 'GST2',
        updated_at: '2026-07-17T05:00:00.000Z',
      },
    ];
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ column_name: 'updated_at' }])
      .mockResolvedValueOnce(rows);
    const service = new GstService(
      { query } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.getApiRequestLogsBatch([{ loanId: 'L1' }, { gstin: 'gst2' }]),
    ).resolves.toEqual({
      items: [
        {
          params: { loanId: 'L1', gstin: undefined },
          response: {
            loanId: 'L1',
            gstin: null,
            count: 1,
            lastUpdatedAt: '2026-07-17T06:00:00.000Z',
            data: [rows[0]],
          },
        },
        {
          params: { loanId: undefined, gstin: 'GST2' },
          response: {
            loanId: null,
            gstin: 'GST2',
            count: 1,
            lastUpdatedAt: '2026-07-17T05:00:00.000Z',
            data: [rows[1]],
          },
        },
      ],
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][0]).toContain('ANY($1::text[])');
    expect(query.mock.calls[1][0]).toContain('ANY($2::text[])');
  });
});
