import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type GstrComplianceDocument = HydratedDocument<GstrComplianceRecord>;

/**
 * Stores the result of the GSTIN verify + GSTR-track flow for a single
 * loan/customer and financial year. The full external API responses are kept
 * for auditing/debugging.
 */
@Schema({ collection: 'gst_gstr_compliance_data', timestamps: true })
export class GstrComplianceRecord {
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

  @Prop({ index: true })
  financialYear: string;

  @Prop()
  sourceTable: string;

  @Prop({ type: Object })
  verifyResponse: Record<string, any>;

  @Prop({ type: Object })
  gstrResponse: Record<string, any>;
}

export const GstrComplianceSchema =
  SchemaFactory.createForClass(GstrComplianceRecord);

// Backs the idempotent upsert (one record per loan + GSTIN + financial year).
GstrComplianceSchema.index(
  { loanId: 1, gstin: 1, financialYear: 1 },
  { unique: true },
);
