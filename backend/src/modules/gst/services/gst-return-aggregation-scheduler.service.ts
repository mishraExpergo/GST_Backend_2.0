import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { GstAggregationService } from './gst-aggregation.service';
import {
  GstReturnPersistenceService,
  GstReturnType,
} from './gst-return-persistence.service';
import { Gstr1ComplianceRecord } from '../schemas/gst-gstr1-compliance.schema';
import { Gstr2bComplianceRecord } from '../schemas/gst-gstr2b-compliance.schema';
import { Gstr3bComplianceRecord } from '../schemas/gst-gstr3b-compliance.schema';

export type SchedulerReturnType = GstReturnType | 'ALL';

export interface ReturnAggregationSchedulerParams {
  returnType?: SchedulerReturnType;
  year: number;
  month?: number;
  customerId?: string;
  loanId?: string;
  tableName?: string;
}

export interface LoanCompletionStatus {
  customerId: string;
  loanId: string;
  returnType: GstReturnType;
  year: number;
  month?: number;
  expectedGstins: string[];
  storedGstins: string[];
  missingGstins: string[];
  complete: boolean;
  aggregated: boolean;
}

export interface ReturnAggregationSchedulerResult {
  sourceTable: string;
  year: number;
  month?: number;
  loansChecked: number;
  loansComplete: number;
  customersAggregated: string[];
  details: LoanCompletionStatus[];
}

@Injectable()
export class GstReturnAggregationSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(GstReturnAggregationSchedulerService.name);
  private intervalRef: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly persistenceService: GstReturnPersistenceService,
    private readonly aggregationService: GstAggregationService,
    @Optional()
    @InjectModel(Gstr1ComplianceRecord.name)
    private readonly gstr1Model?: Model<Gstr1ComplianceRecord>,
    @Optional()
    @InjectModel(Gstr2bComplianceRecord.name)
    private readonly gstr2bModel?: Model<Gstr2bComplianceRecord>,
    @Optional()
    @InjectModel(Gstr3bComplianceRecord.name)
    private readonly gstr3bModel?: Model<Gstr3bComplianceRecord>,
  ) {}

  onModuleInit(): void {
    const enabled =
      this.config.get<string>('GST_RETURN_AGGREGATION_SCHEDULER_ENABLED', 'false') ===
      'true';
    if (!enabled) {
      return;
    }

    const intervalMs = Number(
      this.config.get('GST_RETURN_AGGREGATION_SCHEDULER_INTERVAL_MS', '300000'),
    );
    this.intervalRef = setInterval(() => {
      void this.runFromEnvConfig();
    }, intervalMs);
    this.logger.log(
      `Return aggregation scheduler enabled (interval ${intervalMs}ms).`,
    );
  }

  onModuleDestroy(): void {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = null;
    }
  }

  async run(
    params: ReturnAggregationSchedulerParams,
  ): Promise<ReturnAggregationSchedulerResult> {
    if (!this.gstr1Model || !this.gstr2bModel || !this.gstr3bModel) {
      throw new Error(
        'MongoDB is not enabled. Set ENABLE_MONGO=true to run return aggregation scheduler.',
      );
    }

    const sourceTable = this.persistenceService.resolveSourceTable(params.tableName);
    const year = Number(params.year);
    const month = params.month !== undefined ? Number(params.month) : undefined;
    const returnType = params.returnType ?? 'ALL';

    if (!Number.isInteger(year) || year < 2017 || year > 2100) {
      throw new Error(`Invalid year "${params.year}".`);
    }

    const types: GstReturnType[] =
      returnType === 'ALL'
        ? ['GSTR-1', 'GSTR-2B', 'GSTR-3B']
        : [returnType];

    const loanPairs = await this.persistenceService.listLoanPairs(sourceTable);
    const filteredPairs = loanPairs.filter((pair) => {
      if (params.customerId && pair.customerId !== params.customerId.trim()) {
        return false;
      }
      if (params.loanId && pair.loanId !== params.loanId.trim()) {
        return false;
      }
      return true;
    });

    const details: LoanCompletionStatus[] = [];
    const gstr1Customers = new Set<string>();
    const gstr2bCustomers = new Set<string>();
    const gstr3bCustomers = new Set<string>();

    for (const pair of filteredPairs) {
      for (const type of types) {
        const status = await this.evaluateLoanCompletion(
          pair.customerId,
          pair.loanId,
          type,
          year,
          month,
          sourceTable,
        );
        details.push(status);
        if (!status.complete) {
          continue;
        }
        if (type === 'GSTR-1') {
          gstr1Customers.add(pair.customerId);
        } else if (type === 'GSTR-2B') {
          gstr2bCustomers.add(pair.customerId);
        } else {
          gstr3bCustomers.add(pair.customerId);
        }
      }
    }

    const customersAggregated: string[] = [];
    const aggregateTargets = new Set<string>([
      ...gstr1Customers,
      ...gstr2bCustomers,
      ...gstr3bCustomers,
    ]);

    for (const customerId of aggregateTargets) {
      try {
        let aggregatedForCustomer = false;
        if (
          (returnType === 'ALL' || returnType === 'GSTR-1') &&
          gstr1Customers.has(customerId)
        ) {
          await this.aggregationService.runGstr1AggregationForCustomer(
            customerId,
            sourceTable,
          );
          aggregatedForCustomer = true;
        }
        if (
          (returnType === 'ALL' || returnType === 'GSTR-2B') &&
          gstr2bCustomers.has(customerId)
        ) {
          await this.aggregationService.runGstr2bAggregationForCustomer(
            customerId,
            sourceTable,
          );
          aggregatedForCustomer = true;
        }
        if (
          (returnType === 'ALL' || returnType === 'GSTR-3B') &&
          gstr3bCustomers.has(customerId)
        ) {
          await this.aggregationService.runGstr3bAggregationForCustomer(
            customerId,
            sourceTable,
          );
          aggregatedForCustomer = true;
        }
        if (aggregatedForCustomer) {
          customersAggregated.push(customerId);
        }
      } catch (err) {
        this.logger.error(
          `Aggregation failed for customerId=${customerId}: ${(err as Error).message}`,
        );
      }
    }

    for (const detail of details) {
      const typeReady =
        (detail.returnType === 'GSTR-1' && gstr1Customers.has(detail.customerId)) ||
        (detail.returnType === 'GSTR-2B' && gstr2bCustomers.has(detail.customerId)) ||
        (detail.returnType === 'GSTR-3B' && gstr3bCustomers.has(detail.customerId));
      detail.aggregated = detail.complete && typeReady;
    }

    return {
      sourceTable,
      year,
      month,
      loansChecked: filteredPairs.length,
      loansComplete: details.filter((detail) => detail.complete).length,
      customersAggregated: Array.from(new Set(customersAggregated)),
      details,
    };
  }

  private async evaluateLoanCompletion(
    customerId: string,
    loanId: string,
    returnType: GstReturnType,
    year: number,
    month: number | undefined,
    sourceTable: string,
  ): Promise<LoanCompletionStatus> {
    const expectedUnits = await this.persistenceService.getExpectedUnitsForLoan(
      customerId,
      loanId,
      sourceTable,
    );
    const expectedGstins = expectedUnits.map((unit) => unit.gstin);

    if (month === undefined) {
      const completeGstins: string[] = [];
      const missingGstins: string[] = [];

      for (const gstin of expectedGstins) {
        const isComplete = await this.persistenceService.isGstinYearComplete(
          returnType,
          loanId,
          gstin,
          year,
        );
        if (isComplete) {
          completeGstins.push(gstin);
        } else {
          missingGstins.push(gstin);
        }
      }

      return {
        customerId,
        loanId,
        returnType,
        year,
        month,
        expectedGstins,
        storedGstins: completeGstins,
        missingGstins,
        complete: expectedGstins.length > 0 && missingGstins.length === 0,
        aggregated: false,
      };
    }

    const storedGstins = await this.getStoredGstinsForLoan(
      returnType,
      loanId,
      year,
      month,
    );
    const storedSet = new Set(storedGstins);
    const missingGstins = expectedGstins.filter((gstin) => !storedSet.has(gstin));

    return {
      customerId,
      loanId,
      returnType,
      year,
      month,
      expectedGstins,
      storedGstins,
      missingGstins,
      complete: expectedGstins.length > 0 && missingGstins.length === 0,
      aggregated: false,
    };
  }

  private async getStoredGstinsForLoan(
    returnType: GstReturnType,
    loanId: string,
    year: number,
    month: number,
  ): Promise<string[]> {
    if (returnType === 'GSTR-1') {
      const docs = await this.gstr1Model!
        .find({ loanId, year, month })
        .select('gstin')
        .lean()
        .exec();
      return docs.map((doc) => String(doc.gstin ?? '').trim().toUpperCase()).filter(Boolean);
    }

    if (returnType === 'GSTR-2B') {
      const docs = await this.gstr2bModel!
        .find({ loanId, year, month })
        .select('gstin')
        .lean()
        .exec();
      return docs.map((doc) => String(doc.gstin ?? '').trim().toUpperCase()).filter(Boolean);
    }

    const docs = await this.gstr3bModel!
      .find({ loanId, year, month })
      .select('gstin')
      .lean()
      .exec();
    return docs.map((doc) => String(doc.gstin ?? '').trim().toUpperCase()).filter(Boolean);
  }

  private async runFromEnvConfig(): Promise<void> {
    const year = Number(this.config.get('GST_RETURN_AGGREGATION_SCHEDULER_YEAR', ''));
    const month = Number(this.config.get('GST_RETURN_AGGREGATION_SCHEDULER_MONTH', ''));
    if (!Number.isInteger(year)) {
      this.logger.warn(
        'Scheduled return aggregation skipped: GST_RETURN_AGGREGATION_SCHEDULER_YEAR is not set.',
      );
      return;
    }

    try {
      const result = await this.run({
        returnType: 'ALL',
        year,
        month: Number.isInteger(month) ? month : undefined,
      });
      this.logger.log(
        `Scheduled return aggregation finished: ${result.loansComplete}/${result.loansChecked} loan checks complete; aggregated customers=${result.customersAggregated.join(', ') || 'none'}`,
      );
    } catch (err) {
      this.logger.error(
        `Scheduled return aggregation failed: ${(err as Error).message}`,
      );
    }
  }
}
