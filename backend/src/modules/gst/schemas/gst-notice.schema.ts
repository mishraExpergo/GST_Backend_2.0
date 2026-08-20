import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type GstNoticeDocument = HydratedDocument<GstNoticeRecord>;

export type GstNoticeRecordType = 'LIST' | 'DETAIL';

/**
 * Stores Sandbox taxpayer notice list/detail payloads (cache-first).
 */
@Schema({ collection: 'gst_notice_data', timestamps: true })
export class GstNoticeRecord {
  @Prop({ required: true, enum: ['LIST', 'DETAIL'], index: true })
  recordType: GstNoticeRecordType;

  @Prop({ required: true, index: true })
  associatedLoanId: string;

  @Prop({ required: true, index: true })
  customerId: string;

  @Prop({ required: true, index: true })
  gstin: string;

  @Prop()
  username: string;

  /** Notice list query date in DD/MM/YYYY (LIST records only). */
  @Prop({ index: true })
  noticeDate?: string;

  /** Notice reference id (DETAIL records only). */
  @Prop({ index: true })
  referenceId?: string;

  @Prop({ default: 'sandbox' })
  dataSource: string;

  @Prop({ type: Object })
  response: Record<string, any>;

  @Prop({ type: Object })
  systemMetadata: Record<string, any>;
}

export const GstNoticeSchema = SchemaFactory.createForClass(GstNoticeRecord);

GstNoticeSchema.index(
  { associatedLoanId: 1, customerId: 1, gstin: 1, noticeDate: 1 },
  {
    unique: true,
    partialFilterExpression: { recordType: 'LIST' },
  },
);

GstNoticeSchema.index(
  { associatedLoanId: 1, gstin: 1, referenceId: 1 },
  {
    unique: true,
    partialFilterExpression: { recordType: 'DETAIL' },
  },
);

GstNoticeSchema.index({ customerId: 1, associatedLoanId: 1 });
GstNoticeSchema.index({ gstin: 1, recordType: 1 });
