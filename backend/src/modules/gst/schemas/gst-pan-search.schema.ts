import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type GstPanSearchDocument = HydratedDocument<GstPanSearchRecord>;

/**
 * Loan/customer snapshot: primary PAN GSTs + coapplicant-entity PAN GSTs,
 * each split into listed / unlisted vs gst_uploaded_file_data.
 */
@Schema({ collection: 'gst_pan_search_data', timestamps: true })
export class GstPanSearchRecord {
  @Prop({ required: true, index: true })
  loanId: string;

  @Prop({ required: true, index: true })
  customerId: string;

  /** Primary company PAN (denormalized for GET-by-pan). */
  @Prop({ index: true })
  pan: string;

  /** `all` for fan-out; otherwise the padded state code e.g. `37`. */
  @Prop({ required: true, index: true })
  searchKey: string;

  @Prop({ type: Object })
  primary: Record<string, any> | null;

  @Prop({ type: [Object], default: [] })
  coapplicantEntities: Record<string, any>[];

  /** Full minimal payload for audit / re-read. */
  @Prop({ type: Object })
  payload: Record<string, any>;
}

export const GstPanSearchSchema =
  SchemaFactory.createForClass(GstPanSearchRecord);

GstPanSearchSchema.index(
  { loanId: 1, customerId: 1, searchKey: 1 },
  { unique: true },
);
