import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type Gstr2bComplianceDocument = HydratedDocument<Gstr2bComplianceRecord>;

/**
 * Stores the result of the GSTIN verify + GSTR-2B reconciliation flow for a
 * single loan/customer and a given year/month. The full external API
 * responses are kept for auditing/debugging.
 */
@Schema({ collection: 'gst_2b_compliance_data', timestamps: true })
export class Gstr2bComplianceRecord {
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
  year: number;

  @Prop({ index: true })
  month: number;

  @Prop()
  filingPreference: string;

  @Prop()
  reconciliationCriteria: string;

  @Prop()
  sourceTable: string;

  @Prop({ type: Object })
  verifyResponse: Record<string, any>;

  @Prop({ type: Object })
  reconciliationResponse: Record<string, any>;
}

export const Gstr2bComplianceSchema =
  SchemaFactory.createForClass(Gstr2bComplianceRecord);

// Backs the idempotent upsert (one record per loan + GSTIN + year + month).
Gstr2bComplianceSchema.index(
  { loanId: 1, gstin: 1, year: 1, month: 1 },
  { unique: true },
);
