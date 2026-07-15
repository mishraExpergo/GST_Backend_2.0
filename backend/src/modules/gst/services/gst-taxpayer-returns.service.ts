 import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { GstTaxpayerAuthService } from './gst-taxpayer-auth.service';
import { ApiRequestLogService } from './api-request-log.service';
import { GstService } from '../gst.service';
import { GstAggregationService } from './gst-aggregation.service';
import { resolveGstApiCredentials } from './gst-api-credentials.util';

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

/* DISABLED: GSTR-1
const VERIFY_GSTR_OPERATION = 'GSTIN_VERIFY_AND_FETCH_GSTR';
*/
const VERIFY_2B_OPERATION = 'GSTIN_VERIFY_AND_FETCH_GSTR_2B';
const VERIFY_3B_OPERATION = 'GSTIN_VERIFY_AND_FETCH_GSTR_3B';

@Injectable()
export class GstTaxpayerReturnsService {
  private readonly logger = new Logger(GstTaxpayerReturnsService.name);
  private readonly timeoutMs = 15_000;

  constructor(
    private readonly config: ConfigService,
    private readonly taxpayerAuthService: GstTaxpayerAuthService,
    private readonly apiRequestLogService: ApiRequestLogService,
    private readonly gstService: GstService,
    private readonly gstAggregationService: GstAggregationService,
  ) {}

  async fetchGstr1(
    _identity: TaxpayerIdentity,
    _year: number,
    _month: number,
    _tracking: RequestTrackingContext = {},
  ): Promise<Record<string, any>> {
    /* DISABLED: GSTR-1
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
    */
    throw new ServiceUnavailableException(
      'GSTR-1 / GSTR-1A temporarily disabled.',
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
    _identity: TaxpayerIdentity,
    _year: number,
    _month: number,
    _tracking: RequestTrackingContext = {},
  ): Promise<Record<string, any>> {
    /* DISABLED: GSTR-1A
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
    */
    throw new ServiceUnavailableException(
      'GSTR-1 / GSTR-1A temporarily disabled.',
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
      gstrType: 'GST-NOTICES',
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
              'x-api-key': resolveGstApiCredentials(this.config).apiKey,
              'x-api-version': resolveGstApiCredentials(this.config).apiVersion,
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
      gstrType: 'GST-NOTICES',
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
              'x-api-key': resolveGstApiCredentials(this.config).apiKey,
              'x-api-version': resolveGstApiCredentials(this.config).apiVersion,
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
    // GSTR-1 / GSTR-1A are not tracked in api_request_logs.
    const log =
      returnType === 'GSTR-1' || returnType === 'GSTR-1A'
        ? null
        : await this.apiRequestLogService.createProcessingLog({
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
              'x-api-key': resolveGstApiCredentials(this.config).apiKey,
              'x-api-version': resolveGstApiCredentials(this.config).apiVersion,
            },
            timeout: this.timeoutMs,
            validateStatus: () => true,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (log) {
            await this.apiRequestLogService.markFailure(log.id, null, message, {
              url,
            });
          }
          throw err;
        }
      })();

      if (
        (response.status === 401 || response.status === 403) &&
        !retriedAfter401
      ) {
        retriedAfter401 = true;
        if (log) {
          await this.apiRequestLogService.incrementRetry(log.id);
        }
        await this.taxpayerAuthService.refreshAccessToken(identity);
        continue;
      }

      if (
        (response.status === 429 || response.status >= 500) &&
        attempt < maxRetries
      ) {
        attempt++;
        if (log) {
          await this.apiRequestLogService.incrementRetry(log.id);
        }
        await this.delay(baseDelay * 2 ** (attempt - 1));
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        if (log) {
          await this.apiRequestLogService.markFailure(
            log.id,
            response.status,
            `${returnType} unauthorized`,
            { url },
          );
        }
        throw new UnauthorizedException(
          `${returnType} fetch unauthorized. Taxpayer session may be expired; regenerate OTP.`,
        );
      }

      if (response.status < 200 || response.status >= 300) {
        const payload = JSON.stringify(response.data ?? {}).slice(0, 300);
        if (log) {
          await this.apiRequestLogService.markFailure(
            log.id,
            response.status,
            payload,
            { url },
          );
        }
        this.logger.error(
          `${returnType} fetch failed for ${identity.gstin} (${year}-${month}) with ${response.status}: ${payload}`,
        );
        throw new BadGatewayException(
          `${returnType} API failed with status ${response.status}.`,
        );
      }

      if (log) {
        await this.apiRequestLogService.markSuccess(log.id, response.status, {
          url,
        });
      }

      if (!tracking.skipAutoAggregationTrigger) {
        await this.triggerAggregationForReturnType(
          returnType,
          identity,
          year,
          month,
          tracking,
        );
      }

      return {
        message: `${returnType} fetched successfully.`,
        username: identity.username,
        gstin: identity.gstin,
        year,
        month,
        data: response.data,
      };
    }
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

  private async triggerAggregationForReturnType(
    returnType: 'GSTR-1' | 'GSTR-1A' | 'GSTR-2B' | 'GSTR-3B',
    identity: TaxpayerIdentity,
    year: number,
    month: number,
    tracking: RequestTrackingContext,
  ): Promise<void> {
    const customerId = String(tracking.customerId ?? '').trim();
    if (!customerId) {
      this.logger.debug(
        `${returnType}: skipping auto-aggregation trigger because "customerId" is missing.`,
      );
      return;
    }

    const sourceTable =
      String(tracking.sourceTable ?? '').trim() ||
      this.config.get<string>('GST_AGGREGATION_SOURCE_TABLE', 'gst_uploaded_file_data');

    const operationByReturnType: Record<string, string | null> = {
      /* DISABLED: GSTR-1 / GSTR-1A
      'GSTR-1': VERIFY_GSTR_OPERATION,
      'GSTR-1A': null,
      */
      'GSTR-2B': VERIFY_2B_OPERATION,
      'GSTR-3B': VERIFY_3B_OPERATION,
    };
    const operation = operationByReturnType[returnType];
    if (!operation) {
      return;
    }

    try {
      const job = await this.gstService.createJob('API', {
        operation,
        sourceTable,
        triggerSource: 'taxpayer-returns',
        gstrType: returnType,
        customerId,
        associatedLoanId: tracking.associatedLoanId ?? null,
        username: identity.username,
        gstin: identity.gstin,
        year,
        month,
      });

      await this.gstService.setJobTotalChunks(job.id, 1);
      const task = await this.gstService.createTask(job.id, {
        tableName: sourceTable,
        batchIndex: 0,
        totalBatches: 1,
        rows: [{ customer_id: customerId }],
      });
      await this.gstService.markTask(task.id, 'COMPLETED', {
        result: { totalRows: 1, stored: 1 },
      });
      await this.gstService.setJobProgress(job.id, 1);
      await this.gstService.finishJob(job.id, { autoAggregationTriggered: true });

      /* DISABLED: GSTR-1 aggregation
      if (returnType === 'GSTR-1') {
        await this.gstAggregationService.triggerAfterGstrJob(job.id);
      } else */
      if (returnType === 'GSTR-2B') {
        await this.gstAggregationService.triggerAfterGstr2bJob(job.id);
      } else if (returnType === 'GSTR-3B') {
        await this.gstAggregationService.triggerAfterGstr3bJob(job.id);
      }
    } catch (err) {
      this.logger.error(
        `${returnType}: auto-aggregation trigger failed for customerId=${customerId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
