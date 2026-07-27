import { Injectable, Logger, Optional } from '@nestjs/common';

import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';

import { DataSource, Repository } from 'typeorm';

import { InjectModel } from '@nestjs/mongoose';

import { Model } from 'mongoose';

import { GstService } from '../gst.service';

import { GstComplianceRecord } from '../schemas/gst-compliance.schema';

import { PrimaryGstAggregation } from '../../../entities/primary-gst-aggregation.entity';

import { SecondaryGstAggregation } from '../../../entities/secondary-gst-aggregation.entity';

import { Gstr2bComplianceRecord } from '../schemas/gst-gstr2b-compliance.schema';
import { Gstr3bComplianceRecord } from '../schemas/gst-gstr3b-compliance.schema';

import {
  mergeAggregationVariable,
  preserveMetricKeys,
  PRIMARY_GST_COMPLIANCE_METRIC_KEYS,
  CONSIDERED_GST_COMPLIANCE_METRIC_KEYS,
  PRIMARY_GSTR_TRACK_METRIC_KEYS,
  CONSIDERED_GSTR_TRACK_METRIC_KEYS,
  CONSIDERED_GSTR2B_SUPPLIER_METRIC_KEYS,
  CONSIDERED_GSTR3B_METRIC_KEYS,
} from './gst-aggregation-variable.util';
import {
  computePrimaryGstr2bAggregationMetrics,
  computeLoanLevelConsideredSupplierMetrics,
  getGstr2bRecordsForPan,
  normalizePan as normalizePanFrom2bUtil,
} from './gst-gstr2b-aggregation.util';
import {
  computePrimaryGstr3bAggregationMetrics,
  computeLoanLevelConsideredGstr3bMetrics,
  getGstr3bRecordsForPan,
  normalizePan as normalizePanFrom3bUtil,
} from './gst-gstr3b-aggregation.util';
import {
  computePrimaryGstrTrackAggregationMetricsForPans,
  computeConsideredGstrTrackAggregationMetricsForPans,
} from './gst-gstr-track-aggregation.util';
import { GstAggregationHistoryService } from './gst-aggregation-history.service';
import { Gstr1ReturnsComplianceRecord } from '../schemas/gst-gstr1-returns-compliance.schema';



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

  primary_gst_no: string | null;

  considered_entity_pan: string | null;

  considered_entity_gst_no: string | null;

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



/**
 * Considered-entity compliance metrics (secondary_gst_aggregation).
 * Written by verify-and-fetch.
 */
export interface ConsideredComplianceAggregationMetrics {
  CONSIDERED_TOTAL_GST_COUNT: number;
  CONSIDERED_ACTIVE_GST_COUNT: number;
  CONSIDERED_CANCELLED_GST_COUNT: number;
  CONSIDERED_SUSPENDED_GST_COUNT: number;
  CONSIDERED_ADDRESS_CHANGE_COUNT: number;
  CONSIDERED_TOTAL_EINVOICE_COUNT: number;
  CONSIDERED_EINVOICE_ENABLED_COUNT: number;
}

/** @deprecated Use ConsideredComplianceAggregationMetrics */
export type SecondaryAggregationMetrics = ConsideredComplianceAggregationMetrics;

interface PanLevelMetricValues {
  totalGstCount: number;
  activeGstCount: number;
  cancelledGstCount: number;
  suspendedGstCount: number;
  addressChange: boolean;
  addressChangeCount: number;
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

const VERIFY_2B_OPERATION = 'GSTIN_VERIFY_AND_FETCH_GSTR_2B';
const VERIFY_3B_OPERATION = 'GSTIN_VERIFY_AND_FETCH_GSTR_3B';
const VERIFY_TRACK_OPERATION = 'GSTIN_VERIFY_AND_FETCH_GSTR_TRACK';
const OBSOLETE_GSTR3B_KEYS = ['PRIMARY_TOTAL_TURNOVER', 'CONSIDERED_TOTAL_TURNOVER'] as const;
const OBSOLETE_SECONDARY_COMPLIANCE_KEYS = [
  'SECONDARY_TOTAL_GST_COUNT',
  'SECONDARY_ACTIVE_GST_COUNT',
  'SECONDARY_CANCELLED_GST_COUNT',
  'SECONDARY_SUSPENDED_GST_COUNT',
  'SECONDARY_ADDRESS_CHANGE',
  'SECONDARY_TOTAL_EINVOICE_COUNT',
  'SECONDARY_EINVOICE_ENABLED_COUNT',
] as const;
const HISTORY_SOURCE_VERIFY_FETCH = 'VERIFY_FETCH';
const HISTORY_SOURCE_GSTR2B = 'GSTR-2B';
const HISTORY_SOURCE_GSTR3B = 'GSTR-3B';
const HISTORY_SOURCE_GSTR_TRACK = 'GSTR-TRACK';

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

    private readonly aggregationHistoryService: GstAggregationHistoryService,

    @Optional()

    @InjectModel(GstComplianceRecord.name)

    private readonly complianceModel?: Model<GstComplianceRecord>,

    @Optional()

    @InjectModel(Gstr2bComplianceRecord.name)

    private readonly gstr2bComplianceModel?: Model<Gstr2bComplianceRecord>,

    @Optional()

    @InjectModel(Gstr3bComplianceRecord.name)

    private readonly gstr3bComplianceModel?: Model<Gstr3bComplianceRecord>,

    @Optional()

    @InjectModel(Gstr1ReturnsComplianceRecord.name)

    private readonly gstrTrackComplianceModel?: Model<Gstr1ReturnsComplianceRecord>,

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
    const existingPrimaryByLoan = new Map<string, PrimaryGstAggregation>();
    for (const row of existingPrimaryRows) {
      if (row.associatedLoanId) {
        existingPrimaryByLoan.set(row.associatedLoanId, row);
      }
    }

    const existingSecondaryRows = await this.secondaryAggRepo.find({
      where: { customerId },
    });
    const existingSecondaryByLoan = new Map<string, SecondaryGstAggregation>();
    for (const row of existingSecondaryRows) {
      if (row.associatedLoanId) {
        existingSecondaryByLoan.set(row.associatedLoanId, row);
      }
    }

    const gstr2bRecords = await this.gstr2bComplianceModel
      .find({ customerId })
      .lean()
      .exec();

    const primaryRowsToSave: Partial<PrimaryGstAggregation>[] = [];
    const secondaryRowsToSave: Partial<SecondaryGstAggregation>[] = [];

    for (const [loanId, loanUploadRows] of this.groupUploadRowsByLoan(
      uploadRows,
    )) {
      const existingPrimary = existingPrimaryByLoan.get(loanId) ?? null;
      const existingSecondary = existingSecondaryByLoan.get(loanId) ?? null;

      // Primary: merge metrics for each primary_pan on the loan (dedupe by merge).
      let primaryJson = existingPrimary?.aggregationVariable ?? null;
      const primaryPans = new Set<string>();
      for (const uploadRow of loanUploadRows) {
        const primaryPan = normalizePanFrom2bUtil(uploadRow.primary_pan);
        if (!primaryPan || primaryPans.has(primaryPan)) {
          continue;
        }
        primaryPans.add(primaryPan);

        const primaryPanRecords = getGstr2bRecordsForPan(
          gstr2bRecords,
          primaryPan,
        ).filter((record) => String(record.loanId ?? '').trim() === loanId);

        const primaryMetrics =
          computePrimaryGstr2bAggregationMetrics(primaryPanRecords);
        primaryJson = mergeAggregationVariable(
          primaryJson,
          primaryMetrics as unknown as Record<string, unknown>,
        );
      }

      if (primaryPans.size > 0 && primaryJson) {
        const cleanedPrimaryJson = this.removeAggregationKeys(
          primaryJson,
          OBSOLETE_GSTR3B_KEYS,
        );
        primaryRowsToSave.push({
          ...(existingPrimary?.id ? { id: existingPrimary.id } : {}),
          customerId,
          associatedLoanId: loanId,
          aggregationVariable: cleanedPrimaryJson,
        });
      }

      // Secondary (Considered Supplier Metrics):
      // Filter considered_entity_pan IS NOT NULL / non-empty → per-PAN metrics →
      // SUM across distinct Considered Entity PANs for this associated_loan_id.
      const consideredEntityPans =
        this.collectDistinctConsideredPansForLoan(loanUploadRows);
      if (consideredEntityPans.length === 0) {
        continue;
      }

      const loanGstr2bRecords = gstr2bRecords.filter(
        (record) => String(record.loanId ?? '').trim() === loanId,
      );
      const consideredSupplierMetrics =
        computeLoanLevelConsideredSupplierMetrics(
          consideredEntityPans,
          loanGstr2bRecords,
        );

      const mergedSecondaryJson = mergeAggregationVariable(
        existingSecondary?.aggregationVariable ?? null,
        {
          ...preserveMetricKeys(
            existingSecondary?.aggregationVariable ?? null,
            CONSIDERED_GSTR2B_SUPPLIER_METRIC_KEYS,
          ),
          ...(consideredSupplierMetrics as unknown as Record<string, unknown>),
        },
      );
      const cleanedSecondaryJson = this.removeAggregationKeys(
        mergedSecondaryJson,
        OBSOLETE_GSTR3B_KEYS,
      );

      secondaryRowsToSave.push({
        ...(existingSecondary?.id ? { id: existingSecondary.id } : {}),
        customerId,
        associatedLoanId: loanId,
        aggregationVariable: cleanedSecondaryJson,
      });
    }

    const dedupedPrimaryRows = this.dedupePrimaryRowsByLoanId(primaryRowsToSave);
    const dedupedSecondaryRows = this.dedupeSecondaryRowsByLoanId(
      secondaryRowsToSave,
    );

    if (dedupedPrimaryRows.length > 0) {
      await this.aggregationHistoryService.upsertPrimaryAggregation(
        this.primaryAggRepo,
        dedupedPrimaryRows,
        existingPrimaryByLoan,
        HISTORY_SOURCE_GSTR2B,
      );
    }

    if (dedupedSecondaryRows.length > 0) {
      await this.aggregationHistoryService.upsertSecondaryAggregation(
        this.secondaryAggRepo,
        dedupedSecondaryRows,
        existingSecondaryByLoan,
        HISTORY_SOURCE_GSTR2B,
      );
    }

    this.logger.log(
      `customerId=${customerId}: merged GSTR-2B metrics into ${dedupedPrimaryRows.length} primary and ${dedupedSecondaryRows.length} secondary aggregation row(s).`,
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
    const existingPrimaryByLoan = new Map<string, PrimaryGstAggregation>();
    for (const row of existingPrimaryRows) {
      if (row.associatedLoanId) {
        existingPrimaryByLoan.set(row.associatedLoanId, row);
      }
    }

    const existingSecondaryRows = await this.secondaryAggRepo.find({
      where: { customerId },
    });
    const existingSecondaryByLoan = new Map<string, SecondaryGstAggregation>();
    for (const row of existingSecondaryRows) {
      if (row.associatedLoanId) {
        existingSecondaryByLoan.set(row.associatedLoanId, row);
      }
    }

    const gstr3bRecords = await this.gstr3bComplianceModel
      .find({ customerId })
      .lean()
      .exec();

    const primaryRowsToSave: Partial<PrimaryGstAggregation>[] = [];
    const secondaryRowsToSave: Partial<SecondaryGstAggregation>[] = [];

    // Primary: unchanged (per upload row).
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
    }

    // Secondary (Considered GST Metrics):
    // Filter considered_entity_pan IS NOT NULL / non-empty → per-PAN metrics →
    // SUM across distinct Considered Entity PANs for this associated_loan_id.
    for (const [loanId, loanUploadRows] of this.groupUploadRowsByLoan(
      uploadRows,
    )) {
      const consideredEntityPans =
        this.collectDistinctConsideredPansForLoan(loanUploadRows);
      if (consideredEntityPans.length === 0) {
        continue;
      }

      const loanGstr3bRecords = gstr3bRecords.filter(
        (record) => String(record.loanId ?? '').trim() === loanId,
      );
      const consideredMetrics = computeLoanLevelConsideredGstr3bMetrics(
        consideredEntityPans,
        loanGstr3bRecords,
      );

      const existingSecondary = existingSecondaryByLoan.get(loanId) ?? null;
      const mergedSecondaryJson = mergeAggregationVariable(
        existingSecondary?.aggregationVariable ?? null,
        {
          ...preserveMetricKeys(
            existingSecondary?.aggregationVariable ?? null,
            CONSIDERED_GSTR3B_METRIC_KEYS,
          ),
          ...(consideredMetrics as unknown as Record<string, unknown>),
        },
      );
      const cleanedSecondaryJson = this.removeAggregationKeys(
        mergedSecondaryJson,
        OBSOLETE_GSTR3B_KEYS,
      );

      secondaryRowsToSave.push({
        ...(existingSecondary?.id ? { id: existingSecondary.id } : {}),
        customerId,
        associatedLoanId: loanId,
        aggregationVariable: cleanedSecondaryJson,
      });
    }

    const dedupedPrimaryRows = this.dedupePrimaryRowsByLoanId(primaryRowsToSave);
    const dedupedSecondaryRows = this.dedupeSecondaryRowsByLoanId(
      secondaryRowsToSave,
    );

    if (dedupedPrimaryRows.length > 0) {
      await this.aggregationHistoryService.upsertPrimaryAggregation(
        this.primaryAggRepo,
        dedupedPrimaryRows,
        existingPrimaryByLoan,
        HISTORY_SOURCE_GSTR3B,
      );
    }

    if (dedupedSecondaryRows.length > 0) {
      await this.aggregationHistoryService.upsertSecondaryAggregation(
        this.secondaryAggRepo,
        dedupedSecondaryRows,
        existingSecondaryByLoan,
        HISTORY_SOURCE_GSTR3B,
      );
    }

    this.logger.log(
      `customerId=${customerId}: merged GSTR-3B metrics into ${dedupedPrimaryRows.length} primary and ${dedupedSecondaryRows.length} secondary aggregation row(s).`,
    );
  }

  /**
   * Called when a gstr-track job finishes. Merges PRIMARY_* / CONSIDERED_*
   * return-period metrics into primary_gst_aggregation / secondary_gst_aggregation
   * (loan-scoped SUM of per-PAN counts).
   */
  async triggerAfterGstrTrackJob(jobId: string): Promise<void> {
    if (!this.gstrTrackComplianceModel) {
      this.logger.warn(
        'MongoDB GSTR track model not enabled; skipping track aggregation.',
      );
      return;
    }

    const job = await this.gstService.getJobStatus(jobId);
    if (!job || job.metadata?.operation !== VERIFY_TRACK_OPERATION) {
      return;
    }

    const sourceTable = String(job.metadata?.sourceTable ?? '').trim();
    if (!sourceTable) {
      this.logger.warn(
        `Job ${jobId} has no sourceTable in metadata; skipping track aggregation.`,
      );
      return;
    }

    const customerIds = this.collectCustomerIdsFromJob(job);
    if (customerIds.length === 0) {
      this.logger.log(
        `Job ${jobId}: no customerIds found for track aggregation.`,
      );
      return;
    }

    for (const customerId of customerIds) {
      try {
        await this.runGstrTrackAggregationForCustomer(customerId, sourceTable);
      } catch (err) {
        this.logger.error(
          `GSTR track aggregation failed for customerId=${customerId}: ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * Loan-level PRIMARY_* + CONSIDERED_* return-period metrics for
   * verify-and-fetch/gstr-track: SUM(per PAN counts) GROUP BY associated_loan_id.
   */
  async runGstrTrackAggregationForCustomer(
    customerId: string,
    sourceTable: string,
  ): Promise<void> {
    if (!this.gstrTrackComplianceModel) {
      return;
    }

    const uploadRows = await this.getUploadRowsForCustomer(
      customerId,
      sourceTable,
    );
    if (uploadRows.length === 0) {
      return;
    }

    const existingPrimaryRows = await this.primaryAggRepo.find({
      where: { customerId },
    });
    const existingPrimaryByLoan = new Map<string, PrimaryGstAggregation>();
    for (const row of existingPrimaryRows) {
      if (row.associatedLoanId) {
        existingPrimaryByLoan.set(row.associatedLoanId, row);
      }
    }

    const existingSecondaryRows = await this.secondaryAggRepo.find({
      where: { customerId },
    });
    const existingSecondaryByLoan = new Map<string, SecondaryGstAggregation>();
    for (const row of existingSecondaryRows) {
      if (row.associatedLoanId) {
        existingSecondaryByLoan.set(row.associatedLoanId, row);
      }
    }

    const trackRecords = await this.gstrTrackComplianceModel
      .find({ customerId })
      .lean()
      .exec();

    const primaryRowsToSave: Partial<PrimaryGstAggregation>[] = [];
    const secondaryRowsToSave: Partial<SecondaryGstAggregation>[] = [];

    for (const [loanId, loanUploadRows] of this.groupUploadRowsByLoan(
      uploadRows,
    )) {
      const loanTrackRecords = trackRecords.filter(
        (record) => String(record.loanId ?? '').trim() === loanId,
      );

      const primaryPans =
        this.collectDistinctPrimaryPansForLoan(loanUploadRows);
      if (primaryPans.length > 0) {
        const primaryMetrics =
          computePrimaryGstrTrackAggregationMetricsForPans(
            primaryPans,
            loanTrackRecords as Array<Record<string, any>>,
          );

        const existingPrimary = existingPrimaryByLoan.get(loanId) ?? null;
        const mergedPrimaryJson = mergeAggregationVariable(
          existingPrimary?.aggregationVariable ?? null,
          {
            ...preserveMetricKeys(
              existingPrimary?.aggregationVariable ?? null,
              PRIMARY_GSTR_TRACK_METRIC_KEYS,
            ),
            ...(primaryMetrics as unknown as Record<string, unknown>),
          },
        );

        primaryRowsToSave.push({
          ...(existingPrimary?.id ? { id: existingPrimary.id } : {}),
          customerId,
          associatedLoanId: loanId,
          aggregationVariable: mergedPrimaryJson,
        });
      }

      const consideredPans =
        this.collectDistinctConsideredPansForLoan(loanUploadRows);
      if (consideredPans.length === 0) {
        continue;
      }

      const metrics = computeConsideredGstrTrackAggregationMetricsForPans(
        consideredPans,
        loanTrackRecords as Array<Record<string, any>>,
      );

      const existingSecondary = existingSecondaryByLoan.get(loanId) ?? null;
      const mergedSecondaryJson = mergeAggregationVariable(
        existingSecondary?.aggregationVariable ?? null,
        {
          ...preserveMetricKeys(
            existingSecondary?.aggregationVariable ?? null,
            CONSIDERED_GSTR_TRACK_METRIC_KEYS,
          ),
          ...(metrics as unknown as Record<string, unknown>),
        },
      );

      secondaryRowsToSave.push({
        ...(existingSecondary?.id ? { id: existingSecondary.id } : {}),
        customerId,
        associatedLoanId: loanId,
        aggregationVariable: mergedSecondaryJson,
      });
    }

    const dedupedPrimaryRows =
      this.dedupePrimaryRowsByLoanId(primaryRowsToSave);
    const dedupedSecondaryRows =
      this.dedupeSecondaryRowsByLoanId(secondaryRowsToSave);

    if (dedupedPrimaryRows.length > 0) {
      await this.aggregationHistoryService.upsertPrimaryAggregation(
        this.primaryAggRepo,
        dedupedPrimaryRows,
        existingPrimaryByLoan,
        HISTORY_SOURCE_GSTR_TRACK,
      );
    }

    if (dedupedSecondaryRows.length > 0) {
      await this.aggregationHistoryService.upsertSecondaryAggregation(
        this.secondaryAggRepo,
        dedupedSecondaryRows,
        existingSecondaryByLoan,
        HISTORY_SOURCE_GSTR_TRACK,
      );
    }

    this.logger.log(
      `customerId=${customerId}: merged GSTR track metrics into ${dedupedPrimaryRows.length} primary and ${dedupedSecondaryRows.length} secondary aggregation row(s).`,
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

   * PRIMARY_TOTAL_GST_COUNT = COUNT(primary_gst_no) GROUP BY associated_loan_id.

   * Exactly one primary row per customer + loan.

   */

  private async aggregatePrimaryGst(

    context: CustomerComplianceContext,

    allComplianceRecords: GstComplianceRecord[],

  ): Promise<void> {

    const existingRows = await this.primaryAggRepo.find({

      where: { customerId: context.customerId },

    });

    const existingByLoan = new Map<string, string | null>();
    for (const row of existingRows) {
      if (row.associatedLoanId) {
        existingByLoan.set(row.associatedLoanId, row.aggregationVariable ?? null);
      }
    }

    const uploadRows = await this.getUploadRowsForCustomer(
      context.customerId,
      context.sourceTable,
    );

    if (uploadRows.length === 0) {
      await this.aggregationHistoryService.replacePrimaryAggregation(
        this.primaryAggRepo,
        context.customerId,
        [],
        HISTORY_SOURCE_VERIFY_FETCH,
      );
      return;
    }

    const rowsByLoan = new Map<string, Partial<PrimaryGstAggregation>>();

    for (const [loanId, loanUploadRows] of this.groupUploadRowsByLoan(
      uploadRows,
    )) {
      const totalGstCount = this.countPrimaryGstinsForLoan(loanUploadRows);
      const loanComplianceRecords = this.getLoanPrimaryComplianceRecords(
        loanId,
        allComplianceRecords,
      );

      if (totalGstCount === 0 && loanComplianceRecords.length === 0) {
        continue;
      }

      const metrics =
        this.computePrimaryAggregationMetrics(loanComplianceRecords);
      metrics.PRIMARY_TOTAL_GST_COUNT = totalGstCount;

      const existingJson = existingByLoan.get(loanId) ?? null;
      const aggregationObject = this.buildAggregationObject(
        existingJson,
        PRIMARY_GST_COMPLIANCE_METRIC_KEYS,
        metrics,
      );

      rowsByLoan.set(loanId, {
        customerId: context.customerId,
        associatedLoanId: loanId,
        aggregationVariable: aggregationObject,
      });
    }

    const rows = Array.from(rowsByLoan.values());

    await this.aggregationHistoryService.replacePrimaryAggregation(
      this.primaryAggRepo,
      context.customerId,
      rows,
      HISTORY_SOURCE_VERIFY_FETCH,
    );

    this.logger.log(
      `customerId=${context.customerId}: wrote ${rows.length} primary_gst_aggregation row(s).`,
    );
  }

  /**

   * CONSIDERED_ENTITY aggregation → secondary_gst_aggregation table.

   * Loan-scoped CONSIDERED_* compliance metrics (verify-and-fetch):

   * - TOTAL/ACTIVE/CANCELLED/SUSPENDED = COUNT(DISTINCT considered_entity_gst_no)

   * - ADDRESS_CHANGE_COUNT = SUM(address changes per GSTIN)

   * - EINVOICE counts from einvoice applicable / enabled status

   * Exactly one secondary row per customer + loan.

   */

  private async aggregateSecondaryGst(

    context: CustomerComplianceContext,

    allComplianceRecords: GstComplianceRecord[],

  ): Promise<void> {

    const existingRows = await this.secondaryAggRepo.find({
      where: { customerId: context.customerId },
    });
    const existingByLoan = new Map<string, string | null>();
    for (const row of existingRows) {
      if (row.associatedLoanId) {
        existingByLoan.set(row.associatedLoanId, row.aggregationVariable ?? null);
      }
    }

    const uploadRows = await this.getUploadRowsForCustomer(
      context.customerId,
      context.sourceTable,
    );

    if (uploadRows.length === 0) {
      await this.aggregationHistoryService.replaceSecondaryAggregation(
        this.secondaryAggRepo,
        context.customerId,
        [],
        HISTORY_SOURCE_VERIFY_FETCH,
      );
      return;
    }

    const rowsByLoan = new Map<string, Partial<SecondaryGstAggregation>>();

    for (const [loanId, loanUploadRows] of this.groupUploadRowsByLoan(
      uploadRows,
    )) {
      const consideredUploadRows =
        this.filterUploadRowsWithConsideredPan(loanUploadRows);
      const loanComplianceRecords =
        this.getLoanConsideredEntityComplianceRecords(
          loanId,
          allComplianceRecords,
        );

      if (
        consideredUploadRows.length === 0 &&
        loanComplianceRecords.length === 0
      ) {
        continue;
      }

      const metrics = this.computeConsideredComplianceAggregationMetrics(
        consideredUploadRows,
        loanComplianceRecords,
      );

      const existingJson = existingByLoan.get(loanId) ?? null;
      let aggregationObject = this.buildAggregationObject(
        existingJson,
        CONSIDERED_GST_COMPLIANCE_METRIC_KEYS,
        metrics,
      );
      aggregationObject = this.removeAggregationKeys(
        aggregationObject,
        OBSOLETE_SECONDARY_COMPLIANCE_KEYS,
      );

      rowsByLoan.set(loanId, {
        customerId: context.customerId,
        associatedLoanId: loanId,
        aggregationVariable: aggregationObject,
      });
    }

    const rows = Array.from(rowsByLoan.values());

    await this.aggregationHistoryService.replaceSecondaryAggregation(
      this.secondaryAggRepo,
      context.customerId,
      rows,
      HISTORY_SOURCE_VERIFY_FETCH,
    );

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

  ): ConsideredComplianceAggregationMetrics {

    return this.computeConsideredComplianceAggregationMetrics([], records);
  }

  /**
   * Loan-level CONSIDERED_* metrics for verify-and-fetch secondary aggregation.
   * Upload rows must already be filtered to considered_entity_pan present where
   * DISTINCT GSTIN counts come from the upload table; status/e-invoice/address
   * come from Mongo compliance docs for CONSIDERED_ENTITY on that loan.
   */
  computeConsideredComplianceAggregationMetrics(
    consideredUploadRows: UploadRow[],
    complianceRecords: GstComplianceRecord[],
  ): ConsideredComplianceAggregationMetrics {
    const totalGstCount =
      this.countDistinctConsideredGstinsForLoan(consideredUploadRows);

    const uploadGstins = new Set(
      consideredUploadRows
        .map((row) =>
          String(row.considered_entity_gst_no ?? '')
            .trim()
            .toUpperCase(),
        )
        .filter(Boolean),
    );

    const scopedComplianceRecords =
      uploadGstins.size === 0
        ? complianceRecords
        : complianceRecords.filter((record) =>
            uploadGstins.has(String(record.gstin ?? '').trim().toUpperCase()),
          );

    const metrics = this.computePanLevelMetrics(scopedComplianceRecords);

    return {
      CONSIDERED_TOTAL_GST_COUNT: totalGstCount,
      CONSIDERED_ACTIVE_GST_COUNT: metrics.activeGstCount,
      CONSIDERED_CANCELLED_GST_COUNT: metrics.cancelledGstCount,
      CONSIDERED_SUSPENDED_GST_COUNT: metrics.suspendedGstCount,
      CONSIDERED_ADDRESS_CHANGE_COUNT: metrics.addressChangeCount,
      CONSIDERED_TOTAL_EINVOICE_COUNT: metrics.totalEinvoiceCount,
      CONSIDERED_EINVOICE_ENABLED_COUNT: metrics.einvoiceEnabledCount,
    };
  }

  private computePanLevelMetrics(

    records: GstComplianceRecord[],

  ): PanLevelMetricValues {

    const distinctGstins = new Set<string>();

    const activeGstins = new Set<string>();

    const cancelledGstins = new Set<string>();

    const suspendedGstins = new Set<string>();

    const einvoiceApplicableGstins = new Set<string>();

    const einvoiceEnabledGstins = new Set<string>();

    const addressKeysByGstin = new Map<string, Set<string>>();

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

      if (this.extractEinvoiceApplicable(record) === 'YES') {

        einvoiceApplicableGstins.add(gstin);

      }

      if (this.extractEinvoiceStatus(record) === 'ENABLED') {

        einvoiceEnabledGstins.add(gstin);

      }

      const addressKeys = addressKeysByGstin.get(gstin) ?? new Set<string>();
      for (const key of this.collectAddressKeys(record)) {
        if (key) {
          addressKeys.add(key);
        }
      }
      addressKeysByGstin.set(gstin, addressKeys);
    }

    let addressChangeCount = 0;
    for (const keys of addressKeysByGstin.values()) {
      // Distinct addresses beyond the principal one ≈ modification events.
      addressChangeCount += Math.max(0, keys.size - 1);
    }

    return {

      totalGstCount: distinctGstins.size,

      activeGstCount: activeGstins.size,

      cancelledGstCount: cancelledGstins.size,

      suspendedGstCount: suspendedGstins.size,

      addressChange: addressChangeCount > 0,

      addressChangeCount,

      totalEinvoiceCount: einvoiceApplicableGstins.size,

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

    return this.extractEinvoiceApplicable(record);
  }

  /**
   * einvoice_applicable = YES when Sandbox marks e-invoice as applicable.
   */
  private extractEinvoiceApplicable(
    record: GstComplianceRecord,
  ): 'YES' | 'NO' | null {
    const search = this.extractSearchData(record);
    const raw =
      search?.einvoiceApplicable ??
      search?.einvoice_applicable ??
      search?.einvoiceStatus ??
      search?.einvoice_status;

    if (raw === undefined || raw === null || raw === '') {
      return null;
    }

    const normalized = String(raw).trim().toUpperCase();
    if (
      normalized === 'YES' ||
      normalized === 'Y' ||
      normalized === 'ENABLED' ||
      normalized === 'TRUE' ||
      normalized === '1'
    ) {
      return 'YES';
    }

    return 'NO';
  }

  /**
   * einvoice_status = ENABLED when e-invoice generation is enabled.
   */
  private extractEinvoiceStatus(
    record: GstComplianceRecord,
  ): 'ENABLED' | null {
    const search = this.extractSearchData(record);
    const raw = search?.einvoiceStatus ?? search?.einvoice_status;

    if (raw === undefined || raw === null || raw === '') {
      return null;
    }

    const normalized = String(raw).trim().toUpperCase();
    if (
      normalized === 'ENABLED' ||
      normalized === 'YES' ||
      normalized === 'Y'
    ) {
      return 'ENABLED';
    }

    return null;
  }

  private collectAddressKeys(record: GstComplianceRecord): string[] {
    const search = this.extractSearchData(record);
    const keys: string[] = [];

    const principal = this.buildAddressKeyFromAddr(search?.pradr?.addr);
    if (principal) {
      keys.push(principal);
    }

    const additional = Array.isArray(search?.adadr) ? search.adadr : [];
    for (const entry of additional) {
      const key = this.buildAddressKeyFromAddr(entry?.addr ?? entry);
      if (key) {
        keys.push(key);
      }
    }

    return keys;
  }

  private buildAddressKeyFromAddr(addr: Record<string, any> | null | undefined): string {
    if (!addr || typeof addr !== 'object') {
      return '';
    }

    return [
      String(addr.st ?? '').trim(),
      String(addr.loc ?? addr.locality ?? '').trim(),
      String(addr.dst ?? '').trim(),
      String(addr.stcd ?? '').trim(),
      String(addr.pncd ?? '').trim(),
    ].join('|');
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

  private groupUploadRowsByLoan(
    uploadRows: UploadRow[],
  ): Map<string, UploadRow[]> {
    const rowsByLoan = new Map<string, UploadRow[]>();

    for (const row of uploadRows) {
      const loanId = row.associated_loan_id;
      const existing = rowsByLoan.get(loanId) ?? [];
      existing.push(row);
      rowsByLoan.set(loanId, existing);
    }

    return rowsByLoan;
  }

  /**
   * COUNT(primary_gst_no) for all upload rows on a loan (not distinct).
   */
  private countPrimaryGstinsForLoan(loanRows: UploadRow[]): number {
    let count = 0;

    for (const row of loanRows) {
      const gstin = String(row.primary_gst_no ?? '').trim();
      if (gstin) {
        count++;
      }
    }

    return count;
  }

  /**
   * COUNT(DISTINCT considered_entity_gst_no) for upload rows on a loan where
   * considered_entity_pan is present and gstin is non-empty.
   */
  private countDistinctConsideredGstinsForLoan(loanRows: UploadRow[]): number {
    const gstins = new Set<string>();

    for (const row of this.filterUploadRowsWithConsideredPan(loanRows)) {
      const gstin = String(row.considered_entity_gst_no ?? '')
        .trim()
        .toUpperCase();
      if (gstin) {
        gstins.add(gstin);
      }
    }

    return gstins.size;
  }

  private filterUploadRowsWithConsideredPan(loanRows: UploadRow[]): UploadRow[] {
    return loanRows.filter((row) => this.normalizePan(row.considered_entity_pan));
  }

  private collectDistinctPrimaryPansForLoan(loanRows: UploadRow[]): string[] {
    const pans = new Set<string>();
    for (const row of loanRows) {
      const pan = this.normalizePan(row.primary_pan);
      if (pan) {
        pans.add(pan);
      }
    }
    return Array.from(pans);
  }

  private collectDistinctConsideredPansForLoan(loanRows: UploadRow[]): string[] {
    const pans = new Set<string>();
    for (const row of this.filterUploadRowsWithConsideredPan(loanRows)) {
      const pan = this.normalizePan(row.considered_entity_pan);
      if (pan) {
        pans.add(pan);
      }
    }
    return Array.from(pans);
  }

  /**
   * COUNT(considered_entity_gst_no) for all upload rows on a loan (not distinct).
   * @deprecated Prefer countDistinctConsideredGstinsForLoan
   */
  private countConsideredGstinsForLoan(loanRows: UploadRow[]): number {
    return this.countDistinctConsideredGstinsForLoan(loanRows);
  }

  private getLoanPrimaryComplianceRecords(
    loanId: string,
    allComplianceRecords: GstComplianceRecord[],
  ): GstComplianceRecord[] {
    const normalizedLoanId = String(loanId ?? '').trim();

    return allComplianceRecords.filter((record) => {
      if (String(record.loanId ?? '').trim() !== normalizedLoanId) {
        return false;
      }

      return (
        String(record.entityType ?? '').trim().toUpperCase() === 'PRIMARY'
      );
    });
  }

  private getLoanConsideredEntityComplianceRecords(
    loanId: string,
    allComplianceRecords: GstComplianceRecord[],
  ): GstComplianceRecord[] {
    const normalizedLoanId = String(loanId ?? '').trim();

    return allComplianceRecords.filter((record) => {
      if (String(record.loanId ?? '').trim() !== normalizedLoanId) {
        return false;
      }

      return (
        String(record.entityType ?? '').trim().toUpperCase() ===
        'CONSIDERED_ENTITY'
      );
    });
  }

  private parseAggregationVariable(
    value: string | null | undefined,
  ): Record<string, unknown> {
    if (!value) {
      return {};
    }

    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }

    return {};
  }

  private dedupePrimaryRowsByLoanId(
    rows: Partial<PrimaryGstAggregation>[],
  ): Partial<PrimaryGstAggregation>[] {
    const byLoan = new Map<string, Partial<PrimaryGstAggregation>>();

    for (const row of rows) {
      const loanId = String(row.associatedLoanId ?? '').trim();
      if (!loanId) {
        continue;
      }

      const existing = byLoan.get(loanId);
      if (!existing) {
        byLoan.set(loanId, row);
        continue;
      }

      byLoan.set(loanId, {
        ...existing,
        ...row,
        id: existing.id ?? row.id,
        aggregationVariable: mergeAggregationVariable(
          existing.aggregationVariable ?? null,
          this.parseAggregationVariable(row.aggregationVariable),
        ),
      });
    }

    return Array.from(byLoan.values());
  }

  private dedupeSecondaryRowsByLoanId(
    rows: Partial<SecondaryGstAggregation>[],
  ): Partial<SecondaryGstAggregation>[] {
    const byLoan = new Map<string, Partial<SecondaryGstAggregation>>();

    for (const row of rows) {
      const loanId = String(row.associatedLoanId ?? '').trim();
      if (!loanId) {
        continue;
      }

      const existing = byLoan.get(loanId);
      if (!existing) {
        byLoan.set(loanId, row);
        continue;
      }

      byLoan.set(loanId, {
        ...existing,
        ...row,
        id: existing.id ?? row.id,
        aggregationVariable: mergeAggregationVariable(
          existing.aggregationVariable ?? null,
          this.parseAggregationVariable(row.aggregationVariable),
        ),
      });
    }

    return Array.from(byLoan.values());
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



    return dbRows

      .map((row) => ({

        customer_id: (row.customer_id ?? '').trim(),

        associated_loan_id: (row.associated_loan_id ?? '').trim(),

        primary_pan: row.primary_pan ?? null,

        primary_gst_no: row.primary_gst_no ?? null,

        considered_entity_pan: row.considered_entity_pan ?? null,

        considered_entity_gst_no: row.considered_entity_gst_no ?? null,

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

  private removeAggregationKeys(
    jsonValue: string | null | undefined,
    keys: readonly string[],
  ): string {
    if (!jsonValue) {
      return JSON.stringify({});
    }
    try {
      const parsed = JSON.parse(jsonValue) as Record<string, unknown>;
      for (const key of keys) {
        delete parsed[key];
      }
      return JSON.stringify(parsed);
    } catch {
      return jsonValue;
    }
  }

}


