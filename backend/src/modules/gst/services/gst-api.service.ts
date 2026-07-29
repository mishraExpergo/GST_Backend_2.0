import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosResponse } from 'axios';
import { GstAuthService } from './gst-auth.service';

export interface GstVerifyResponse {
  code?: number;
  timestamp?: number;
  data?: {
    data?: {
      legalName?: string;
      bussNature?: string;
      stateName?: string;
      validGstin?: boolean;
      stateCode?: string;
      pan?: string;
      gstin?: string;
      regStartDate?: string;
      status?: string;
    };
    status_cd?: string;
  };
  transaction_id?: string;
}

/**
 * Thin client for the external GST compliance API (axios based).
 * The access token is obtained from GstAuthService and refreshed on a 401.
 */
@Injectable()
export class GstApiService {
  private readonly logger = new Logger(GstApiService.name);
  private readonly timeoutMs = 15000;

  constructor(
    private readonly config: ConfigService,
    private readonly auth: GstAuthService,
  ) {}

  private get baseUrl(): string {
    return this.config
      .getOrThrow<string>('GST_API_BASE_URL')
      .replace(/\/+$/, '');
  }

  /** POST /gst/compliance/public/gstin/verify */
  async verifyGstin(gstin: string): Promise<GstVerifyResponse> {
    const url = `${this.baseUrl}/gst/compliance/public/gstin/verify`;
    return this.authedPost<GstVerifyResponse>(url, { gstin });
  }

  /** POST /gst/compliance/public/gstin/search */
  async searchGstin(gstin: string): Promise<Record<string, any>> {
    const url = `${this.baseUrl}/gst/compliance/public/gstin/search`;
    
    return this.authedPost<Record<string, any>>(url, { gstin });
  }

  /**
   * POST /gst/compliance/public/gstrs/track
   * Sandbox expects optional query params:
   *   gstr=gstr-1, financial_year=FY YYYY-YY
   */
  async trackGstrReturns(
    gstin: string,
    financialYear?: string,
    gstrType = 'gstr-1',
  ): Promise<Record<string, any>> {
    const params = new URLSearchParams({ gstr: gstrType });
    if (financialYear) {
      params.set(
        'financial_year',
        this.formatSandboxFinancialYear(financialYear),
      );
    }
    const url = `${this.baseUrl}/gst/compliance/public/gstrs/track?${params.toString()}`;
    return this.authedPost<Record<string, any>>(url, { gstin });
  }

  /**
   * POST /gst/compliance/public/pan/search?state_code=XX
   * Body: { pan }
   */
  async searchPanForState(
    pan: string,
    stateCode: string,
  ): Promise<Record<string, any>> {
    const params = new URLSearchParams({ state_code: stateCode });
    const url = `${this.baseUrl}/gst/compliance/public/pan/search?${params.toString()}`;
    return this.authedPost<Record<string, any>>(url, { pan });
  }

  /**
   * Search GSTINs for a PAN.
   * - With stateCode: single Sandbox call.
   * - Without: parallel calls for state codes 01..38, skipping 25, 28, 31, 35, 38.
   */
  async searchPan(
    pan: string,
    stateCode?: string | null,
  ): Promise<Record<string, any>> {
    const normalizedPan = String(pan ?? '')
      .trim()
      .toUpperCase();
    if (!normalizedPan) {
      throw new Error('"pan" is required.');
    }

    const trimmedState = String(stateCode ?? '').trim();
    if (trimmedState) {
      const code = this.normalizeStateCode(trimmedState);
      const data = await this.searchPanForState(normalizedPan, code);
      return {
        pan: normalizedPan,
        mode: 'single-state',
        stateCode: code,
        data,
      };
    }

    const skippedStateCodes = new Set([25, 28, 31, 35, 38]);
    const codes = Array.from({ length: 38 }, (_, i) => i + 1)
      .filter((n) => !skippedStateCodes.has(n))
      .map((n) => String(n).padStart(2, '0'));

    const results = await Promise.all(
      codes.map(async (code) => {
        try {
          const data = await this.searchPanForState(normalizedPan, code);
          return { stateCode: code, success: true as const, data };
        } catch (err) {
          return {
            stateCode: code,
            success: false as const,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );

    const succeeded = results.filter((r) => r.success);
    return {
      pan: normalizedPan,
      mode: 'all-states',
      skippedStateCodes: [...skippedStateCodes].map((n) =>
        String(n).padStart(2, '0'),
      ),
      totalStates: codes.length,
      succeeded: succeeded.length,
      failed: results.length - succeeded.length,
      results,
    };
  }

  /** GST state codes are two-digit strings 01..38. */
  private normalizeStateCode(raw: string): string {
    const n = Number.parseInt(raw, 10);
    if (!Number.isInteger(n) || n < 1 || n > 38) {
      throw new Error(
        `Invalid state_code "${raw}". Expected an integer from 1 to 38.`,
      );
    }
    return String(n).padStart(2, '0');
  }

  /** Sandbox track API requires "FY YYYY-YY" (e.g. "FY 2023-24"). */
  formatSandboxFinancialYear(financialYear: string): string {
    const match = financialYear.trim().match(/^(?:FY\s*)?(\d{4}-\d{2})$/i);
    if (!match) {
      throw new Error(
        `Invalid financial year "${financialYear}". Expected "YYYY-YY" or "FY YYYY-YY".`,
      );
    }
    return `FY ${match[1]}`;
  }

  /**
   * POST with the access token. Handles:
   *  - 401/403: re-authenticate once and retry.
   *  - 429 / 5xx / network errors: retry with exponential backoff + jitter.
   */
  private async authedPost<T>(
    url: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const maxRetries = Number(this.config.get('GST_API_MAX_RETRIES', '3'));
    const baseDelay = Number(this.config.get('GST_API_RETRY_BASE_MS', '500'));

    let attempt = 0;
    let reauthed = false;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const token = await this.auth.getAccessToken();

      let res: AxiosResponse | undefined;
      try {
        res = await this.rawPost(url, body, token);
      } catch (err) {
        // Network/timeout error: retry if we have attempts left.
        if (attempt < maxRetries) {
          attempt++;
          await this.delay(this.backoff(baseDelay, attempt));
          continue;
        }
        throw new Error(
          `GST API ${url} request failed: ${(err as Error).message}`,
        );
      }

      if ((res.status === 401 || res.status === 403) && !reauthed) {
        this.logger.warn(
          `GST API ${url} returned ${res.status}; refreshing access token and retrying.`,
        );
        reauthed = true;
        this.auth.invalidate();
        await this.auth.getAccessToken(true);
        continue;
      }

      if (this.isTransient(res.status) && attempt < maxRetries) {
        attempt++;
        this.logger.warn(
          `GST API ${url} returned ${res.status}; retry ${attempt}/${maxRetries}.`,
        );
        await this.delay(this.backoff(baseDelay, attempt));
        continue;
      }

      if (res.status < 200 || res.status >= 300) {
        const payload = JSON.stringify(res.data ?? {}).slice(0, 300);
        throw new Error(`GST API ${url} responded ${res.status}: ${payload}`);
      }

      return res.data as T;
    }
  }

  /**
   * GET with the access token. Handles:
   *  - 401/403: re-authenticate once and retry.
   *  - 429 / 5xx / network errors: retry with exponential backoff + jitter.
   */
  private async authedGet<T>(url: string): Promise<T> {
    const maxRetries = Number(this.config.get('GST_API_MAX_RETRIES', '3'));
    const baseDelay = Number(this.config.get('GST_API_RETRY_BASE_MS', '500'));

    let attempt = 0;
    let reauthed = false;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const token = await this.auth.getAccessToken();

      let res: AxiosResponse | undefined;
      try {
        res = await this.rawGet(url, token);
      } catch (err) {
        // Network/timeout error: retry if we have attempts left.
        if (attempt < maxRetries) {
          attempt++;
          await this.delay(this.backoff(baseDelay, attempt));
          continue;
        }
        throw new Error(
          `GST API ${url} request failed: ${(err as Error).message}`,
        );
      }

      if ((res.status === 401 || res.status === 403) && !reauthed) {
        this.logger.warn(
          `GST API ${url} returned ${res.status}; refreshing access token and retrying.`,
        );
        reauthed = true;
        this.auth.invalidate();
        await this.auth.getAccessToken(true);
        continue;
      }

      if (this.isTransient(res.status) && attempt < maxRetries) {
        attempt++;
        this.logger.warn(
          `GST API ${url} returned ${res.status}; retry ${attempt}/${maxRetries}.`,
        );
        await this.delay(this.backoff(baseDelay, attempt));
        continue;
      }

      if (res.status < 200 || res.status >= 300) {
        const payload = JSON.stringify(res.data ?? {}).slice(0, 300);
        throw new Error(`GST API ${url} responded ${res.status}: ${payload}`);
      }

      return res.data as T;
    }
  }

  private isTransient(status: number): boolean {
    return status === 429 || status >= 500;
  }

  private backoff(baseDelay: number, attempt: number): number {
    const expo = baseDelay * 2 ** (attempt - 1);
    const jitter = Math.floor(Math.random() * baseDelay);
    return expo + jitter;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private rawPost(
    url: string,
    body: Record<string, unknown>,
    token: string,
  ): Promise<AxiosResponse> {
    return axios.post(url, body, {
      headers: {
        'content-type': 'application/json',
        authorization: token,
        'x-api-key': this.config.get<string>('GST_API_KEY_LIVE', ''),
        'x-api-version': this.config.get<string>('GST_API_VERSION', ''),
        'x-accept-cache': this.config.get<string>('GST_API_ACCEPT_CACHE', 'true'),
      },
      timeout: this.timeoutMs,
      // Let us inspect 4xx/5xx ourselves (needed for the 401 retry flow).
      validateStatus: () => true,
    });
  }

  private rawGet(url: string, token: string): Promise<AxiosResponse> {
    return axios.get(url, {
      headers: {
        authorization: token,
        'x-api-key': this.config.get<string>('GST_API_KEY_LIVE', ''),
        'x-api-version': this.config.get<string>('GST_API_VERSION', ''),
        'x-accept-cache': this.config.get<string>('GST_API_ACCEPT_CACHE', 'true'),
      },
      timeout: this.timeoutMs,
      // Let us inspect 4xx/5xx ourselves (needed for the 401 retry flow).
      validateStatus: () => true,
    });
  }
}
