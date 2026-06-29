import { Injectable, Logger, Optional } from '@nestjs/common';

import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';

import { DataSource, Repository } from 'typeorm';

import { InjectModel } from '@nestjs/mongoose';

import { Model } from 'mongoose';

import { GstService } from '../gst.service';

import { GstComplianceRecord } from '../schemas/gst-compliance.schema';

import { PrimaryGstAggregation } from '../../../entities/primary-gst-aggregation.entity';

import { SecondaryGstAggregation } from '../../../entities/secondary-gst-aggregation.entity';

import { Gstr1ComplianceRecord } from '../schemas/gst-gstr1-compliance.schema';
import { Gstr2bComplianceRecord } from '../schemas/gst-gstr2b-compliance.schema';
import { Gstr3bComplianceRecord } from '../schemas/gst-gstr3b-compliance.schema';

import {

  computePrimaryGstr1AggregationMetrics,

  mergeAggregationVariable,

  preserveMetricKeys,

  PRIMARY_GSTR1_METRIC_KEYS,

  PRIMARY_GST_COMPLIANCE_METRIC_KEYS,

} from './gst-gstr1-aggregation.util';
import {
  computePrimaryGstr2bAggregationMetrics,
  computeSecondaryGstr2bAggregationMetrics,
  getGstr2bRecordsForPan,
  normalizePan as normalizePanFrom2bUtil,
} from './gst-gstr2b-aggregation.util';
import {
  computePrimaryGstr3bAggregationMetrics,
  computeSecondaryGstr3bAggregationMetrics,
  getGstr3bRecordsForPan,
  normalizePan as normalizePanFrom3bUtil,
} from './gst-gstr3b-aggregation.util';



const GSTIN_PATTERN =

  /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;



type GstEntityType = 'PRIMARY' | 'CONSIDERED_ENTITY';



interface ExpectedGstUnit {

  customerId: string;

  loanId: string;

  gstin: string;

  pan: string | null;

  entityType: GstEntityType;

}



interface UploadRow {

  customer_id: string;

  associated_loan_id: string;

  primary_pan: string | null;

  considered_entity_pan: string | null;

}



interface AddressParts {

  addressLine: string;

  area: string;

  city: string;

  state: string;

  pincode: string;

}



/** Primary aggregation metrics stored as JSON in aggregation_variable. */

export interface PrimaryAggregationMetrics {

  PRIMARY_TOTAL_GST_COUNT: number;

  PRIMARY_ACTIVE_GST_COUNT: number;

  PRIMARY_CANCELLED_GST_COUNT: number;

  PRIMARY_SUSPENDED_GST_COUNT: number;

  PRIMARY_ADDRESS_CHANGE: boolean;

  PRIMARY_TOTAL_EINVOICE_COUNT: number;

  PRIMARY_EINVOICE_ENABLED_COUNT: number;

}



/** Secondary aggregation metrics stored as JSON in aggregation_variable. */

export interface SecondaryAggregationMetrics {

  SECONDARY_TOTAL_GST_COUNT: number;

  SECONDARY_ACTIVE_GST_COUNT: number;

  SECONDARY_CANCELLED_GST_COUNT: number;

  SECONDARY_SUSPENDED_GST_COUNT: number;

  SECONDARY_ADDRESS_CHANGE: boolean;

  SECONDARY_TOTAL_EINVOICE_COUNT: number;

  SECONDARY_EINVOICE_ENABLED_COUNT: number;

}



interface PanLevelMetricValues {

  totalGstCount: number;

  activeGstCount: number;

  cancelledGstCount: number;

  suspendedGstCount: number;

  addressChange: boolean;

  totalEinvoiceCount: number;

  einvoiceEnabledCount: number;

}



/** Mongo compliance docs grouped for a customer, ready for aggregation. */

export interface CustomerComplianceContext {

  customerId: string;

  sourceTable: string;

  primaryRecords: GstComplianceRecord[];

  secondaryRecords: GstComplianceRecord[];

}



const VERIFY_FETCH_OPERATION = 'GSTIN_VERIFY_AND_FETCH';

const VERIFY_GSTR_OPERATION = 'GSTIN_VERIFY_AND_FETCH_GSTR';
const VERIFY_2B_OPERATION = 'GSTIN_VERIFY_AND_FETCH_GSTR_2B';
const VERIFY_3B_OPERATION = 'GSTIN_VERIFY_AND_FETCH_GSTR_3B';

@Injectable()
export class GstAggregationService {

  private readonly logger = new Logger(GstAggregationService.name);



  constructor(

    @InjectDataSource() private readonly dataSource: DataSource,

    private readonly gstService: GstService,

    @InjectRepository(PrimaryGstAggregation)

    private readonly primaryAggRepo: Repository<PrimaryGstAggregation>,

    @InjectRepository(SecondaryGstAggregation)

    private readonly secondaryAggRepo: Repository<SecondaryGstAggregation>,

    @Optional()

    @InjectModel(GstComplianceRecord.name)

    private readonly complianceModel?: Model<GstComplianceRecord>,

    @Optional()

    @InjectModel(Gstr1ComplianceRecord.name)

    private readonly gstr1ComplianceModel?: Model<Gstr1ComplianceRecord>,

    @Optional()

    @InjectModel(Gstr2bComplianceRecord.name)

    private readonly gstr2bComplianceModel?: Model<Gstr2bComplianceRecord>,

    @Optional()

    @InjectModel(Gstr3bComplianceRecord.name)

    private readonly gstr3bComplianceModel?: Model<Gstr3bComplianceRecord>,

  ) {}



  /**

   * Called when a verify-and-fetch job finishes. For each customer touched by

   * the job, checks whether all expected GSTINs are stored in Mongo; if so,

   * runs aggregation into Postgres.

   */

  async triggerAfterVerifyFetchJob(jobId: string): Promise<void> {

    if (!this.complianceModel) {

      this.logger.warn('MongoDB not enabled; skipping compliance aggregation.');

      return;

    }



    const job = await this.gstService.getJobStatus(jobId);

    if (!job || job.metadata?.operation !== VERIFY_FETCH_OPERATION) {

      return;

    }



    const sourceTable = String(job.metadata?.sourceTable ?? '').trim();

    if (!sourceTable) {

      this.logger.warn(

        `Job ${jobId} has no sourceTable in metadata; skipping aggregation.`,

      );

      return;

    }



    const customerIds = this.collectCustomerIdsFromJob(job);

    if (customerIds.length === 0) {

      this.logger.log(

        `Job ${jobId}: no customerIds found in task payloads; skipping aggregation.`,

      );

      return;

    }



    this.logger.log(

      `Job ${jobId} completed — checking aggregation for ${customerIds.length} customer(s).`,

    );



    for (const customerId of customerIds) {

      try {

        await this.runAggregationIfComplete(customerId, sourceTable);

      } catch (err) {

        this.logger.error(

          `Aggregation failed for customerId=${customerId}: ${(err as Error).message}`,

        );

      }

    }

  }



  /**

   * Called when a GSTR-1 track job finishes. Runs GSTR-1 aggregation for each

   * customer in the job into primary_gst_aggregation.

   */

  async triggerAfterGstrJob(jobId: string): Promise<void> {

    if (!this.gstr1ComplianceModel) {

      this.logger.warn('MongoDB GSTR-1 model not enabled; skipping GSTR-1 aggregation.');

      return;

    }



    const job = await this.gstService.getJobStatus(jobId);

    if (!job || job.metadata?.operation !== VERIFY_GSTR_OPERATION) {

      return;

    }



    const sourceTable = String(job.metadata?.sourceTable ?? '').trim();

    if (!sourceTable) {

      this.logger.warn(

        `Job ${jobId} has no sourceTable in metadata; skipping GSTR-1 aggregation.`,

      );

      return;

    }



    const customerIds = this.collectCustomerIdsFromJob(job);

    if (customerIds.length === 0) {

      this.logger.log(

        `Job ${jobId}: no customerIds found in task payloads; skipping GSTR-1 aggregation.`,

      );

      return;

    }



    this.logger.log(

      `Job ${jobId} completed — running GSTR-1 aggregation for ${customerIds.length} customer(s).`,

    );



    for (const customerId of customerIds) {

      try {

        await this.runGstr1AggregationForCustomer(customerId, sourceTable);

      } catch (err) {

        this.logger.error(

          `GSTR-1 aggregation failed for customerId=${customerId}: ${(err as Error).message}`,

        );

      }

    }

  }



  /**

   * Runs GSTR-1 aggregation for every customer present in the upload table.

   * Useful when GSTR-1 Mongo data was seeded manually.

   */

  async runGstr1AggregationForTable(

    rawTableName?: string,

  ): Promise<{ customersProcessed: number }> {

    if (!this.gstr1ComplianceModel) {

      this.logger.warn('MongoDB GSTR-1 model not enabled; skipping GSTR-1 aggregation.');

      return { customersProcessed: 0 };

    }



    const sourceTable = this.sanitizeTableName(rawTableName);

    const customerIds = await this.getDistinctCustomerIdsFromTable(sourceTable);



    for (const customerId of customerIds) {

      await this.runGstr1AggregationForCustomer(customerId, sourceTable);

    }



    return { customersProcessed: customerIds.length };

  }



  /**

   * Computes GSTR-1 metrics for a customer and merges them into

   * primary_gst_aggregation.aggregation_variable.

   */

  async runGstr1AggregationForCustomer(

    customerId: string,

    sourceTable: string,

  ): Promise<void> {

    const uploadRows = await this.getUploadRowsForCustomer(customerId, sourceTable);

    if (uploadRows.length === 0) {

      return;

    }



    const existingRows = await this.primaryAggRepo.find({

      where: { customerId },

    });

    const existingByLoan = new Map(

      existingRows.map((row) => [row.associatedLoanId, row.aggregationVariable]),

    );



    const rows: Partial<PrimaryGstAggregation>[] = [];



    for (const uploadRow of uploadRows) {

      const primaryPan = this.normalizePan(uploadRow.primary_pan);

      if (!primaryPan) {

        continue;

      }



      const panRecords = await this.gstr1ComplianceModel!.find({

        pan: primaryPan,

        customerId,

      })

        .lean()

        .exec();



      const metrics = computePrimaryGstr1AggregationMetrics(panRecords);

      const existingJson = existingByLoan.get(uploadRow.associated_loan_id) ?? null;



      const aggregationObject = this.buildAggregationObject(
        existingJson,
        PRIMARY_GST_COMPLIANCE_METRIC_KEYS,
        metrics,
      );

      rows.push({
        customerId,
        associatedLoanId: uploadRow.associated_loan_id,
        aggregationVariable: aggregationObject,
      });

    }



    if (rows.length === 0) {

      return;

    }



    await this.primaryAggRepo.delete({ customerId });

    await this.primaryAggRepo.save(rows);



    this.logger.log(

      `customerId=${customerId}: wrote ${rows.length} primary_gst_aggregation row(s) with GSTR-1 metrics.`,

    );

  }

  /**
   * Called when a GSTR-2B job finishes. Runs GSTR-2B aggregation for each
   * customer in the job into primary_gst_aggregation and secondary_gst_aggregation.
   */
  async triggerAfterGstr2bJob(jobId: string): Promise<void> {
    if (!this.gstr2bComplianceModel) {
      this.logger.warn('MongoDB GSTR-2B model not enabled; skipping GSTR-2B aggregation.');
      return;
    }

    const job = await this.gstService.getJobStatus(jobId);
    if (!job || job.metadata?.operation !== VERIFY_2B_OPERATION) {
      return;
    }

    const sourceTable = String(job.metadata?.sourceTable ?? '').trim();
    if (!sourceTable) {
      this.logger.warn(
        `Job ${jobId} has no sourceTable in metadata; skipping GSTR-2B aggregation.`,
      );
      return;
    }

    const customerIds = this.collectCustomerIdsFromJob(job);
    if (customerIds.length === 0) {
      this.logger.log(
        `Job ${jobId}: no customerIds found in task payloads; skipping GSTR-2B aggregation.`,
      );
      return;
    }

    this.logger.log(
      `Job ${jobId} completed — running GSTR-2B aggregation for ${customerIds.length} customer(s).`,
    );

    for (const customerId of customerIds) {
      try {
        await this.runGstr2bAggregationForCustomer(customerId, sourceTable);
      } catch (err) {
        this.logger.error(
          `GSTR-2B aggregation failed for customerId=${customerId}: ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * Runs GSTR-2B aggregation for every customer present in the upload table.
   * Useful when GSTR-2B Mongo data was seeded manually.
   */
  async runGstr2bAggregationForTable(
    rawTableName?: string,
  ): Promise<{ customersProcessed: number }> {
    if (!this.gstr2bComplianceModel) {
      this.logger.warn('MongoDB GSTR-2B model not enabled; skipping GSTR-2B aggregation.');
      return { customersProcessed: 0 };
    }

    const sourceTable = this.sanitizeTableName(rawTableName);
    const customerIds = await this.getDistinctCustomerIdsFromTable(sourceTable);

    for (const customerId of customerIds) {
      await this.runGstr2bAggregationForCustomer(customerId, sourceTable);
    }

    return { customersProcessed: customerIds.length };
  }

  /**
   * Computes GSTR-2B metrics for a customer and merges them into
   * primary_gst_aggregation / secondary_gst_aggregation aggregation_variable.
   */
  async runGstr2bAggregationForCustomer(
    customerId: string,
    sourceTable: string,
  ): Promise<void> {
    if (!this.gstr2bComplianceModel) {
      return;
    }

    const uploadRows = await this.getUploadRowsForCustomer(customerId, sourceTable);
    if (uploadRows.length === 0) {
      return;
    }

    const existingPrimaryRows = await this.primaryAggRepo.find({ where: { customerId } });
    const existingPrimaryByLoan = new Map(
      existingPrimaryRows.map((row) => [row.associatedLoanId, row]),
    );

    const existingSecondaryRows = await this.secondaryAggRepo.find({
      where: { customerId },
    });
    const existingSecondaryByLoan = new Map(
      existingSecondaryRows.map((row) => [row.associatedLoanId, row]),
    );

    const gstr2bRecords = await this.gstr2bComplianceModel
      .find({ customerId })
      .lean()
      .exec();

    const primaryRowsToSave: Partial<PrimaryGstAggregation>[] = [];
    const secondaryRowsToSave: Partial<SecondaryGstAggregation>[] = [];

    for (const uploadRow of uploadRows) {
      const primaryPan = normalizePanFrom2bUtil(uploadRow.primary_pan);
      if (primaryPan) {
        const primaryPanRecords = getGstr2bRecordsForPan(gstr2bRecords, primaryPan);
        const primaryMetrics =
          computePrimaryGstr2bAggregationMetrics(primaryPanRecords);

        const existingPrimary =
          existingPrimaryByLoan.get(uploadRow.associated_loan_id) ?? null;
        const mergedPrimaryJson = mergeAggregationVariable(
          existingPrimary?.aggregationVariable ?? null,
          primaryMetrics as unknown as Record<string, unknown>,
        );

        primaryRowsToSave.push({
          ...(existingPrimary?.id ? { id: existingPrimary.id } : {}),
          customerId,
          associatedLoanId: uploadRow.associated_loan_id,
          aggregationVariable: mergedPrimaryJson,
        });
      }

      const consideredPan = normalizePanFrom2bUtil(uploadRow.considered_entity_pan);
      if (consideredPan) {
        const consideredPanRecords = getGstr2bRecordsForPan(
          gstr2bRecords,
          consideredPan,
        );
        const consideredMetrics =
          computeSecondaryGstr2bAggregationMetrics(consideredPanRecords);

        const existingSecondary =
          existingSecondaryByLoan.get(uploadRow.associated_loan_id) ?? null;
        const mergedSecondaryJson = mergeAggregationVariable(
          existingSecondary?.aggregationVariable ?? null,
          consideredMetrics as unknown as Record<string, unknown>,
        );

        secondaryRowsToSave.push({
          ...(existingSecondary?.id ? { id: existingSecondary.id } : {}),
          customerId,
          associatedLoanId: uploadRow.associated_loan_id,
          aggregationVariable: mergedSecondaryJson,
        });
      }
    }

    if (primaryRowsToSave.length > 0) {
      await this.primaryAggRepo.save(primaryRowsToSave);
    }

    if (secondaryRowsToSave.length > 0) {
      await this.secondaryAggRepo.save(secondaryRowsToSave);
    }

    this.logger.log(
      `customerId=${customerId}: merged GSTR-2B metrics into ${primaryRowsToSave.length} primary and ${secondaryRowsToSave.length} secondary aggregation row(s).`,
    );
  }

  /**
   * Called when a GSTR-3B job finishes. Runs GSTR-3B aggregation for each
   * customer in the job into primary_gst_aggregation and secondary_gst_aggregation.
   */
  async triggerAfterGstr3bJob(jobId: string): Promise<void> {
    if (!this.gstr3bComplianceModel) {
      this.logger.warn('MongoDB GSTR-3B model not enabled; skipping GSTR-3B aggregation.');
      return;
    }

    const job = await this.gstService.getJobStatus(jobId);
    if (!job || job.metadata?.operation !== VERIFY_3B_OPERATION) {
      return;
    }

    const sourceTable = String(job.metadata?.sourceTable ?? '').trim();
    if (!sourceTable) {
      this.logger.warn(
        `Job ${jobId} has no sourceTable in metadata; skipping GSTR-3B aggregation.`,
      );
      return;
    }

    const customerIds = this.collectCustomerIdsFromJob(job);
    if (customerIds.length === 0) {
      this.logger.log(
        `Job ${jobId}: no customerIds found in task payloads; skipping GSTR-3B aggregation.`,
      );
      return;
    }

    this.logger.log(
      `Job ${jobId} completed — running GSTR-3B aggregation for ${customerIds.length} customer(s).`,
    );

    for (const customerId of customerIds) {
      try {
        await this.runGstr3bAggregationForCustomer(customerId, sourceTable);
      } catch (err) {
        this.logger.error(
          `GSTR-3B aggregation failed for customerId=${customerId}: ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * Runs GSTR-3B aggregation for every customer present in the upload table.
   * Useful when GSTR-3B Mongo data was seeded manually.
   */
  async runGstr3bAggregationForTable(
    rawTableName?: string,
  ): Promise<{ customersProcessed: number }> {
    if (!this.gstr3bComplianceModel) {
      this.logger.warn('MongoDB GSTR-3B model not enabled; skipping GSTR-3B aggregation.');
      return { customersProcessed: 0 };
    }

    const sourceTable = this.sanitizeTableName(rawTableName);
    const customerIds = await this.getDistinctCustomerIdsFromTable(sourceTable);

    for (const customerId of customerIds) {
      await this.runGstr3bAggregationForCustomer(customerId, sourceTable);
    }

    return { customersProcessed: customerIds.length };
  }

  /**
   * Computes GSTR-3B metrics for a customer and merges them into
   * primary_gst_aggregation / secondary_gst_aggregation aggregation_variable.
   */
  async runGstr3bAggregationForCustomer(
    customerId: string,
    sourceTable: string,
  ): Promise<void> {
    if (!this.gstr3bComplianceModel) {
      return;
    }

    const uploadRows = await this.getUploadRowsForCustomer(customerId, sourceTable);
    if (uploadRows.length === 0) {
      return;
    }

    const existingPrimaryRows = await this.primaryAggRepo.find({ where: { customerId } });
    const existingPrimaryByLoan = new Map(
      existingPrimaryRows.map((row) => [row.associatedLoanId, row]),
    );

    const existingSecondaryRows = await this.secondaryAggRepo.find({
      where: { customerId },
    });
    const existingSecondaryByLoan = new Map(
      existingSecondaryRows.map((row) => [row.associatedLoanId, row]),
    );

    const gstr3bRecords = await this.gstr3bComplianceModel
      .find({ customerId })
      .lean()
      .exec();

    const primaryRowsToSave: Partial<PrimaryGstAggregation>[] = [];
    const secondaryRowsToSave: Partial<SecondaryGstAggregation>[] = [];

    for (const uploadRow of uploadRows) {
      const primaryPan = normalizePanFrom3bUtil(uploadRow.primary_pan);
      if (primaryPan) {
        const primaryPanRecords = getGstr3bRecordsForPan(gstr3bRecords, primaryPan);
        const primaryMetrics =
          computePrimaryGstr3bAggregationMetrics(primaryPanRecords);

        const existingPrimary =
          existingPrimaryByLoan.get(uploadRow.associated_loan_id) ?? null;
        const mergedPrimaryJson = mergeAggregationVariable(
          existingPrimary?.aggregationVariable ?? null,
          primaryMetrics as unknown as Record<string, unknown>,
        );

        primaryRowsToSave.push({
          ...(existingPrimary?.id ? { id: existingPrimary.id } : {}),
          customerId,
          associatedLoanId: uploadRow.associated_loan_id,
          aggregationVariable: mergedPrimaryJson,
        });
      }

      const consideredPan = normalizePanFrom3bUtil(uploadRow.considered_entity_pan);
      if (consideredPan) {
        const consideredPanRecords = getGstr3bRecordsForPan(
          gstr3bRecords,
          consideredPan,
        );
        const consideredMetrics =
          computeSecondaryGstr3bAggregationMetrics(consideredPanRecords);

        const existingSecondary =
          existingSecondaryByLoan.get(uploadRow.associated_loan_id) ?? null;
        const mergedSecondaryJson = mergeAggregationVariable(
          existingSecondary?.aggregationVariable ?? null,
          consideredMetrics as unknown as Record<string, unknown>,
        );

        secondaryRowsToSave.push({
          ...(existingSecondary?.id ? { id: existingSecondary.id } : {}),
          customerId,
          associatedLoanId: uploadRow.associated_loan_id,
          aggregationVariable: mergedSecondaryJson,
        });
      }
    }

    if (primaryRowsToSave.length > 0) {
      await this.primaryAggRepo.save(primaryRowsToSave);
    }

    if (secondaryRowsToSave.length > 0) {
      await this.secondaryAggRepo.save(secondaryRowsToSave);
    }

    this.logger.log(
      `customerId=${customerId}: merged GSTR-3B metrics into ${primaryRowsToSave.length} primary and ${secondaryRowsToSave.length} secondary aggregation row(s).`,
    );
  }



  /**

   * Returns true when every valid, non-empty GSTIN for the customer (from the

   * source table) has a matching document in gst_compliance_data.

   */

  async isCustomerComplianceComplete(

    customerId: string,

    sourceTable: string,

  ): Promise<boolean> {

    const expected = await this.getExpectedUnitsForCustomer(

      customerId,

      sourceTable,

    );

    if (expected.length === 0) {

      return false;

    }



    const stored = await this.complianceModel!.find({ customerId })

      .select('loanId gstin entityType')

      .lean()

      .exec();



    const storedSet = new Set(

      stored.map((d) => `${d.loanId}||${d.gstin}||${d.entityType}`),

    );



    return expected.every((unit) =>

      storedSet.has(`${unit.loanId}||${unit.gstin}||${unit.entityType}`),

    );

  }



  /**

   * If the customer's compliance fetch is complete, loads Mongo data and

   * writes aggregation rows to Postgres.

   */

  async runAggregationIfComplete(

    customerId: string,

    sourceTable: string,

  ): Promise<void> {

    const complete = await this.isCustomerComplianceComplete(

      customerId,

      sourceTable,

    );

    if (!complete) {

      this.logger.debug(

        `customerId=${customerId}: compliance fetch not complete yet; aggregation deferred.`,

      );

      return;

    }



    this.logger.log(

      `customerId=${customerId}: all GST compliance data fetched — starting aggregation.`,

    );



    const context = await this.buildCustomerContext(customerId, sourceTable);

    const allComplianceRecords = await this.complianceModel!.find({})

      .lean()

      .exec();

    await this.aggregatePrimaryGst(context, allComplianceRecords);

    await this.aggregateSecondaryGst(context, allComplianceRecords);



    this.logger.log(`customerId=${customerId}: aggregation finished.`);

  }



  // -------------------- primary aggregation --------------------



  /**

   * PRIMARY entity aggregation → primary_gst_aggregation table.

   * Uses primary_pan from the Postgres upload table and compliance fields

   * extracted from gst_compliance_data search responses.

   */

  private async aggregatePrimaryGst(

    context: CustomerComplianceContext,

    allComplianceRecords: GstComplianceRecord[],

  ): Promise<void> {

    const existingRows = await this.primaryAggRepo.find({

      where: { customerId: context.customerId },

    });

    const existingByLoan = new Map(

      existingRows.map((row) => [row.associatedLoanId, row.aggregationVariable]),

    );



    await this.primaryAggRepo.delete({ customerId: context.customerId });



    const uploadRows = await this.getUploadRowsForCustomer(

      context.customerId,

      context.sourceTable,

    );

    if (uploadRows.length === 0) {

      return;

    }



    const rows: Partial<PrimaryGstAggregation>[] = [];



    for (const uploadRow of uploadRows) {

      const primaryPan = this.normalizePan(uploadRow.primary_pan);

      if (!primaryPan) {

        continue;

      }



      const panRecords = allComplianceRecords.filter(

        (record) => this.getRecordPan(record) === primaryPan,

      );



      const metrics = this.computePrimaryAggregationMetrics(panRecords);



      const existingJson = existingByLoan.get(uploadRow.associated_loan_id) ?? null;
      const aggregationObject = this.buildAggregationObject(
        existingJson,
        PRIMARY_GSTR1_METRIC_KEYS,
        metrics,
      );

      rows.push({
        customerId: context.customerId,
        associatedLoanId: uploadRow.associated_loan_id,
        aggregationVariable: aggregationObject,
      });

    }



    if (rows.length > 0) {

      await this.primaryAggRepo.save(rows);

    }



    this.logger.log(

      `customerId=${context.customerId}: wrote ${rows.length} primary_gst_aggregation row(s).`,

    );

  }



  /**

   * CONSIDERED_ENTITY aggregation → secondary_gst_aggregation table.

   * Uses considered_entity_pan from the Postgres upload table and compliance

   * fields extracted from gst_compliance_data search responses.

   */

  private async aggregateSecondaryGst(

    context: CustomerComplianceContext,

    allComplianceRecords: GstComplianceRecord[],

  ): Promise<void> {

    await this.secondaryAggRepo.delete({ customerId: context.customerId });



    const uploadRows = await this.getUploadRowsForCustomer(

      context.customerId,

      context.sourceTable,

    );

    if (uploadRows.length === 0) {

      return;

    }



    const rows: Partial<SecondaryGstAggregation>[] = [];



    for (const uploadRow of uploadRows) {

      const consideredEntityPan = this.normalizePan(

        uploadRow.considered_entity_pan,

      );

      if (!consideredEntityPan) {

        continue;

      }



      const panRecords = allComplianceRecords.filter(

        (record) => this.getRecordPan(record) === consideredEntityPan,

      );



      const metrics = this.computeSecondaryAggregationMetrics(panRecords);



      const aggregationObject = JSON.stringify(metrics);
      rows.push({
        customerId: context.customerId,
        associatedLoanId: uploadRow.associated_loan_id,
        aggregationVariable: aggregationObject,
      });

    }



    if (rows.length > 0) {

      await this.secondaryAggRepo.save(rows);

    }



    this.logger.log(

      `customerId=${context.customerId}: wrote ${rows.length} secondary_gst_aggregation row(s).`,

    );

  }



  /**

   * Aggregates GSTIN-level metrics for all compliance records sharing the

   * same PAN (Primary_PAN from gst_uploaded_file_data).

   */

  computePrimaryAggregationMetrics(

    records: GstComplianceRecord[],

  ): PrimaryAggregationMetrics {

    const metrics = this.computePanLevelMetrics(records);

    return {

      PRIMARY_TOTAL_GST_COUNT: metrics.totalGstCount,

      PRIMARY_ACTIVE_GST_COUNT: metrics.activeGstCount,

      PRIMARY_CANCELLED_GST_COUNT: metrics.cancelledGstCount,

      PRIMARY_SUSPENDED_GST_COUNT: metrics.suspendedGstCount,

      PRIMARY_ADDRESS_CHANGE: metrics.addressChange,

      PRIMARY_TOTAL_EINVOICE_COUNT: metrics.totalEinvoiceCount,

      PRIMARY_EINVOICE_ENABLED_COUNT: metrics.einvoiceEnabledCount,

    };

  }



  computeSecondaryAggregationMetrics(

    records: GstComplianceRecord[],

  ): SecondaryAggregationMetrics {

    const metrics = this.computePanLevelMetrics(records);

    return {

      SECONDARY_TOTAL_GST_COUNT: metrics.totalGstCount,

      SECONDARY_ACTIVE_GST_COUNT: metrics.activeGstCount,

      SECONDARY_CANCELLED_GST_COUNT: metrics.cancelledGstCount,

      SECONDARY_SUSPENDED_GST_COUNT: metrics.suspendedGstCount,

      SECONDARY_ADDRESS_CHANGE: metrics.addressChange,

      SECONDARY_TOTAL_EINVOICE_COUNT: metrics.totalEinvoiceCount,

      SECONDARY_EINVOICE_ENABLED_COUNT: metrics.einvoiceEnabledCount,

    };

  }



  private computePanLevelMetrics(

    records: GstComplianceRecord[],

  ): PanLevelMetricValues {

    const distinctGstins = new Set<string>();

    const activeGstins = new Set<string>();

    const cancelledGstins = new Set<string>();

    const suspendedGstins = new Set<string>();

    const einvoiceEnabledGstins = new Set<string>();

    const addressKeys = new Set<string>();



    for (const record of records) {

      const gstin = (record.gstin ?? '').trim().toUpperCase();

      if (!gstin) {

        continue;

      }



      distinctGstins.add(gstin);



      const gstStatus = this.extractGstStatus(record);

      if (gstStatus === 'ACTIVE') {

        activeGstins.add(gstin);

      } else if (gstStatus === 'CANCELLED') {

        cancelledGstins.add(gstin);

      } else if (gstStatus === 'SUSPENDED') {

        suspendedGstins.add(gstin);

      }



      if (this.extractEinvoiceEnabled(record) === 'YES') {

        einvoiceEnabledGstins.add(gstin);

      }



      addressKeys.add(this.buildAddressKey(record));

    }



    return {

      totalGstCount: distinctGstins.size,

      activeGstCount: activeGstins.size,

      cancelledGstCount: cancelledGstins.size,

      suspendedGstCount: suspendedGstins.size,

      addressChange: addressKeys.size > 1,

      totalEinvoiceCount: distinctGstins.size,

      einvoiceEnabledCount: einvoiceEnabledGstins.size,

    };

  }



  // -------------------- field extraction (Sandbox search response) --------------------



  /**

   * Sandbox search payload lives at searchResponse.data.data (see reference

   * GSTIN e.g. 06AAXFA6979P1Z6): gstin, sts, einvoiceStatus, pradr.addr.*

   */

  private extractSearchData(

    record: GstComplianceRecord,

  ): Record<string, any> | null {

    const nested = record.searchResponse?.data?.data;

    if (nested && typeof nested === 'object') {

      return nested as Record<string, any>;

    }



    const flat = record.searchResponse?.data;

    if (flat && typeof flat === 'object' && 'gstin' in flat) {

      return flat as Record<string, any>;

    }



    return null;

  }



  private extractGstStatus(record: GstComplianceRecord): string | null {

    const raw =

      this.extractSearchData(record)?.sts ??

      record.status ??

      record.verifyResponse?.data?.data?.status;



    return this.normalizeGstStatus(raw);

  }



  private extractEinvoiceEnabled(record: GstComplianceRecord): string | null {

    const raw = this.extractSearchData(record)?.einvoiceStatus;

    if (raw === undefined || raw === null || raw === '') {

      return null;

    }



    return String(raw).trim().toUpperCase() === 'YES' ? 'YES' : 'NO';

  }



  private extractPrincipalAddress(record: GstComplianceRecord): AddressParts {

    const addr = this.extractSearchData(record)?.pradr?.addr ?? {};



    return {

      addressLine: String(addr.st ?? '').trim(),

      area: String(addr.loc ?? addr.locality ?? '').trim(),

      city: String(addr.dst ?? '').trim(),

      state: String(addr.stcd ?? '').trim(),

      pincode: String(addr.pncd ?? '').trim(),

    };

  }



  private buildAddressKey(record: GstComplianceRecord): string {

    const { addressLine, area, city, state, pincode } =

      this.extractPrincipalAddress(record);



    return [addressLine, area, city, state, pincode].join('|');

  }



  private getRecordPan(record: GstComplianceRecord): string | null {

    const pan = this.normalizePan(record.pan);

    if (pan) {

      return pan;

    }



    const gstin = (record.gstin ?? '').trim().toUpperCase();

    if (gstin.length >= 12) {

      return gstin.substring(2, 12);

    }



    return null;

  }



  private normalizePan(pan: string | null | undefined): string | null {

    const normalized = (pan ?? '').trim().toUpperCase();

    return normalized || null;

  }



  private normalizeGstStatus(

    raw: string | null | undefined,

  ): string | null {

    if (!raw) {

      return null;

    }



    const normalized = String(raw).trim().toUpperCase();

    if (normalized === 'ACTIVE') {

      return 'ACTIVE';

    }

    if (normalized === 'CANCELLED' || normalized === 'CANCELED') {

      return 'CANCELLED';

    }

    if (normalized === 'SUSPENDED') {

      return 'SUSPENDED';

    }



    return null;

  }

  /**
   * Creates the final aggregation object by preserving metric keys from the
   * existing JSON and then overlaying the newly computed metrics.
   */
  private buildAggregationObject(
    existingJson: string | null | undefined,
    keysToPreserve: readonly string[],
    metrics: object,
  ): string {
    return mergeAggregationVariable(existingJson, {
      ...preserveMetricKeys(existingJson, keysToPreserve),
      ...(metrics as Record<string, unknown>),
    });
  }



  // -------------------- helpers --------------------



  private async buildCustomerContext(

    customerId: string,

    sourceTable: string,

  ): Promise<CustomerComplianceContext> {

    const allRecords = await this.complianceModel!.find({ customerId })

      .lean()

      .exec();



    return {

      customerId,

      sourceTable,

      primaryRecords: allRecords.filter((r) => r.entityType === 'PRIMARY'),

      secondaryRecords: allRecords.filter(

        (r) => r.entityType === 'CONSIDERED_ENTITY',

      ),

    };

  }



  private async getUploadRowsForCustomer(

    customerId: string,

    sourceTable: string,

  ): Promise<UploadRow[]> {

    const dbRows: Array<{

      customer_id: string | null;

      associated_loan_id: string | null;

      primary_pan: string | null;

      considered_entity_pan: string | null;

    }> = await this.dataSource.query(

      `SELECT customer_id, associated_loan_id, primary_pan, considered_entity_pan

         FROM "${sourceTable}"

        WHERE customer_id = $1`,

      [customerId],

    );



    return dbRows

      .map((row) => ({

        customer_id: (row.customer_id ?? '').trim(),

        associated_loan_id: (row.associated_loan_id ?? '').trim(),

        primary_pan: row.primary_pan ?? null,

        considered_entity_pan: row.considered_entity_pan ?? null,

      }))

      .filter((row) => row.customer_id && row.associated_loan_id);

  }



  private async getExpectedUnitsForCustomer(

    customerId: string,

    sourceTable: string,

  ): Promise<ExpectedGstUnit[]> {

    const dbRows: Array<{

      customer_id: string | null;

      associated_loan_id: string | null;

      primary_pan: string | null;

      primary_gst_no: string | null;

      considered_entity_pan: string | null;

      considered_entity_gst_no: string | null;

    }> = await this.dataSource.query(

      `SELECT customer_id, associated_loan_id, primary_pan, primary_gst_no,

              considered_entity_pan, considered_entity_gst_no

         FROM "${sourceTable}"

        WHERE customer_id = $1`,

      [customerId],

    );



    const units: ExpectedGstUnit[] = [];



    for (const r of dbRows) {

      const loanId = (r.associated_loan_id ?? '').trim();

      const custId = (r.customer_id ?? '').trim();

      if (!custId) continue;



      const primaryGst = (r.primary_gst_no ?? '').trim().toUpperCase();

      if (primaryGst && this.isValidGstin(primaryGst)) {

        units.push({

          customerId: custId,

          loanId,

          gstin: primaryGst,

          pan: r.primary_pan ?? null,

          entityType: 'PRIMARY',

        });

      }



      const secondaryGst = (r.considered_entity_gst_no ?? '')

        .trim()

        .toUpperCase();

      if (secondaryGst && this.isValidGstin(secondaryGst)) {

        units.push({

          customerId: custId,

          loanId,

          gstin: secondaryGst,

          pan: r.considered_entity_pan ?? null,

          entityType: 'CONSIDERED_ENTITY',

        });

      }

    }



    return units;

  }



  private collectCustomerIdsFromJob(job: {

    tasks?: Array<{ payload?: Record<string, any> }>;

  }): string[] {

    const ids = new Set<string>();



    for (const task of job.tasks ?? []) {

      const rows = task.payload?.rows as

        | Array<{ customer_id?: string | null }>

        | undefined;

      if (!rows) continue;

      for (const row of rows) {

        const id = (row.customer_id ?? '').trim();

        if (id) ids.add(id);

      }

    }



    return Array.from(ids);

  }



  private isValidGstin(gstin: string): boolean {

    return GSTIN_PATTERN.test(gstin);

  }



  private sanitizeTableName(rawTableName?: string): string {

    const tableName = (rawTableName ?? 'gst_uploaded_file_data').trim();

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {

      throw new Error(`Invalid table name "${tableName}".`);

    }

    return tableName;

  }



  private async getDistinctCustomerIdsFromTable(

    sourceTable: string,

  ): Promise<string[]> {

    const rows: Array<{ customer_id: string | null }> = await this.dataSource.query(

      `SELECT DISTINCT customer_id FROM "${sourceTable}" WHERE customer_id IS NOT NULL`,

    );



    return rows

      .map((row) => (row.customer_id ?? '').trim())

      .filter(Boolean);

  }

}


