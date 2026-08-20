import {
  BadRequestException,
  Injectable,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  GstNoticeRecord,
  GstNoticeRecordType,
} from '../schemas/gst-notice.schema';

export interface NoticeTrackingContext {
  associatedLoanId: string;
  customerId: string;
  gstin: string;
  username?: string | null;
  dataSource?: string | null;
}

@Injectable()
export class GstNoticePersistenceService {
  constructor(
    @Optional()
    @InjectModel(GstNoticeRecord.name)
    private readonly noticeModel?: Model<GstNoticeRecord>,
  ) {}

  assertMongoEnabled(): void {
    if (!this.noticeModel) {
      throw new BadRequestException(
        'MongoDB is not enabled. Set ENABLE_MONGO=true to store GST notice data.',
      );
    }
  }

  validateTrackingContext(tracking: {
    associatedLoanId?: string | null;
    customerId?: string | null;
  }): { associatedLoanId: string; customerId: string } {
    const associatedLoanId = String(tracking.associatedLoanId ?? '').trim();
    const customerId = String(tracking.customerId ?? '').trim();

    if (!associatedLoanId) {
      throw new BadRequestException(
        '"associatedLoanId" is required to store/read notice data in MongoDB.',
      );
    }
    if (!customerId) {
      throw new BadRequestException(
        '"customerId" is required to store/read notice data in MongoDB.',
      );
    }

    return { associatedLoanId, customerId };
  }

  async findList(
    associatedLoanId: string,
    customerId: string,
    gstin: string,
    noticeDate: string,
  ): Promise<GstNoticeRecord | null> {
    this.assertMongoEnabled();
    return this.noticeModel!
      .findOne({
        recordType: 'LIST',
        associatedLoanId: associatedLoanId.trim(),
        customerId: customerId.trim(),
        gstin: gstin.trim().toUpperCase(),
        noticeDate: noticeDate.trim(),
      })
      .lean()
      .exec();
  }

  async findDetail(
    associatedLoanId: string,
    gstin: string,
    referenceId: string,
  ): Promise<GstNoticeRecord | null> {
    this.assertMongoEnabled();
    return this.noticeModel!
      .findOne({
        recordType: 'DETAIL',
        associatedLoanId: associatedLoanId.trim(),
        gstin: gstin.trim().toUpperCase(),
        referenceId: referenceId.trim(),
      })
      .lean()
      .exec();
  }

  async upsertList(
    context: NoticeTrackingContext,
    noticeDate: string,
    response: Record<string, any>,
  ): Promise<GstNoticeRecord> {
    this.assertMongoEnabled();
    const gstin = context.gstin.trim().toUpperCase();
    const payload = {
      recordType: 'LIST' as GstNoticeRecordType,
      associatedLoanId: context.associatedLoanId.trim(),
      customerId: context.customerId.trim(),
      gstin,
      username: String(context.username ?? '').trim(),
      noticeDate: noticeDate.trim(),
      dataSource: String(context.dataSource ?? 'sandbox').trim() || 'sandbox',
      response,
      systemMetadata: {
        fetchedAt: new Date().toISOString(),
        fetchMode: 'taxpayer-notices-list',
        dataSource: String(context.dataSource ?? 'sandbox').trim() || 'sandbox',
      },
    };

    await this.noticeModel!.updateOne(
      {
        recordType: 'LIST',
        associatedLoanId: payload.associatedLoanId,
        customerId: payload.customerId,
        gstin: payload.gstin,
        noticeDate: payload.noticeDate,
      },
      { $set: payload },
      { upsert: true },
    );

    const stored = await this.findList(
      payload.associatedLoanId,
      payload.customerId,
      payload.gstin,
      payload.noticeDate,
    );
    if (!stored) {
      throw new BadRequestException('Failed to persist notice list response.');
    }
    return stored;
  }

  async upsertDetail(
    context: NoticeTrackingContext,
    referenceId: string,
    response: Record<string, any>,
  ): Promise<GstNoticeRecord> {
    this.assertMongoEnabled();
    const gstin = context.gstin.trim().toUpperCase();
    const payload = {
      recordType: 'DETAIL' as GstNoticeRecordType,
      associatedLoanId: context.associatedLoanId.trim(),
      customerId: context.customerId.trim(),
      gstin,
      username: String(context.username ?? '').trim(),
      referenceId: referenceId.trim(),
      dataSource: String(context.dataSource ?? 'sandbox').trim() || 'sandbox',
      response,
      systemMetadata: {
        fetchedAt: new Date().toISOString(),
        fetchMode: 'taxpayer-notices-detail',
        dataSource: String(context.dataSource ?? 'sandbox').trim() || 'sandbox',
      },
    };

    await this.noticeModel!.updateOne(
      {
        recordType: 'DETAIL',
        associatedLoanId: payload.associatedLoanId,
        gstin: payload.gstin,
        referenceId: payload.referenceId,
      },
      { $set: payload },
      { upsert: true },
    );

    const stored = await this.findDetail(
      payload.associatedLoanId,
      payload.gstin,
      payload.referenceId,
    );
    if (!stored) {
      throw new BadRequestException('Failed to persist notice detail response.');
    }
    return stored;
  }

  async getStoredLists(params: {
    associatedLoanId: string;
    customerId: string;
    gstin: string;
    noticeDate?: string;
  }): Promise<GstNoticeRecord[]> {
    this.assertMongoEnabled();
    const filter: Record<string, any> = {
      recordType: 'LIST',
      associatedLoanId: params.associatedLoanId.trim(),
      customerId: params.customerId.trim(),
      gstin: params.gstin.trim().toUpperCase(),
    };
    const noticeDate = String(params.noticeDate ?? '').trim();
    if (noticeDate) {
      filter.noticeDate = noticeDate;
    }

    return this.noticeModel!.find(filter).sort({ noticeDate: -1 }).lean().exec();
  }

  async getStoredDetail(params: {
    associatedLoanId: string;
    gstin: string;
    referenceId: string;
  }): Promise<GstNoticeRecord | null> {
    return this.findDetail(
      params.associatedLoanId,
      params.gstin,
      params.referenceId,
    );
  }
}
