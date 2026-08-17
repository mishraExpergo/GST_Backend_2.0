import {
  BadRequestException,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Gstr3bComplianceRecord } from '../schemas/gst-gstr3b-compliance.schema';
import { computePrimaryGstr3bAggregationMetrics } from './gst-gstr3b-aggregation.util';
import { toApiEntityType } from './gst-terminology.util';
import {
  buildRangeBlock,
  formatDateIso,
  formatFyLabel,
  getCurrentFyStartYear,
  type MonthGstRevenueFact,
} from './gst-dashboard-revenue-graph.util';

@Injectable()
export class GstDashboardRevenueGraphService {
  constructor(
    @Optional()
    @InjectModel(Gstr3bComplianceRecord.name)
    private readonly gstr3bModel?: Model<Gstr3bComplianceRecord>,
  ) {}

  async getRevenueGraph(params: {
    loanId?: string;
    pan?: string;
    asOf?: Date;
  }) {
    if (!this.gstr3bModel) {
      throw new ServiceUnavailableException(
        'MongoDB is not enabled. Set ENABLE_MONGO=true to load GSTR-3B revenue graph data.',
      );
    }

    const loanId = String(params.loanId ?? '').trim();
    const pan = String(params.pan ?? '')
      .trim()
      .toUpperCase();

    if (!loanId && !pan) {
      throw new BadRequestException(
        'Query parameter "loanId" or "pan" is required.',
      );
    }
    if (loanId && pan) {
      throw new BadRequestException(
        'Pass only one of "loanId" or "pan", not both.',
      );
    }

    const asOf = params.asOf ?? new Date();
    const currentFyStart = getCurrentFyStartYear(asOf);
    const minYear = currentFyStart - 4;
    const maxYear = currentFyStart + 1;

    const filter: Record<string, unknown> = loanId ? { loanId } : { pan };

    const docs = (await this.gstr3bModel
      .find({
        ...filter,
        year: { $gte: minYear, $lte: maxYear },
      })
      .lean()
      .exec()) as Array<Record<string, any>>;

    const facts = this.toMonthGstFacts(docs);

    return {
      loanId: loanId || null,
      pan: pan || null,
      revenueField: 'taxableTurnover',
      currency: 'INR',
      asOf: formatDateIso(asOf),
      currentFinancialYear: formatFyLabel(currentFyStart),
      ranges: {
        '1y': buildRangeBlock(facts, 1, asOf),
        '3y': buildRangeBlock(facts, 3, asOf),
        '5y': buildRangeBlock(facts, 5, asOf),
      },
    };
  }

  /**
   * One fact per Mongo 3B doc (GSTIN × calendar month).
   * Same GSTIN+month across duplicates is summed later in aggregateGstWise.
   */
  private toMonthGstFacts(
    docs: Array<Record<string, any>>,
  ): MonthGstRevenueFact[] {
    const facts: MonthGstRevenueFact[] = [];

    for (const doc of docs) {
      const year = Number(doc.year);
      const month = Number(doc.month);
      if (
        !Number.isFinite(year) ||
        !Number.isFinite(month) ||
        month < 1 ||
        month > 12
      ) {
        continue;
      }

      const gstin = String(doc.gstin ?? doc.gstNo ?? '')
        .trim()
        .toUpperCase();
      if (!gstin) {
        continue;
      }

      const revenue =
        computePrimaryGstr3bAggregationMetrics([doc])
          .PRIMARY_TOTAL_TAXABLE_TURNOVER ?? 0;

      facts.push({
        year,
        month,
        gstin,
        revenue: Math.round((Number(revenue) + Number.EPSILON) * 100) / 100,
        legalName: doc.legalName ? String(doc.legalName) : null,
        entityType: toApiEntityType(doc.entityType),
        pan: doc.pan
          ? String(doc.pan).trim().toUpperCase()
          : gstin.length >= 12
            ? gstin.substring(2, 12)
            : null,
      });
    }

    return facts;
  }
}
