import { GstService } from './gst.service';

describe('GstService.getCustomerGstrStatusCounts', () => {
  it('uses uploaded customer-loan-GSTIN units and matches their latest API-log status', async () => {
    const query = jest
      .fn()
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

    expect(query.mock.calls[1][0]).toContain('primary_gst_no');
    expect(query.mock.calls[1][0]).toContain('considered_entity_gst_no');
    expect(query.mock.calls[2][0]).toContain('TRIM(associated_loan_id)');
  });
});
