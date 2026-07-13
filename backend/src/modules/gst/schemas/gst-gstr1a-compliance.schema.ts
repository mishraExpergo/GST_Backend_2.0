import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type Gstr1aComplianceDocument = HydratedDocument<Gstr1aComplianceRecord>;

/**
 * Stores GSTR-1A payloads fetched for taxpayer flows.
 */
@Schema({ collection: 'gst_gstr1a_compliance_data', timestamps: true })
export class Gstr1aComplianceRecord {
  @Prop({ index: true })
  loanId: string;

  @Prop({ index: true })
  customerId: string;

  @Prop({ index: true })
  gstin: string;

  @Prop({ index: true })
  gstNo: string;

  @Prop({ index: true })
  pan: string;

  @Prop({ index: true })
  year: number;

  @Prop({ index: true })
  month: number;

  @Prop()
  sourceTable: string;

  @Prop()
  status: string;

  @Prop({ type: Object })
  gstr1aResponse: Record<string, any>;

  @Prop({ type: Object })
  systemMetadata: Record<string, any>;
}

export const Gstr1aComplianceSchema =
  SchemaFactory.createForClass(Gstr1aComplianceRecord);

Gstr1aComplianceSchema.index(
  { loanId: 1, gstin: 1, year: 1, month: 1 },
  { unique: true },
);

Gstr1aComplianceSchema.index({ customerId: 1, loanId: 1 });
Gstr1aComplianceSchema.index({ pan: 1, customerId: 1 });
