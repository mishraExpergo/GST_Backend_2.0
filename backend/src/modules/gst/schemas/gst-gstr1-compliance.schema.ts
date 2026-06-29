import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type Gstr1ComplianceDocument = HydratedDocument<Gstr1ComplianceRecord>;

/**
 * Stores GSTR-1 return filing data (normalized or raw API payload).
 * Collection name matches the manually seeded Mongo collection.
 */
@Schema({ collection: 'gst_gstR1_complaince_data', timestamps: true })
export class Gstr1ComplianceRecord {
  @Prop({ index: true })
  loanId: string;

  @Prop({ index: true })
  customerId: string;

  @Prop()
  entityType: string;

  @Prop({ index: true })
  gstin: string;

  /** Legacy field kept in sync with `gstin` for older Mongo indexes. */
  @Prop({ index: true })
  gstNo: string;

  @Prop({ index: true })
  pan: string;

  @Prop({ index: true })
  financialYear: string;

  @Prop()
  sourceTable: string;

  @Prop()
  legalName: string;

  @Prop()
  status: string;

  @Prop()
  returnType: string;

  @Prop({ type: [Object] })
  returns: Array<Record<string, any>>;

  @Prop({ type: Object })
  verifyResponse: Record<string, any>;

  @Prop({ type: Object })
  gstrResponse: Record<string, any>;

  @Prop({ type: Object })
  analysis: Record<string, any>;

  @Prop({ type: Object })
  systemMetadata: Record<string, any>;
}

export const Gstr1ComplianceSchema =
  SchemaFactory.createForClass(Gstr1ComplianceRecord);

Gstr1ComplianceSchema.index(
  { loanId: 1, gstin: 1, financialYear: 1 },
  { unique: true },
);

Gstr1ComplianceSchema.index({ pan: 1, customerId: 1 });
Gstr1ComplianceSchema.index({ customerId: 1, loanId: 1 });
