import {
  comparePanSearchWithPrimaryGstins,
  extractGstinsFromSandboxPayload,
} from './gst-pan-search.util';

describe('gst-pan-search.util', () => {
  it('extracts GSTINs from Sandbox array payload', () => {
    const records = extractGstinsFromSandboxPayload({
      data: [
        {
          gstin: '27AAACN0255D1ZM',
          data: {
            gstin: '27AAACN0255D1ZM',
            lgnm: 'ACME',
            tradeNam: 'Acme Trade',
            sts: 'Active',
            dty: 'Regular',
          },
        },
      ],
    });

    expect(records).toEqual([
      {
        gstin: '27AAACN0255D1ZM',
        stateCode: '27',
        legalName: 'ACME',
        tradeName: 'Acme Trade',
        status: 'Active',
        taxpayerType: 'Regular',
      },
    ]);
  });

  it('tags listed vs unlisted and reports missingFromSandbox', () => {
    const result = comparePanSearchWithPrimaryGstins(
      {
        pan: 'aaacn0255d',
        mode: 'single-state',
        stateCode: '27',
        data: {
          data: [
            {
              data: {
                gstin: '27AAACN0255D1ZM',
                lgnm: 'Listed Co',
                tradeNam: null,
                sts: 'Active',
                dty: 'Regular',
              },
            },
            {
              data: {
                gstin: '27AAACN0255D2ZN',
                lgnm: 'Unlisted Co',
                tradeNam: null,
                sts: 'Active',
                dty: 'Regular',
              },
            },
          ],
        },
      },
      ['27AAACN0255D1ZM', '29AAACN0255D1ZA'],
    );

    expect(result.summary).toEqual({
      primaryGstinCount: 2,
      sandboxGstinCount: 2,
      listedCount: 1,
      unlistedCount: 1,
      missingFromSandboxCount: 1,
    });
    expect(result.unlistedGstins.map((g) => g.gstin)).toEqual([
      '27AAACN0255D2ZN',
    ]);
    expect(result.missingFromSandbox).toEqual(['29AAACN0255D1ZA']);
    expect(result.byState[0].gstins[0].listingStatus).toBe('listed');
    expect(result.byState[0].gstins[1].listingStatus).toBe('unlisted');
  });
});
