import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type Gstr1ReturnsComplianceDocument =
  HydratedDocument<Gstr1ReturnsComplianceRecord>;

/**
 * Stores public Sandbox GSTR track / return-filing data used by
 * verify-and-fetch/gstr-track aggregation.
 */
@Schema({ collection: 'gst_gstR1_returns_compliance_data', timestamps: true })
export class Gstr1ReturnsComplianceRecord {
  @Prop({ index: true })
  loanId: string;

  @Prop({ index: true })
  customerId: string;

  @Prop()
  entityType: string;

  @Prop({ index: true })
  gstin: string;

  @Prop({ index: true })
  gstNo: string;

  @Prop({ index: true })
  pan: string;

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
  gstrResponse: Record<string, any>;

  @Prop({ type: Object })
  systemMetadata: Record<string, any>;
}

export const Gstr1ReturnsComplianceSchema = SchemaFactory.createForClass(
  Gstr1ReturnsComplianceRecord,
);

Gstr1ReturnsComplianceSchema.index({ loanId: 1, gstin: 1 }, { unique: true });
Gstr1ReturnsComplianceSchema.index({ pan: 1, customerId: 1 });
Gstr1ReturnsComplianceSchema.index({ customerId: 1, loanId: 1 });
