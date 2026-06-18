import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type Gstr3bComplianceDocument = HydratedDocument<Gstr3bComplianceRecord>;

/**
 * Stores the result of the GSTIN verify + GSTR-3B retsum flow for a single
 * loan/customer and return period. Full external API responses are kept for
 * auditing/debugging.
 */
@Schema({ collection: 'gst_3b_compliance_data', timestamps: true })
export class Gstr3bComplianceRecord {
  @Prop({ index: true })
  loanId: string;

  @Prop({ index: true })
  gstin: string;

  @Prop()
  pan: string;

  @Prop()
  legalName: string;

  @Prop()
  status: string;

  /** Return period in MMYYYY format (e.g. 112022 for Nov 2022). */
  @Prop({ index: true })
  retperiod: string;

  @Prop()
  sourceTable: string;

  @Prop({ type: Object })
  verifyResponse: Record<string, any>;

  @Prop({ type: Object })
  retsumResponse: Record<string, any>;
}

export const Gstr3bComplianceSchema =
  SchemaFactory.createForClass(Gstr3bComplianceRecord);

Gstr3bComplianceSchema.index(
  { loanId: 1, gstin: 1, retperiod: 1 },
  { unique: true },
);
