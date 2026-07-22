import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PrimaryGstAggregation } from '../../../entities/primary-gst-aggregation.entity';
import {
  AggregationChangeType,
  PrimaryGstAggregationHistory,
} from '../../../entities/primary-gst-aggregation-history.entity';
import { SecondaryGstAggregation } from '../../../entities/secondary-gst-aggregation.entity';
import { SecondaryGstAggregationHistory } from '../../../entities/secondary-gst-aggregation-history.entity';

@Injectable()
export class GstAggregationHistoryService {
  private readonly logger = new Logger(GstAggregationHistoryService.name);

  constructor(
    @InjectRepository(PrimaryGstAggregationHistory)
    private readonly primaryHistoryRepo: Repository<PrimaryGstAggregationHistory>,
    @InjectRepository(SecondaryGstAggregationHistory)
    private readonly secondaryHistoryRepo: Repository<SecondaryGstAggregationHistory>,
  ) {}

  async replacePrimaryAggregation(
    repo: Repository<PrimaryGstAggregation>,
    customerId: string,
    rows: Partial<PrimaryGstAggregation>[],
    changeSource: string,
  ): Promise<PrimaryGstAggregation[]> {
    const before = await repo.find({ where: { customerId } });
    if (before.length > 0) {
      await this.recordPrimaryDeletes(before, changeSource);
      await repo.delete({ customerId });
    }

    if (rows.length === 0) {
      return [];
    }

    const saved = await repo.save(rows);
    await this.recordPrimaryInserts(saved, changeSource);
    return saved;
  }

  async replaceSecondaryAggregation(
    repo: Repository<SecondaryGstAggregation>,
    customerId: string,
    rows: Partial<SecondaryGstAggregation>[],
    changeSource: string,
  ): Promise<SecondaryGstAggregation[]> {
    const before = await repo.find({ where: { customerId } });
    if (before.length > 0) {
      await this.recordSecondaryDeletes(before, changeSource);
      await repo.delete({ customerId });
    }

    if (rows.length === 0) {
      return [];
    }

    const saved = await repo.save(rows);
    await this.recordSecondaryInserts(saved, changeSource);
    return saved;
  }

  async upsertPrimaryAggregation(
    repo: Repository<PrimaryGstAggregation>,
    rows: Partial<PrimaryGstAggregation>[],
    existingByLoan: Map<string | null, PrimaryGstAggregation>,
    changeSource: string,
  ): Promise<PrimaryGstAggregation[]> {
    if (rows.length === 0) {
      return [];
    }

    const rowsByLoan = new Map<string, Partial<PrimaryGstAggregation>>();
    for (const row of rows) {
      const loanId = String(row.associatedLoanId ?? '').trim();
      if (!loanId) {
        continue;
      }
      rowsByLoan.set(loanId, row);
    }
    const dedupedRows = Array.from(rowsByLoan.values());

    const historyRows: Partial<PrimaryGstAggregationHistory>[] = [];
    for (const row of dedupedRows) {
      const loanId = String(row.associatedLoanId ?? '').trim();
      if (!loanId) {
        continue;
      }

      const existing = existingByLoan.get(loanId) ?? null;
      const nextValue = row.aggregationVariable ?? null;
      const previousValue = existing?.aggregationVariable ?? null;

      if (existing) {
        if (previousValue === nextValue) {
          continue;
        }
        historyRows.push({
          aggregationId: existing.id,
          customerId: row.customerId ?? existing.customerId ?? null,
          associatedLoanId: loanId,
          aggregationVariable: nextValue,
          previousAggregationVariable: previousValue,
          changeType: 'UPDATE',
          changeSource,
        });
      } else {
        historyRows.push({
          aggregationId: null,
          customerId: row.customerId ?? null,
          associatedLoanId: loanId,
          aggregationVariable: nextValue,
          previousAggregationVariable: null,
          changeType: 'INSERT',
          changeSource,
        });
      }
    }

    const saved = await repo.save(dedupedRows);
    if (historyRows.length > 0) {
      await this.attachSavedPrimaryIds(historyRows, saved);
      await this.primaryHistoryRepo.save(historyRows);
      this.logger.debug(
        `Recorded ${historyRows.length} primary aggregation history row(s) [${changeSource}].`,
      );
    }

    return saved;
  }

  async upsertSecondaryAggregation(
    repo: Repository<SecondaryGstAggregation>,
    rows: Partial<SecondaryGstAggregation>[],
    existingByLoan: Map<string | null, SecondaryGstAggregation>,
    changeSource: string,
  ): Promise<SecondaryGstAggregation[]> {
    if (rows.length === 0) {
      return [];
    }

    const rowsByLoan = new Map<string, Partial<SecondaryGstAggregation>>();
    for (const row of rows) {
      const loanId = String(row.associatedLoanId ?? '').trim();
      if (!loanId) {
        continue;
      }
      rowsByLoan.set(loanId, row);
    }
    const dedupedRows = Array.from(rowsByLoan.values());

    const historyRows: Partial<SecondaryGstAggregationHistory>[] = [];
    for (const row of dedupedRows) {
      const loanId = String(row.associatedLoanId ?? '').trim();
      if (!loanId) {
        continue;
      }

      const existing = existingByLoan.get(loanId) ?? null;
      const nextValue = row.aggregationVariable ?? null;
      const previousValue = existing?.aggregationVariable ?? null;

      if (existing) {
        if (previousValue === nextValue) {
          continue;
        }
        historyRows.push({
          aggregationId: existing.id,
          customerId: row.customerId ?? existing.customerId ?? null,
          associatedLoanId: loanId,
          aggregationVariable: nextValue,
          previousAggregationVariable: previousValue,
          changeType: 'UPDATE',
          changeSource,
        });
      } else {
        historyRows.push({
          aggregationId: null,
          customerId: row.customerId ?? null,
          associatedLoanId: loanId,
          aggregationVariable: nextValue,
          previousAggregationVariable: null,
          changeType: 'INSERT',
          changeSource,
        });
      }
    }

    const saved = await repo.save(dedupedRows);
    if (historyRows.length > 0) {
      await this.attachSavedSecondaryIds(historyRows, saved);
      await this.secondaryHistoryRepo.save(historyRows);
      this.logger.debug(
        `Recorded ${historyRows.length} secondary aggregation history row(s) [${changeSource}].`,
      );
    }

    return saved;
  }

  private async recordPrimaryDeletes(
    rows: PrimaryGstAggregation[],
    changeSource: string,
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    await this.primaryHistoryRepo.save(
      rows.map((row) => ({
        aggregationId: row.id,
        customerId: row.customerId,
        associatedLoanId: row.associatedLoanId,
        aggregationVariable: null,
        previousAggregationVariable: row.aggregationVariable,
        changeType: 'DELETE' as AggregationChangeType,
        changeSource,
      })),
    );
  }

  private async recordPrimaryInserts(
    rows: PrimaryGstAggregation[],
    changeSource: string,
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    await this.primaryHistoryRepo.save(
      rows.map((row) => ({
        aggregationId: row.id,
        customerId: row.customerId,
        associatedLoanId: row.associatedLoanId,
        aggregationVariable: row.aggregationVariable,
        previousAggregationVariable: null,
        changeType: 'INSERT' as AggregationChangeType,
        changeSource,
      })),
    );
    this.logger.debug(
      `Recorded ${rows.length} primary aggregation history row(s) [${changeSource}].`,
    );
  }

  private async recordSecondaryDeletes(
    rows: SecondaryGstAggregation[],
    changeSource: string,
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    await this.secondaryHistoryRepo.save(
      rows.map((row) => ({
        aggregationId: row.id,
        customerId: row.customerId,
        associatedLoanId: row.associatedLoanId,
        aggregationVariable: null,
        previousAggregationVariable: row.aggregationVariable,
        changeType: 'DELETE' as AggregationChangeType,
        changeSource,
      })),
    );
  }

  private async recordSecondaryInserts(
    rows: SecondaryGstAggregation[],
    changeSource: string,
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    await this.secondaryHistoryRepo.save(
      rows.map((row) => ({
        aggregationId: row.id,
        customerId: row.customerId,
        associatedLoanId: row.associatedLoanId,
        aggregationVariable: row.aggregationVariable,
        previousAggregationVariable: null,
        changeType: 'INSERT' as AggregationChangeType,
        changeSource,
      })),
    );
    this.logger.debug(
      `Recorded ${rows.length} secondary aggregation history row(s) [${changeSource}].`,
    );
  }

  private async attachSavedPrimaryIds(
    historyRows: Partial<PrimaryGstAggregationHistory>[],
    savedRows: PrimaryGstAggregation[],
  ): Promise<void> {
    const savedByLoan = new Map(
      savedRows.map((row) => [String(row.associatedLoanId ?? ''), row.id]),
    );

    for (const historyRow of historyRows) {
      if (historyRow.changeType !== 'INSERT') {
        continue;
      }
      const loanId = String(historyRow.associatedLoanId ?? '');
      historyRow.aggregationId = savedByLoan.get(loanId) ?? null;
    }
  }

  private async attachSavedSecondaryIds(
    historyRows: Partial<SecondaryGstAggregationHistory>[],
    savedRows: SecondaryGstAggregation[],
  ): Promise<void> {
    const savedByLoan = new Map(
      savedRows.map((row) => [String(row.associatedLoanId ?? ''), row.id]),
    );

    for (const historyRow of historyRows) {
      if (historyRow.changeType !== 'INSERT') {
        continue;
      }
      const loanId = String(historyRow.associatedLoanId ?? '');
      historyRow.aggregationId = savedByLoan.get(loanId) ?? null;
    }
  }
}
