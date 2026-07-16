import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { GstApiService } from './gst-api.service';
import { ApiRequestLogService } from './api-request-log.service';
import { GstReturnPersistenceService } from './gst-return-persistence.service';
import { getRequiredMonthsForYear } from './gst-return-month-coverage.util';

const GSTIN_PATTERN =
  /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

interface Gstr1ReturnTrackingContext {
  associatedLoanId?: string | null;
  customerId?: string | null;
  dataSource?: string | null;
  sourceTable?: string | null;
  year?: number;
}

@Injectable()
export class GstGstr1ReturnService {
  private readonly logger = new Logger(GstGstr1ReturnService.name);
  private readonly trackApiPath = '/gst/compliance/public/gstrs/track';

  constructor(
    private readonly gstApiService: GstApiService,
    private readonly apiRequestLogService: ApiRequestLogService,
    private readonly returnPersistenceService: GstReturnPersistenceService,
  ) {}

  async fetchGstr1Return(
    gstin: string,
    tracking: Gstr1ReturnTrackingContext = {},
  ): Promise<Record<string, any>> {
    const normalizedGstin = String(gstin ?? '').trim().toUpperCase();
    if (!normalizedGstin) {
      throw new BadRequestException('"gstin" is required.');
    }
    if (!GSTIN_PATTERN.test(normalizedGstin)) {
      throw new BadRequestException(`Invalid GSTIN format "${gstin}".`);
    }

    const year = this.resolveYear(tracking.year);
    const requiredMonths = getRequiredMonthsForYear(year);

    this.returnPersistenceService.assertGstr1ReturnsMongoEnabled();
    const persistenceContext =
      this.returnPersistenceService.validatePersistenceContext(tracking);

    const missingMonths =
      await this.returnPersistenceService.getMissingMonthsForGstr1ReturnTrack(
        persistenceContext.associatedLoanId,
        normalizedGstin,
        year,
      );

    if (missingMonths.length === 0) {
      const cached = await this.returnPersistenceService.findExistingGstr1ReturnTrack(
        persistenceContext.associatedLoanId,
        normalizedGstin,
        year,
      );
      return {
        message:
          'GSTR-1 return track data served from MongoDB (all required months already present).',
        gstin: normalizedGstin,
        year,
        monthsRequired: requiredMonths.length,
        monthsFromCache: requiredMonths.length,
        monthsFetched: 0,
        missingMonths: [],
        fromCache: true,
        stored: false,
        storageReason: 'already_complete',
        data: cached,
      };
    }

    const log = await this.apiRequestLogService.createProcessingLog({
      gstrFamily: 'GSTR',
      gstrType: 'GST-RETURN',
      apiName: this.trackApiPath,
      associatedLoanId: persistenceContext.associatedLoanId,
      customerId: persistenceContext.customerId,
      gstNumber: normalizedGstin,
      dataSource: tracking.dataSource ?? 'sandbox',
      metadata: { year, missingMonths },
    });

    try {
      const response = await this.gstApiService.trackGstrReturns(normalizedGstin);
      await this.apiRequestLogService.markSuccess(log.id, 200, {
        url: this.trackApiPath,
      });

      const storageResult = await this.returnPersistenceService.storeGstr1ReturnTrack(
        {
          customerId: persistenceContext.customerId,
          associatedLoanId: persistenceContext.associatedLoanId,
          gstin: normalizedGstin,
          username: normalizedGstin,
          dataSource: tracking.dataSource,
          sourceTable: tracking.sourceTable,
        },
        response,
      );

      const remainingMissing =
        await this.returnPersistenceService.getMissingMonthsForGstr1ReturnTrack(
          persistenceContext.associatedLoanId,
          normalizedGstin,
          year,
        );

      return {
        message: 'GSTR-1 return track data fetched successfully.',
        gstin: normalizedGstin,
        year,
        monthsRequired: requiredMonths.length,
        monthsFromCache: requiredMonths.length - missingMonths.length,
        monthsFetched: missingMonths.length,
        missingMonths,
        remainingMissingMonths: remainingMissing,
        fromCache: false,
        stored: storageResult.stored,
        storageReason: storageResult.reason,
        data: response,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.apiRequestLogService.markFailure(log.id, null, message, {
        url: this.trackApiPath,
      });
      this.logger.error(
        `GSTR-1 return track failed for gstin=${normalizedGstin}: ${message}`,
      );
      throw new BadGatewayException(
        `GSTR-1 return track API failed: ${message}`,
      );
    }
  }

  private resolveYear(rawYear?: number): number {
    const year = Number(rawYear ?? new Date().getFullYear());
    if (!Number.isInteger(year) || year < 2017 || year > 2100) {
      throw new BadRequestException(
        `Invalid "year" "${rawYear}". Expected a 4-digit year (e.g. 2024).`,
      );
    }
    return year;
  }
}
