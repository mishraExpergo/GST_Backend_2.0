import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type GstComplianceDocument = HydratedDocument<GstComplianceRecord>;

/**
 * Stores the result of the GSTIN verify + search flow for a single loan/customer.
 * The full external API responses are kept for auditing/debugging.
 */
@Schema({ collection: 'gst_compliance_data', timestamps: true })
export class GstComplianceRecord {
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

  @Prop()
  sourceTable: string;

  @Prop({ type: Object })
  verifyResponse: Record<string, any>;

  @Prop({ type: Object })
  searchResponse: Record<string, any>;
}

export const GstComplianceSchema =
  SchemaFactory.createForClass(GstComplianceRecord);

// Backs the idempotent upsert (one record per loan + GSTIN).
GstComplianceSchema.index({ loanId: 1, gstin: 1 }, { unique: true });
