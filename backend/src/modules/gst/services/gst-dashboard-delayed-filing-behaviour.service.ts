import {
  BadRequestException,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { GstComplianceRecord } from '../schemas/gst-compliance.schema';
import { Gstr1ReturnsComplianceRecord } from '../schemas/gst-gstr1-returns-compliance.schema';
import { toApiEntityType } from './gst-terminology.util';
import {
  formatDateIso,
  formatFyLabel,
  getCurrentFyStartYear,
  resolveRangeWindow,
} from './gst-dashboard-revenue-graph.util';
import {
  buildMissingGstinTrackInfo,
  trackDocsToMonthFilingFacts,
} from './gst-dashboard-filing-behaviour.util';
import { buildDelayedFilingRangeBlock } from './gst-dashboard-delayed-filing-behaviour.util';

@Injectable()
export class GstDashboardDelayedFilingBehaviourService {
  constructor(
    @Optional()
    @InjectModel(Gstr1ReturnsComplianceRecord.name)
    private readonly gstrTrackModel?: Model<Gstr1ReturnsComplianceRecord>,
    @Optional()
    @InjectModel(GstComplianceRecord.name)
    private readonly complianceModel?: Model<GstComplianceRecord>,
  ) {}

  async getDelayedFilingBehaviour(params: {
    loanId?: string;
    pan?: string;
    asOf?: Date;
  }) {
    if (!this.gstrTrackModel) {
      throw new ServiceUnavailableException(
        'MongoDB is not enabled. Set ENABLE_MONGO=true to load delayed filing behaviour data.',
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
    const filter: Record<string, unknown> = loanId ? { loanId } : { pan };

    const five = resolveRangeWindow(5, asOf);
    const requiredFyLabels = five.financialYears;

    const trackDocs = (await this.gstrTrackModel
      .find(filter)
      .lean()
      .exec()) as Array<Record<string, any>>;

    const fySet = new Set(requiredFyLabels.map((fy) => fy.toUpperCase()));
    const inWindowDocs = trackDocs.filter((doc) => {
      const fy = String(doc.financialYear ?? '').trim().toUpperCase();
      if (!fy) return true;
      const compact = fy.replace(/\s+/g, ' ');
      return (
        fySet.has(compact) ||
        [...fySet].some((req) => compact.includes(req.replace(/^FY\s*/i, '')))
      );
    });

    const facts = trackDocsToMonthFilingFacts(inWindowDocs, (doc) =>
      this.readDocMeta(doc),
    );

    const expectedGstins = await this.resolveExpectedGstins(filter, trackDocs);
    const missingGstins = buildMissingGstinTrackInfo(
      expectedGstins,
      trackDocs,
      requiredFyLabels,
    );
    const mayBeIncomplete = missingGstins.length > 0;

    return {
      loanId: loanId || null,
      pan: pan || null,
      returnType: 'GSTR-1',
      metric: 'delayedFilingPercent',
      asOf: formatDateIso(asOf),
      currentFinancialYear: formatFyLabel(currentFyStart),
      dataCompleteness: {
        isComplete: !mayBeIncomplete,
        mayBeIncomplete,
        missingGstins,
      },
      ranges: {
        '1y': buildDelayedFilingRangeBlock(facts, 1, asOf),
        '3y': buildDelayedFilingRangeBlock(facts, 3, asOf),
        '5y': buildDelayedFilingRangeBlock(facts, 5, asOf),
      },
    };
  }

  private async resolveExpectedGstins(
    filter: Record<string, unknown>,
    trackDocs: Array<Record<string, any>>,
  ): Promise<
    Array<{
      gstin: string;
      legalName: string | null;
      entityType: string | null;
      pan: string | null;
    }>
  > {
    const byGstin = new Map<
      string,
      {
        gstin: string;
        legalName: string | null;
        entityType: string | null;
        pan: string | null;
      }
    >();

    const add = (doc: Record<string, any>) => {
      const meta = this.readDocMeta(doc);
      if (!meta) return;
      if (!byGstin.has(meta.gstin)) {
        byGstin.set(meta.gstin, meta);
      }
    };

    if (this.complianceModel) {
      const complianceDocs = (await this.complianceModel
        .find(filter)
        .lean()
        .exec()) as Array<Record<string, any>>;
      for (const doc of complianceDocs) add(doc);
    }

    for (const doc of trackDocs) add(doc);

    return [...byGstin.values()];
  }

  private readDocMeta(doc: Record<string, any>): {
    gstin: string;
    legalName: string | null;
    entityType: string | null;
    pan: string | null;
  } | null {
    const gstin = String(doc.gstin ?? doc.gstNo ?? '')
      .trim()
      .toUpperCase();
    if (!gstin) return null;

    return {
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
