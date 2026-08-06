import {
  buildLoanPanSearchResult,
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
      },
    ]);
  });

  it('builds primary vs coapplicant listed/unlisted blocks', () => {
    const result = buildLoanPanSearchResult(
      {
        loanId: 'LN000001',
        customerId: 'CUST0001',
        primaryPan: 'AAACN0255D',
        primaryGstins: ['27AAACN0255D1ZM'],
        coapplicantEntities: [
          {
            pan: 'AABCT1234A',
            gstins: ['29AABCT1234A1Z5'],
          },
        ],
      },
      {
        pan: 'AAACN0255D',
        mode: 'single-state',
        stateCode: '27',
        data: {
          data: [
            {
              data: {
                gstin: '27AAACN0255D1ZM',
                lgnm: 'NTPC Limited',
                tradeNam: null,
              },
            },
            {
              data: {
                gstin: '27AAACN0255D2ZN',
                lgnm: 'NTPC Limited',
                tradeNam: null,
              },
            },
          ],
        },
      },
      new Map([
        [
          'AABCT1234A',
          {
            pan: 'AABCT1234A',
            mode: 'single-state',
            stateCode: '29',
            data: {
              data: [
                {
                  data: {
                    gstin: '29AABCT1234A1Z5',
                    lgnm: 'Coapplicant Co',
                    tradeNam: null,
                  },
                },
                {
                  data: {
                    gstin: '29AABCT1234A2Z6',
                    lgnm: 'Coapplicant Co',
                    tradeNam: null,
                  },
                },
              ],
            },
          },
        ],
      ]),
    );

    expect(result).toEqual({
      loanId: 'LN000001',
      customerId: 'CUST0001',
      primary: {
        pan: 'AAACN0255D',
        companyName: 'NTPC Limited',
        listedGstins: ['27AAACN0255D1ZM'],
        unlistedGstins: ['27AAACN0255D2ZN'],
      },
      coapplicantEntities: [
        {
          pan: 'AABCT1234A',
          companyName: 'Coapplicant Co',
          listedGstins: ['29AABCT1234A1Z5'],
          unlistedGstins: ['29AABCT1234A2Z6'],
        },
      ],
    });
  });
});
