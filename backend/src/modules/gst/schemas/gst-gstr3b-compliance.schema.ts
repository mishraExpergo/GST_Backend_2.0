import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type Gstr3bComplianceDocument = HydratedDocument<Gstr3bComplianceRecord>;

/**
 * Stores GSTR-3B payloads used for PAN-level aggregation.
 */
@Schema({ collection: 'gst_3b_compliance_data', timestamps: true })
export class Gstr3bComplianceRecord {
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
  year: number;

  @Prop({ index: true })
  month: number;

  /** GST return period `MMYYYY` (kept for legacy unique index loanId+gstin+retperiod). */
  @Prop({ index: true })
  retperiod: string;

  @Prop()
  sourceTable: string;

  @Prop()
  legalName: string;

  @Prop()
  status: string;

  @Prop({ type: Object })
  verifyResponse: Record<string, any>;

  @Prop({ type: Object })
  gstr3bResponse: Record<string, any>;

  @Prop({ type: Object })
  analysis: Record<string, any>;

  @Prop({ type: Object })
  systemMetadata: Record<string, any>;
}

export const Gstr3bComplianceSchema =
  SchemaFactory.createForClass(Gstr3bComplianceRecord);

Gstr3bComplianceSchema.index(
  { loanId: 1, gstin: 1, year: 1, month: 1 },
  { unique: true },
);

Gstr3bComplianceSchema.index({ pan: 1, customerId: 1 });
Gstr3bComplianceSchema.index({ customerId: 1, loanId: 1 });
