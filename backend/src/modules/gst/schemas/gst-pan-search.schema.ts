import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type GstPanSearchDocument = HydratedDocument<GstPanSearchRecord>;

/**
 * Snapshot of Sandbox PAN search vs primary GSTINs in gst_uploaded_file_data.
 * One document per PAN + search scope (all states, or a single state_code).
 */
@Schema({ collection: 'gst_pan_search_data', timestamps: true })
export class GstPanSearchRecord {
  @Prop({ required: true, index: true })
  pan: string;

  /** `all` for fan-out; otherwise the padded state code e.g. `37`. */
  @Prop({ required: true, index: true })
  searchKey: string;

  @Prop()
  mode: string;

  @Prop({ type: Object })
  summary: Record<string, number>;

  @Prop({ type: [String], default: [] })
  primaryGstins: string[];

  @Prop({ type: [Object], default: [] })
  byState: Record<string, any>[];

  @Prop({ type: [Object], default: [] })
  unlistedGstins: Record<string, any>[];

  @Prop({ type: [String], default: [] })
  missingFromSandbox: string[];

  @Prop({ type: [Object], default: [] })
  failedStates: Record<string, any>[];

  @Prop({ type: [String], default: [] })
  skippedStateCodes: string[];

  /** Full compare payload for audit / re-read. */
  @Prop({ type: Object })
  payload: Record<string, any>;
}

export const GstPanSearchSchema =
  SchemaFactory.createForClass(GstPanSearchRecord);

GstPanSearchSchema.index({ pan: 1, searchKey: 1 }, { unique: true });
