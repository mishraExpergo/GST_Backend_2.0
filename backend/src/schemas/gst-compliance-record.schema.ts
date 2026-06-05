import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type GstComplianceRecordDocument = HydratedDocument<GstComplianceRecord>;

@Schema({ timestamps: true, collection: 'gst_compliance_records' })
export class GstComplianceRecord {
  @Prop({ required: true, index: true })
  loanId: string;

  @Prop()
  gstNo?: string;

  @Prop()
  panNo?: string;

  @Prop({ type: Object })
  verifyResponse?: Record<string, unknown>;

  @Prop({ type: Object })
  searchResponse?: Record<string, unknown>;

  @Prop()
  verificationStatus?: string;

  @Prop()
  validGstin?: boolean;

  @Prop()
  skipped?: boolean;

  @Prop()
  skipReason?: string;

  @Prop()
  errorMessage?: string;
}

export const GstComplianceRecordSchema =
  SchemaFactory.createForClass(GstComplianceRecord);

GstComplianceRecordSchema.index({ loanId: 1, gstNo: 1 }, { unique: true });
