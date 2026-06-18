import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosResponse } from 'axios';
import { v4 as uuidv4 } from 'uuid';

/**
 * Client for the Whitebooks GST portal API (api.whitebooks.in).
 * Used for GSTR-3B return summary (retsum) and similar endpoints.
 */
@Injectable()
export class WhitebooksApiService {
  private readonly logger = new Logger(WhitebooksApiService.name);
  private readonly timeoutMs = 15000;

  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string {
    return this.config
      .getOrThrow<string>('WHITEBOOKS_API_BASE_URL')
      .replace(/\/+$/, '');
  }

  /**
   * GET /gstr3b/retsum
   * Fetches GSTR-3B return summary for a GSTIN and return period (MMYYYY).
   */
  async getGstr3bRetsum(
    gstin: string,
    retperiod: string,
  ): Promise<Record<string, any>> {
    const txn = uuidv4();
    const params = new URLSearchParams({
      gstin,
      retperiod,
      email: this.config.getOrThrow<string>('WHITEBOOKS_EMAIL'),
    });
    const url = `${this.baseUrl}/gstr3b/retsum?${params.toString()}`;

    return this.requestWithRetry(url, {
      accept: '*/*',
      gst_username: this.config.getOrThrow<string>('WHITEBOOKS_GST_USERNAME'),
      state_cd: gstin.substring(0, 2),
      ip_address: this.config.getOrThrow<string>('WHITEBOOKS_IP_ADDRESS'),
      txn,
      client_id: this.buildClientId(txn),
      client_secret: this.config.getOrThrow<string>('WHITEBOOKS_CLIENT_SECRET'),
    });
  }

  /** Whitebooks client_id embeds the per-request txn UUID. */
  private buildClientId(txn: string): string {
    const template = this.config.get<string>(
      'WHITEBOOKS_CLIENT_ID',
      'GSTS{txn}-{suffix}',
    );
    const suffix = this.config.getOrThrow<string>('WHITEBOOKS_CLIENT_ID_SUFFIX');
    return template.replace('{txn}', txn).replace('{suffix}', suffix);
  }

  private async requestWithRetry<T>(
    url: string,
    headers: Record<string, string>,
  ): Promise<T> {
    const maxRetries = Number(this.config.get('GST_API_MAX_RETRIES', '3'));
    const baseDelay = Number(this.config.get('GST_API_RETRY_BASE_MS', '500'));

    let attempt = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      let res: AxiosResponse | undefined;
      try {
        res = await axios.get(url, {
          headers,
          timeout: this.timeoutMs,
          validateStatus: () => true,
        });
      } catch (err) {
        if (attempt < maxRetries) {
          attempt++;
          await this.delay(this.backoff(baseDelay, attempt));
          continue;
        }
        throw new Error(
          `Whitebooks API ${url} request failed: ${(err as Error).message}`,
        );
      }

      if (!res) {
        throw new Error(`Whitebooks API ${url} received no response.`);
      }

      const response = res;

      if (this.isTransient(response.status) && attempt < maxRetries) {
        attempt++;
        this.logger.warn(
          `Whitebooks API ${url} returned ${response.status}; retry ${attempt}/${maxRetries}.`,
        );
        await this.delay(this.backoff(baseDelay, attempt));
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        const payload = JSON.stringify(response.data ?? {}).slice(0, 300);
        throw new Error(
          `Whitebooks API ${url} responded ${response.status}: ${payload}`,
        );
      }

      return response.data as T;
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
}
