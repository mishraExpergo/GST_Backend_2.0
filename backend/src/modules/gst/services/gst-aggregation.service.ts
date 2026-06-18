import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { GstService } from '../gst.service';
import { GstComplianceRecord } from '../schemas/gst-compliance.schema';
import { PrimaryGstAggregation } from '../../../entities/primary-gst-aggregation.entity';
import { SecondaryGstAggregation } from '../../../entities/secondary-gst-aggregation.entity';

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

/** Mongo compliance docs grouped for a customer, ready for aggregation. */
export interface CustomerComplianceContext {
  customerId: string;
  sourceTable: string;
  primaryRecords: GstComplianceRecord[];
  secondaryRecords: GstComplianceRecord[];
}

const VERIFY_FETCH_OPERATION = 'GSTIN_VERIFY_AND_FETCH';

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
    await this.aggregatePrimaryGst(context);
    await this.aggregateSecondaryGst(context);

    this.logger.log(`customerId=${customerId}: aggregation finished.`);
  }

  // -------------------- aggregation hooks (logic TBD) --------------------

  /**
   * PRIMARY entity aggregation → primary_gst_aggregation table.
   * Replace the placeholder body once business rules are defined.
   */
  private async aggregatePrimaryGst(
    context: CustomerComplianceContext,
  ): Promise<void> {
    await this.primaryAggRepo.delete({ customerId: context.customerId });

    const rows: Partial<PrimaryGstAggregation>[] = [];

    for (const record of context.primaryRecords) {
      const aggregationVariable = this.computePrimaryAggregationVariable(record);

      rows.push({
        customerId: context.customerId,
        associatedLoanId: record.loanId,
        primaryGstNo: record.gstin,
        aggregationVariable,
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
   * Replace the placeholder body once business rules are defined.
   */
  private async aggregateSecondaryGst(
    context: CustomerComplianceContext,
  ): Promise<void> {
    await this.secondaryAggRepo.delete({ customerId: context.customerId });

    const rows: Partial<SecondaryGstAggregation>[] = [];

    for (const record of context.secondaryRecords) {
      const aggregationVariable =
        this.computeSecondaryAggregationVariable(record);

      rows.push({
        customerId: context.customerId,
        associatedLoanId: record.loanId,
        consideredEntityGstNo: record.gstin,
        aggregationVariable,
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
   * TODO: implement primary GST aggregation rules.
   * `record` contains verifyResponse + searchResponse from Mongo.
   */
  private computePrimaryAggregationVariable(
    record: GstComplianceRecord,
  ): string | null {
    // Placeholder — return null until business logic is provided.
    void record;
    return null;
  }

  /**
   * TODO: implement secondary (considered-entity) aggregation rules.
   */
  private computeSecondaryAggregationVariable(
    record: GstComplianceRecord,
  ): string | null {
    void record;
    return null;
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
}
