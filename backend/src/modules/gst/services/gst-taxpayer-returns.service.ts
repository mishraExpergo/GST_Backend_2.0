import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { GstTaxpayerAuthService } from './gst-taxpayer-auth.service';
import { ApiRequestLogService } from './api-request-log.service';
import { GstReturnPersistenceService } from './gst-return-persistence.service';
import { getRequiredMonthsForYear } from './gst-return-month-coverage.util';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Gstr1aComplianceRecord } from '../schemas/gst-gstr1a-compliance.schema';

interface TaxpayerIdentity {
  username: string;
  gstin: string;
}

interface RequestTrackingContext {
  associatedLoanId?: string | null;
  customerId?: string | null;
  dataSource?: string | null;
  sourceTable?: string | null;
  skipAutoAggregationTrigger?: boolean;
}

@Injectable()
export class GstTaxpayerReturnsService {
  private readonly logger = new Logger(GstTaxpayerReturnsService.name);
  private readonly timeoutMs = 15_000;

  constructor(
    private readonly config: ConfigService,
    private readonly taxpayerAuthService: GstTaxpayerAuthService,
    private readonly apiRequestLogService: ApiRequestLogService,
    private readonly returnPersistenceService: GstReturnPersistenceService,
    @Optional()
    @InjectModel(Gstr1aComplianceRecord.name)
    private readonly gstr1aComplianceModel?: Model<Gstr1aComplianceRecord>,
  ) {}

  async fetchGstr1ForYear(
    identity: TaxpayerIdentity,
    year: number,
    tracking: RequestTrackingContext = {},
  ): Promise<Record<string, any>> {
    return this.fetchReturnForYear(identity, 'GSTR-1', year, tracking);
  }

  async fetchGstr2bForYear(
    identity: TaxpayerIdentity,
    year: number,
    tracking: RequestTrackingContext = {},
  ): Promise<Record<string, any>> {
    return this.fetchReturnForYear(identity, 'GSTR-2B', year, tracking);
  }

  async fetchGstr3bForYear(
    identity: TaxpayerIdentity,
    year: number,
    tracking: RequestTrackingContext = {},
  ): Promise<Record<string, any>> {
    return this.fetchReturnForYear(identity, 'GSTR-3B', year, tracking);
  }

  async fetchGstr1(
    identity: TaxpayerIdentity,
    year: number,
    month: number,
    tracking: RequestTrackingContext = {},
  ): Promise<Record<string, any>> {
    const { normalizedIdentity, yearNum, monthNum } = this.validateInputs(
      identity,
      year,
      month,
    );
    return this.fetchReturn(
      normalizedIdentity,
      `/gst/compliance/tax-payer/gstrs/gstr-1/${yearNum}/${monthNum}`,
      'GSTR-1',
      yearNum,
      monthNum,
      tracking,
    );
  }

  async fetchGstr2b(
    identity: TaxpayerIdentity,
    year: number,
    month: number,
    tracking: RequestTrackingContext = {},
  ): Promise<Record<string, any>> {
    const { normalizedIdentity, yearNum, monthNum } = this.validateInputs(
      identity,
      year,
      month,
    );
    return this.fetchReturn(
      normalizedIdentity,
      `/gst/compliance/tax-payer/gstrs/gstr-2b/${yearNum}/${monthNum}`,
      'GSTR-2B',
      yearNum,
      monthNum,
      tracking,
    );
  }

  async fetchGstr3b(
    identity: TaxpayerIdentity,
    year: number,
    month: number,
    tracking: RequestTrackingContext = {},
  ): Promise<Record<string, any>> {
    const { normalizedIdentity, yearNum, monthNum } = this.validateInputs(
      identity,
      year,
      month,
    );
    return this.fetchReturn(
      normalizedIdentity,
      `/gst/compliance/tax-payer/gstrs/gstr-3b/${yearNum}/${monthNum}`,
      'GSTR-3B',
      yearNum,
      monthNum,
      tracking,
    );
  }

  async fetchGstr1a(
    identity: TaxpayerIdentity,
    year: number,
    month: number,
    tracking: RequestTrackingContext = {},
  ): Promise<Record<string, any>> {
    const { normalizedIdentity, yearNum, monthNum } = this.validateInputs(
      identity,
      year,
      month,
    );
    return this.fetchReturn(
      normalizedIdentity,
      `/gst/compliance/tax-payer/gstrs/gstr-1a/${yearNum}/${monthNum}`,
      'GSTR-1A',
      yearNum,
      monthNum,
      tracking,
    );
  }

  async fetchNotices(
    identity: TaxpayerIdentity,
    noticeDate: string,
    tracking: RequestTrackingContext = {},
  ): Promise<Record<string, any>> {
    const { normalizedIdentity, normalizedDate } = this.validateNoticesInputs(
      identity,
      noticeDate,
    );
    const path = '/gst/compliance/tax-payer/notices';
    const maxRetries = Number(this.config.get('GST_API_MAX_RETRIES', '3'));
    const baseDelay = Number(this.config.get('GST_API_RETRY_BASE_MS', '500'));
    const forceRefreshPerRequest =
      this.config.get<string>('GST_TAXPAYER_REFRESH_ON_EVERY_REQUEST', 'true') ===
      'true';

    let attempt = 0;
    let retriedAfter401 = false;
    const associatedLoanId =
      String(tracking.associatedLoanId ?? '').trim() ||
      `${normalizedIdentity.username}:${normalizedIdentity.gstin}`;
    const customerId =
      String(tracking.customerId ?? '').trim() || normalizedIdentity.username;
    const log = await this.apiRequestLogService.createProcessingLog({
      gstrFamily: 'GSTR',
      gstrType: 'GST-RETURN',
      apiName: path,
      associatedLoanId,
      customerId,
      gstNumber: normalizedIdentity.gstin,
      dataSource: tracking.dataSource ?? 'sandbox',
      metadata: { username: normalizedIdentity.username, date: normalizedDate },
    });

    while (true) {
      const url = `${this.baseUrl}${path}?date=${encodeURIComponent(normalizedDate)}`;
      const response = await (async () => {
        try {
          const accessToken = await this.taxpayerAuthService.getAccessTokenForTaxpayer(
            normalizedIdentity,
            forceRefreshPerRequest,
          );
          return await axios.get(url, {
            headers: {
              authorization: accessToken,
              'x-api-key': this.config.get<string>('GST_API_KEY_LIVE', ''),
              'x-api-version': this.config.get<string>('GST_API_VERSION', '1.0.0'),
            },
            timeout: this.timeoutMs,
            validateStatus: () => true,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await this.apiRequestLogService.markFailure(log.id, null, message, {
            url,
          });
          throw err;
        }
      })();

      if (
        (response.status === 401 || response.status === 403) &&
        !retriedAfter401
      ) {
        retriedAfter401 = true;
        await this.apiRequestLogService.incrementRetry(log.id);
        await this.taxpayerAuthService.refreshAccessToken(normalizedIdentity);
        continue;
      }

      if (
        (response.status === 429 || response.status >= 500) &&
        attempt < maxRetries
      ) {
        attempt++;
        await this.apiRequestLogService.incrementRetry(log.id);
        await this.delay(baseDelay * 2 ** (attempt - 1));
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        await this.apiRequestLogService.markFailure(
          log.id,
          response.status,
          'GST notices unauthorized',
          { url },
        );
        throw new UnauthorizedException(
          'GST notices fetch unauthorized. Taxpayer session may be expired; regenerate OTP.',
        );
      }

      if (response.status < 200 || response.status >= 300) {
        const payload = JSON.stringify(response.data ?? {}).slice(0, 300);
        await this.apiRequestLogService.markFailure(
          log.id,
          response.status,
          payload,
          { url },
        );
        this.logger.error(
          `GST notices fetch failed for ${normalizedIdentity.gstin} (${normalizedDate}) with ${response.status}: ${payload}`,
        );
        throw new BadGatewayException(
          `GST notices API failed with status ${response.status}.`,
        );
      }

      await this.apiRequestLogService.markSuccess(log.id, response.status, {
        url,
      });

      return {
        message: 'GST notices fetched successfully.',
        username: normalizedIdentity.username,
        gstin: normalizedIdentity.gstin,
        date: normalizedDate,
        data: response.data,
      };
    }
  }

  async fetchNoticeByReferenceId(
    identity: TaxpayerIdentity,
    referenceId: string,
    tracking: RequestTrackingContext = {},
  ): Promise<Record<string, any>> {
    const { normalizedIdentity, normalizedReferenceId } =
      this.validateNoticeReferenceInputs(identity, referenceId);
    const path = `/gst/compliance/tax-payer/notices/${encodeURIComponent(
      normalizedReferenceId,
    )}`;
    const maxRetries = Number(this.config.get('GST_API_MAX_RETRIES', '3'));
    const baseDelay = Number(this.config.get('GST_API_RETRY_BASE_MS', '500'));
    const forceRefreshPerRequest =
      this.config.get<string>('GST_TAXPAYER_REFRESH_ON_EVERY_REQUEST', 'true') ===
      'true';

    let attempt = 0;
    let retriedAfter401 = false;
    const associatedLoanId =
      String(tracking.associatedLoanId ?? '').trim() ||
      `${normalizedIdentity.username}:${normalizedIdentity.gstin}`;
    const customerId =
      String(tracking.customerId ?? '').trim() || normalizedIdentity.username;
    const log = await this.apiRequestLogService.createProcessingLog({
      gstrFamily: 'GSTR',
      gstrType: 'GST-RETURN',
      apiName: '/gst/compliance/tax-payer/notices/{referenceId}',
      associatedLoanId,
      customerId,
      gstNumber: normalizedIdentity.gstin,
      dataSource: tracking.dataSource ?? 'sandbox',
      metadata: {
        username: normalizedIdentity.username,
        referenceId: normalizedReferenceId,
      },
    });

    while (true) {
      const url = `${this.baseUrl}${path}`;
      const response = await (async () => {
        try {
          const accessToken = await this.taxpayerAuthService.getAccessTokenForTaxpayer(
            normalizedIdentity,
            forceRefreshPerRequest,
          );
          return await axios.get(url, {
            headers: {
              authorization: accessToken,
              'x-api-key': this.config.get<string>('GST_API_KEY_LIVE', ''),
              'x-api-version': this.config.get<string>('GST_API_VERSION', '1.0.0'),
            },
            timeout: this.timeoutMs,
            validateStatus: () => true,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await this.apiRequestLogService.markFailure(log.id, null, message, {
            url,
          });
          throw err;
        }
      })();

      if (
        (response.status === 401 || response.status === 403) &&
        !retriedAfter401
      ) {
        retriedAfter401 = true;
        await this.apiRequestLogService.incrementRetry(log.id);
        await this.taxpayerAuthService.refreshAccessToken(normalizedIdentity);
        continue;
      }

      if (
        (response.status === 429 || response.status >= 500) &&
        attempt < maxRetries
      ) {
        attempt++;
        await this.apiRequestLogService.incrementRetry(log.id);
        await this.delay(baseDelay * 2 ** (attempt - 1));
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        await this.apiRequestLogService.markFailure(
          log.id,
          response.status,
          'GST notice detail unauthorized',
          { url },
        );
        throw new UnauthorizedException(
          'GST notice detail fetch unauthorized. Taxpayer session may be expired; regenerate OTP.',
        );
      }

      if (response.status < 200 || response.status >= 300) {
        const payload = JSON.stringify(response.data ?? {}).slice(0, 300);
        await this.apiRequestLogService.markFailure(
          log.id,
          response.status,
          payload,
          { url },
        );
        this.logger.error(
          `GST notice detail fetch failed for ${normalizedIdentity.gstin} (${normalizedReferenceId}) with ${response.status}: ${payload}`,
        );
        throw new BadGatewayException(
          `GST notice detail API failed with status ${response.status}.`,
        );
      }

      await this.apiRequestLogService.markSuccess(log.id, response.status, {
        url,
      });

      return {
        message: 'GST notice detail fetched successfully.',
        username: normalizedIdentity.username,
        gstin: normalizedIdentity.gstin,
        referenceId: normalizedReferenceId,
        data: response.data,
      };
    }
  }

  private get baseUrl(): string {
    return this.config
      .getOrThrow<string>('GST_API_BASE_URL')
      .replace(/\/+$/, '');
  }

  private async fetchReturn(
    identity: TaxpayerIdentity,
    path: string,
    returnType: 'GSTR-1' | 'GSTR-1A' | 'GSTR-2B' | 'GSTR-3B',
    year: number,
    month: number,
    tracking: RequestTrackingContext,
  ): Promise<Record<string, any>> {
    const isPersistedReturn =
      returnType === 'GSTR-1' ||
      returnType === 'GSTR-2B' ||
      returnType === 'GSTR-3B';

    let persistenceContext:
      | { customerId: string; associatedLoanId: string }
      | null = null;

    if (isPersistedReturn) {
      this.returnPersistenceService.assertMongoEnabled();
      persistenceContext =
        this.returnPersistenceService.validatePersistenceContext(tracking);

      const cached = await this.returnPersistenceService.findExisting(
        returnType,
        persistenceContext.associatedLoanId,
        identity.gstin,
        year,
        month,
      );
      if (cached) {
        return {
          message: `${returnType} served from MongoDB (already fetched for this GSTIN).`,
          username: identity.username,
          gstin: identity.gstin,
          year,
          month,
          fromCache: true,
          stored: false,
          data: cached,
        };
      }
    }

    const maxRetries = Number(this.config.get('GST_API_MAX_RETRIES', '3'));
    const baseDelay = Number(this.config.get('GST_API_RETRY_BASE_MS', '500'));
    const forceRefreshPerRequest =
      this.config.get<string>('GST_TAXPAYER_REFRESH_ON_EVERY_REQUEST', 'true') ===
      'true';

    let attempt = 0;
    let retriedAfter401 = false;
    const associatedLoanId =
      String(tracking.associatedLoanId ?? '').trim() ||
      `${identity.username}:${identity.gstin}`;
    const customerId = String(tracking.customerId ?? '').trim() || identity.username;
    const log = await this.apiRequestLogService.createProcessingLog({
      gstrFamily: 'GSTR',
      gstrType: returnType,
      apiName: path,
      associatedLoanId,
      customerId,
      gstNumber: identity.gstin,
      dataSource: tracking.dataSource ?? 'sandbox',
      metadata: { username: identity.username, year, month },
    });

    while (true) {
      const url = `${this.baseUrl}${path}`;
      const response = await (async () => {
        try {
          const accessToken = await this.taxpayerAuthService.getAccessTokenForTaxpayer(
            identity,
            forceRefreshPerRequest,
          );
          return await axios.get(url, {
            headers: {
              authorization: accessToken,
              'x-api-key': this.config.get<string>('GST_API_KEY_LIVE', ''),
              'x-api-version': this.config.get<string>('GST_API_VERSION', '1.0.0'),
            },
            timeout: this.timeoutMs,
            validateStatus: () => true,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await this.apiRequestLogService.markFailure(log.id, null, message, {
            url,
          });
          throw err;
        }
      })();

      if (
        (response.status === 401 || response.status === 403) &&
        !retriedAfter401
      ) {
        retriedAfter401 = true;
        await this.apiRequestLogService.incrementRetry(log.id);
        await this.taxpayerAuthService.refreshAccessToken(identity);
        continue;
      }

      if (
        (response.status === 429 || response.status >= 500) &&
        attempt < maxRetries
      ) {
        attempt++;
        await this.apiRequestLogService.incrementRetry(log.id);
        await this.delay(baseDelay * 2 ** (attempt - 1));
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        await this.apiRequestLogService.markFailure(
          log.id,
          response.status,
          `${returnType} unauthorized`,
          { url },
        );
        throw new UnauthorizedException(
          `${returnType} fetch unauthorized. Taxpayer session may be expired; regenerate OTP.`,
        );
      }

      if (response.status < 200 || response.status >= 300) {
        const payload = JSON.stringify(response.data ?? {}).slice(0, 300);
        await this.apiRequestLogService.markFailure(
          log.id,
          response.status,
          payload,
          { url },
        );
        this.logger.error(
          `${returnType} fetch failed for ${identity.gstin} (${year}-${month}) with ${response.status}: ${payload}`,
        );
        throw new BadGatewayException(
          `${returnType} API failed with status ${response.status}.`,
        );
      }

      await this.apiRequestLogService.markSuccess(log.id, response.status, {
        url,
      });

      await this.storeGstr1aResponseIfApplicable(
        returnType,
        identity,
        year,
        month,
        tracking,
        response.data ?? {},
      );

      let storageResult: { stored: boolean; reason: string } | null = null;
      if (isPersistedReturn && persistenceContext) {
        storageResult = await this.returnPersistenceService.storeIfAbsent(
          returnType,
          {
            customerId: persistenceContext.customerId,
            associatedLoanId: persistenceContext.associatedLoanId,
            gstin: identity.gstin,
            username: identity.username,
            dataSource: tracking.dataSource,
            sourceTable: tracking.sourceTable,
          },
          year,
          month,
          response.data ?? {},
        );
      }

      return {
        message: `${returnType} fetched successfully.`,
        username: identity.username,
        gstin: identity.gstin,
        year,
        month,
        fromCache: false,
        stored: storageResult?.stored ?? false,
        storageReason: storageResult?.reason ?? 'not_applicable',
        data: response.data,
      };
    }
  }

  private async fetchReturnForYear(
    identity: TaxpayerIdentity,
    returnType: 'GSTR-1' | 'GSTR-2B' | 'GSTR-3B',
    year: number,
    tracking: RequestTrackingContext,
  ): Promise<Record<string, any>> {
    const { normalizedIdentity, yearNum } = this.validateYearOnly(identity, year);
    const monthlyResults: Array<Record<string, any>> = [];
    let monthsFromCache = 0;
    let monthsStored = 0;
    let monthsFetched = 0;
    let monthsFailed = 0;
    let monthsSkipped = 0;

    const requiredMonths = getRequiredMonthsForYear(yearNum);
    let missingMonths = [...requiredMonths];
    let persistenceContext: { customerId: string; associatedLoanId: string } | null =
      null;

    this.returnPersistenceService.assertMongoEnabled();
    persistenceContext =
      this.returnPersistenceService.validatePersistenceContext(tracking);
    missingMonths = await this.returnPersistenceService.getMissingMonthsForYear(
      returnType,
      persistenceContext.associatedLoanId,
      normalizedIdentity.gstin,
      yearNum,
    );

    for (const month of requiredMonths) {
      if (!missingMonths.includes(month)) {
        monthsSkipped++;
        try {
          const cached = await this.returnPersistenceService.findExisting(
            returnType,
            persistenceContext.associatedLoanId,
            normalizedIdentity.gstin,
            yearNum,
            month,
          );
          monthlyResults.push({
            message: `${returnType} served from MongoDB (already fetched for this GSTIN).`,
            username: normalizedIdentity.username,
            gstin: normalizedIdentity.gstin,
            year: yearNum,
            month,
            fromCache: true,
            stored: false,
            data: cached,
          });
          monthsFromCache++;
        } catch (err) {
          monthsFailed++;
          monthlyResults.push({
            month,
            year: yearNum,
            failed: true,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    for (const month of missingMonths) {
      try {
        const path = this.buildReturnPath(returnType, yearNum, month);
        const result = await this.fetchReturn(
          normalizedIdentity,
          path,
          returnType,
          yearNum,
          month,
          tracking,
        );
        monthlyResults.push(result);
        if (result.fromCache) {
          monthsFromCache++;
        } else if (result.stored) {
          monthsStored++;
        } else {
          monthsFetched++;
        }
      } catch (err) {
        monthsFailed++;
        monthlyResults.push({
          month,
          year: yearNum,
          failed: true,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    monthlyResults.sort((a, b) => Number(a.month ?? 0) - Number(b.month ?? 0));

    return {
      message: `${returnType} year fetch completed for ${yearNum}.`,
      username: normalizedIdentity.username,
      gstin: normalizedIdentity.gstin,
      year: yearNum,
      monthsRequired: requiredMonths.length,
      monthsProcessed: requiredMonths.length,
      monthsFromCache,
      monthsSkipped,
      monthsStored,
      monthsFetched,
      monthsFailed,
      monthsMissingBeforeFetch: missingMonths.length,
      monthlyResults,
    };
  }

  private buildReturnPath(
    returnType: 'GSTR-1' | 'GSTR-2B' | 'GSTR-3B',
    year: number,
    month: number,
  ): string {
    const slug =
      returnType === 'GSTR-1'
        ? 'gstr-1'
        : returnType === 'GSTR-2B'
          ? 'gstr-2b'
          : 'gstr-3b';
    return `/gst/compliance/tax-payer/gstrs/${slug}/${year}/${month}`;
  }

  private validateYearOnly(
    identity: TaxpayerIdentity,
    year: number,
  ): { normalizedIdentity: TaxpayerIdentity; yearNum: number } {
    const username = String(identity.username ?? '').trim();
    const gstin = String(identity.gstin ?? '').trim().toUpperCase();
    const yearNum = Number(year);

    if (!username) throw new BadRequestException('"username" is required.');
    if (!gstin) throw new BadRequestException('"gstin" is required.');
    if (!Number.isInteger(yearNum) || yearNum < 2017 || yearNum > 2100) {
      throw new BadRequestException(
        `Invalid "year" "${year}". Expected a 4-digit year (e.g. 2024).`,
      );
    }

    return { normalizedIdentity: { username, gstin }, yearNum };
  }

  private validateInputs(
    identity: TaxpayerIdentity,
    year: number,
    month: number,
  ): {
    normalizedIdentity: TaxpayerIdentity;
    yearNum: number;
    monthNum: number;
  } {
    const username = String(identity.username ?? '').trim();
    const gstin = String(identity.gstin ?? '').trim().toUpperCase();
    const yearNum = Number(year);
    const monthNum = Number(month);

    if (!username) throw new BadRequestException('"username" is required.');
    if (!gstin) throw new BadRequestException('"gstin" is required.');
    if (!Number.isInteger(yearNum) || yearNum < 2017 || yearNum > 2100) {
      throw new BadRequestException(
        `Invalid "year" "${year}". Expected a 4-digit year (e.g. 2024).`,
      );
    }
    if (!Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12) {
      throw new BadRequestException(
        `Invalid "month" "${month}". Expected a number between 1 and 12.`,
      );
    }

    return {
      normalizedIdentity: { username, gstin },
      yearNum,
      monthNum,
    };
  }

  private validateNoticesInputs(
    identity: TaxpayerIdentity,
    noticeDate: string,
  ): {
    normalizedIdentity: TaxpayerIdentity;
    normalizedDate: string;
  } {
    const username = String(identity.username ?? '').trim();
    const gstin = String(identity.gstin ?? '').trim().toUpperCase();
    const normalizedDate = String(noticeDate ?? '').trim();
    const dateMatch = normalizedDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

    if (!username) throw new BadRequestException('"username" is required.');
    if (!gstin) throw new BadRequestException('"gstin" is required.');
    if (!dateMatch) {
      throw new BadRequestException(
        '"date" must be in DD/MM/YYYY format (example: 06/07/2026).',
      );
    }

    const day = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const year = Number(dateMatch[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day
    ) {
      throw new BadRequestException('"date" is not a valid calendar date.');
    }

    const now = new Date();
    const todayUtc = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    );
    const dateUtc = Date.UTC(year, month - 1, day);
    const dayDiff = Math.floor((todayUtc - dateUtc) / (24 * 60 * 60 * 1000));

    if (dayDiff < 0) {
      throw new BadRequestException('"date" cannot be in the future.');
    }
    if (dayDiff > 60) {
      throw new BadRequestException(
        '"date" must be within the last 60 days.',
      );
    }

    return {
      normalizedIdentity: { username, gstin },
      normalizedDate,
    };
  }

  private validateNoticeReferenceInputs(
    identity: TaxpayerIdentity,
    referenceId: string,
  ): {
    normalizedIdentity: TaxpayerIdentity;
    normalizedReferenceId: string;
  } {
    const username = String(identity.username ?? '').trim();
    const gstin = String(identity.gstin ?? '').trim().toUpperCase();
    const normalizedReferenceId = String(referenceId ?? '').trim();

    if (!username) throw new BadRequestException('"username" is required.');
    if (!gstin) throw new BadRequestException('"gstin" is required.');
    if (!normalizedReferenceId) {
      throw new BadRequestException('"referenceId" is required.');
    }

    return {
      normalizedIdentity: { username, gstin },
      normalizedReferenceId,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async storeGstr1aResponseIfApplicable(
    returnType: 'GSTR-1' | 'GSTR-1A' | 'GSTR-2B' | 'GSTR-3B',
    identity: TaxpayerIdentity,
    year: number,
    month: number,
    tracking: RequestTrackingContext,
    payload: Record<string, any>,
  ): Promise<void> {
    if (returnType !== 'GSTR-1A' || !this.gstr1aComplianceModel) {
      return;
    }

    const loanId =
      String(tracking.associatedLoanId ?? '').trim() ||
      `${identity.username}:${identity.gstin}`;
    const customerId =
      String(tracking.customerId ?? '').trim() || identity.username;
    const sourceTable =
      String(tracking.sourceTable ?? '').trim() ||
      this.config.get<string>('GST_AGGREGATION_SOURCE_TABLE', 'gst_uploaded_file_data');

    const gstin = identity.gstin.trim().toUpperCase();
    const pan = gstin.length >= 12 ? gstin.substring(2, 12) : '';
    const status = String(payload?.data?.status ?? payload?.status ?? 'FETCHED');

    await this.gstr1aComplianceModel.updateOne(
      { loanId, gstin, year, month },
      {
        $set: {
          loanId,
          customerId,
          gstin,
          gstNo: gstin,
          pan,
          year,
          month,
          sourceTable,
          status,
          gstr1aResponse: payload,
          systemMetadata: {
            fetchedAt: new Date().toISOString(),
            username: identity.username,
            dataSource: tracking.dataSource ?? 'sandbox',
          },
        },
      },
      { upsert: true },
    );
  }
}
