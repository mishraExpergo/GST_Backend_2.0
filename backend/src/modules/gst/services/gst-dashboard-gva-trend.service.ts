import {
  BadRequestException,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Gstr2bComplianceRecord } from '../schemas/gst-gstr2b-compliance.schema';
import { Gstr3bComplianceRecord } from '../schemas/gst-gstr3b-compliance.schema';
import { computeGstr2bPurchaseTaxableValue } from './gst-gstr2b-aggregation.util';
import { computePrimaryGstr3bAggregationMetrics } from './gst-gstr3b-aggregation.util';
import { toApiEntityType } from './gst-terminology.util';
import {
  formatDateIso,
  formatFyLabel,
  getCurrentFyStartYear,
} from './gst-dashboard-revenue-graph.util';
import {
  buildGvaRangeBlock,
  mergeMonthGvaFacts,
  type MonthGvaFact,
} from './gst-dashboard-gva-trend.util';

@Injectable()
export class GstDashboardGvaTrendService {
  constructor(
    @Optional()
    @InjectModel(Gstr2bComplianceRecord.name)
    private readonly gstr2bModel?: Model<Gstr2bComplianceRecord>,
    @Optional()
    @InjectModel(Gstr3bComplianceRecord.name)
    private readonly gstr3bModel?: Model<Gstr3bComplianceRecord>,
  ) {}

  async getGvaTrend(params: {
    loanId?: string;
    pan?: string;
    asOf?: Date;
  }) {
    if (!this.gstr2bModel || !this.gstr3bModel) {
      throw new ServiceUnavailableException(
        'MongoDB is not enabled. Set ENABLE_MONGO=true to load GVA trend data.',
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
    const yearFilter = { year: { $gte: minYear, $lte: maxYear } };

    const [docs2b, docs3b] = await Promise.all([
      this.gstr2bModel.find({ ...filter, ...yearFilter }).lean().exec(),
      this.gstr3bModel.find({ ...filter, ...yearFilter }).lean().exec(),
    ]);

    const purchaseFacts = this.toPurchaseFacts(
      docs2b as Array<Record<string, any>>,
    );
    const revenueFacts = this.toRevenueFacts(
      docs3b as Array<Record<string, any>>,
    );
    const facts = mergeMonthGvaFacts(purchaseFacts, revenueFacts);

    return {
      loanId: loanId || null,
      pan: pan || null,
      currency: 'INR',
      unit: 'INR',
      sources: {
        purchases: 'gstr2b.invoiceTaxableValue',
        revenue: 'gstr3b.taxableTurnover',
      },
      asOf: formatDateIso(asOf),
      currentFinancialYear: formatFyLabel(currentFyStart),
      ranges: {
        '1y': buildGvaRangeBlock(facts, 1, asOf),
        '3y': buildGvaRangeBlock(facts, 3, asOf),
        '5y': buildGvaRangeBlock(facts, 5, asOf),
      },
    };
  }

  private toPurchaseFacts(
    docs: Array<Record<string, any>>,
  ): Array<Omit<MonthGvaFact, 'revenue'>> {
    const facts: Array<Omit<MonthGvaFact, 'revenue'>> = [];

    for (const doc of docs) {
      const meta = this.readDocMeta(doc);
      if (!meta) continue;

      const purchases = computeGstr2bPurchaseTaxableValue([doc]);
      facts.push({
        ...meta,
        purchases: Math.round((Number(purchases) + Number.EPSILON) * 100) / 100,
      });
    }

    return facts;
  }

  private toRevenueFacts(
    docs: Array<Record<string, any>>,
  ): Array<Omit<MonthGvaFact, 'purchases'>> {
    const facts: Array<Omit<MonthGvaFact, 'purchases'>> = [];

    for (const doc of docs) {
      const meta = this.readDocMeta(doc);
      if (!meta) continue;

      const revenue =
        computePrimaryGstr3bAggregationMetrics([doc])
          .PRIMARY_TOTAL_TAXABLE_TURNOVER ?? 0;

      facts.push({
        ...meta,
        revenue: Math.round((Number(revenue) + Number.EPSILON) * 100) / 100,
      });
    }

    return facts;
  }

  private readDocMeta(doc: Record<string, any>): {
    year: number;
    month: number;
    gstin: string;
    legalName: string | null;
    entityType: string | null;
    pan: string | null;
  } | null {
    const year = Number(doc.year);
    const month = Number(doc.month);
    if (
      !Number.isFinite(year) ||
      !Number.isFinite(month) ||
      month < 1 ||
      month > 12
    ) {
      return null;
    }

    const gstin = String(doc.gstin ?? doc.gstNo ?? '')
      .trim()
      .toUpperCase();
    if (!gstin) return null;

    return {
      year,
      month,
      gstin,
      legalName: doc.legalName ? String(doc.legalName) : null,
      entityType: toApiEntityType(doc.entityType),
      pan: doc.pan
        ? String(doc.pan).trim().toUpperCase()
        : gstin.length >= 12
          ? gstin.substring(2, 12)
          : null,
    };
  }
}
