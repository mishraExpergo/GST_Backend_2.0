import { GstTaxpayerReturnsService } from './gst-taxpayer-returns.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
  },
}));

import axios from 'axios';

describe('GstTaxpayerReturnsService notices cache-first', () => {
  const axiosGet = axios.get as jest.Mock;

  function buildService(overrides: {
    findList?: jest.Mock;
    findDetail?: jest.Mock;
    upsertList?: jest.Mock;
    upsertDetail?: jest.Mock;
  } = {}) {
    const noticePersistence = {
      assertMongoEnabled: jest.fn(),
      validateTrackingContext: jest.fn(
        ({ associatedLoanId, customerId }: any) => ({
          associatedLoanId,
          customerId,
        }),
      ),
      findList:
        overrides.findList ?? jest.fn().mockResolvedValue(null),
      findDetail:
        overrides.findDetail ?? jest.fn().mockResolvedValue(null),
      upsertList:
        overrides.upsertList ?? jest.fn().mockResolvedValue({}),
      upsertDetail:
        overrides.upsertDetail ?? jest.fn().mockResolvedValue({}),
      getStoredLists: jest.fn(),
      getStoredDetail: jest.fn(),
    };

    const config = {
      get: jest.fn((key: string, fallback?: string) => {
        if (key === 'GST_API_MAX_RETRIES') return '0';
        if (key === 'GST_API_RETRY_BASE_MS') return '1';
        if (key === 'GST_TAXPAYER_REFRESH_ON_EVERY_REQUEST') return 'false';
        if (key === 'GST_API_BASE_URL') return 'https://api.sandbox.co.in';
        if (key === 'GST_API_KEY_LIVE') return 'live-key';
        if (key === 'GST_API_SECRET_LIVE') return 'live-secret';
        if (key === 'GST_API_VERSION') return '1.0.0';
        return fallback;
      }),
      getOrThrow: jest.fn((key: string) => {
        if (key === 'GST_API_BASE_URL') return 'https://api.sandbox.co.in';
        throw new Error(`missing ${key}`);
      }),
    };

    const taxpayerAuth = {
      getAccessTokenForTaxpayer: jest.fn().mockResolvedValue('token'),
      refreshAccessToken: jest.fn(),
    };

    const apiRequestLog = {
      createProcessingLog: jest.fn().mockResolvedValue({ id: 'log-1' }),
      incrementRetry: jest.fn(),
      markFailure: jest.fn(),
      markSuccess: jest.fn(),
    };

    const service = new GstTaxpayerReturnsService(
      config as any,
      taxpayerAuth as any,
      apiRequestLog as any,
      {} as any,
      noticePersistence as any,
    );

    return { service, noticePersistence, apiRequestLog, taxpayerAuth };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GST_API_KEY_LIVE = 'key';
    process.env.GST_API_SECRET_LIVE = 'secret';
    process.env.GST_API_VERSION = '1.0.0';
  });

  it('returns cached list without calling Sandbox', async () => {
    const findList = jest.fn().mockResolvedValue({
      response: { notices: [{ id: 1 }] },
    });
    const { service, apiRequestLog, taxpayerAuth } = buildService({ findList });

    const result = await service.fetchNotices(
      { username: 'user1', gstin: '09AAACP0252G2ZQ' },
      '04/08/2026',
      {
        associatedLoanId: 'LN1',
        customerId: 'C1',
        requireTracking: true,
      },
    );

    expect(result.source).toBe('cache');
    expect(result.data).toEqual({ notices: [{ id: 1 }] });
    expect(axiosGet).not.toHaveBeenCalled();
    expect(apiRequestLog.createProcessingLog).not.toHaveBeenCalled();
    expect(taxpayerAuth.getAccessTokenForTaxpayer).not.toHaveBeenCalled();
  });

  it('fetches from Sandbox on cache miss and persists response', async () => {
    const upsertList = jest.fn().mockResolvedValue({});
    const { service, apiRequestLog } = buildService({ upsertList });
    axiosGet.mockResolvedValue({
      status: 200,
      data: { notices: [{ id: 2 }] },
    });

    const result = await service.fetchNotices(
      { username: 'user1', gstin: '09AAACP0252G2ZQ' },
      '04/08/2026',
      {
        associatedLoanId: 'LN1',
        customerId: 'C1',
        requireTracking: true,
      },
    );

    expect(result.source).toBe('sandbox');
    expect(result.data).toEqual({ notices: [{ id: 2 }] });
    expect(axiosGet).toHaveBeenCalled();
    expect(apiRequestLog.createProcessingLog).toHaveBeenCalled();
    expect(upsertList).toHaveBeenCalledWith(
      expect.objectContaining({
        associatedLoanId: 'LN1',
        customerId: 'C1',
        gstin: '09AAACP0252G2ZQ',
      }),
      '04/08/2026',
      { notices: [{ id: 2 }] },
    );
  });

  it('returns cached detail without calling Sandbox', async () => {
    const findDetail = jest.fn().mockResolvedValue({
      response: { referenceId: 'REF1', body: 'x' },
    });
    const { service } = buildService({ findDetail });

    const result = await service.fetchNoticeByReferenceId(
      { username: 'user1', gstin: '09AAACP0252G2ZQ' },
      'REF1',
      {
        associatedLoanId: 'LN1',
        customerId: 'C1',
        requireTracking: true,
      },
    );

    expect(result.source).toBe('cache');
    expect(result.referenceId).toBe('REF1');
    expect(axiosGet).not.toHaveBeenCalled();
  });
});
