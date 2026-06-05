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
        'x-api-key': this.config.get<string>('GST_API_KEY', ''),
        'x-api-version': this.config.get<string>('GST_API_VERSION', ''),
        'x-accept-cache': this.config.get<string>('GST_API_ACCEPT_CACHE', 'true'),
      },
      timeout: this.timeoutMs,
      // Let us inspect 4xx/5xx ourselves (needed for the 401 retry flow).
      validateStatus: () => true,
    });
  }
}
