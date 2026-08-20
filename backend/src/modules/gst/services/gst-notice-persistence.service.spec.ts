import { BadRequestException } from '@nestjs/common';
import { GstNoticePersistenceService } from './gst-notice-persistence.service';

describe('GstNoticePersistenceService', () => {
  function buildService(modelOverrides: Record<string, any> = {}) {
    const leanExec = jest.fn();
    const lean = jest.fn(() => ({ exec: leanExec }));
    const findOne = jest.fn(() => ({ lean }));
    const find = jest.fn(() => ({
      sort: jest.fn(() => ({ lean })),
    }));
    const updateOne = jest.fn().mockResolvedValue({ acknowledged: true });

    const model = {
      findOne,
      find,
      updateOne,
      ...modelOverrides,
    };

    const service = new GstNoticePersistenceService(model as any);
    return { service, model, leanExec, findOne, find, updateOne };
  }

  it('requires associatedLoanId and customerId for tracking context', () => {
    const { service } = buildService();
    expect(() => service.validateTrackingContext({})).toThrow(
      BadRequestException,
    );
    expect(
      service.validateTrackingContext({
        associatedLoanId: 'LN1',
        customerId: 'C1',
      }),
    ).toEqual({ associatedLoanId: 'LN1', customerId: 'C1' });
  });

  it('upserts list records and reloads cached document', async () => {
    const { service, updateOne, leanExec } = buildService();
    leanExec.mockResolvedValue({
      recordType: 'LIST',
      associatedLoanId: 'LN1',
      customerId: 'C1',
      gstin: '09AAACP0252G2ZQ',
      noticeDate: '04/08/2026',
      response: { ok: true },
    });

    const stored = await service.upsertList(
      {
        associatedLoanId: 'LN1',
        customerId: 'C1',
        gstin: '09aaacp0252g2zq',
        username: 'user1',
        dataSource: 'sandbox',
      },
      '04/08/2026',
      { ok: true },
    );

    expect(updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        recordType: 'LIST',
        associatedLoanId: 'LN1',
        customerId: 'C1',
        gstin: '09AAACP0252G2ZQ',
        noticeDate: '04/08/2026',
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          response: { ok: true },
          recordType: 'LIST',
        }),
      }),
      { upsert: true },
    );
    expect(stored.response).toEqual({ ok: true });
  });

  it('upserts detail records by associatedLoanId + gstin + referenceId', async () => {
    const { service, updateOne, leanExec } = buildService();
    leanExec.mockResolvedValue({
      recordType: 'DETAIL',
      associatedLoanId: 'LN1',
      gstin: '09AAACP0252G2ZQ',
      referenceId: 'REF123',
      response: { detail: true },
    });

    await service.upsertDetail(
      {
        associatedLoanId: 'LN1',
        customerId: 'C1',
        gstin: '09AAACP0252G2ZQ',
      },
      'REF123',
      { detail: true },
    );

    expect(updateOne).toHaveBeenCalledWith(
      {
        recordType: 'DETAIL',
        associatedLoanId: 'LN1',
        gstin: '09AAACP0252G2ZQ',
        referenceId: 'REF123',
      },
      expect.any(Object),
      { upsert: true },
    );
  });

  it('filters stored lists by optional noticeDate', async () => {
    const { service, find, leanExec } = buildService();
    leanExec.mockResolvedValue([]);

    await service.getStoredLists({
      associatedLoanId: 'LN1',
      customerId: 'C1',
      gstin: '09AAACP0252G2ZQ',
      noticeDate: '04/08/2026',
    });

    expect(find).toHaveBeenCalledWith({
      recordType: 'LIST',
      associatedLoanId: 'LN1',
      customerId: 'C1',
      gstin: '09AAACP0252G2ZQ',
      noticeDate: '04/08/2026',
    });
  });
});
