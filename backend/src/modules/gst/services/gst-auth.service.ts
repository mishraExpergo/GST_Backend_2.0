import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';

/**
 * Handles authentication against the external GST (Sandbox) API.
 * One authenticate call returns an access token that is reused for all
 * subsequent verify/search calls. The token is cached in-memory and
 * re-fetched on demand (e.g. after a 401).
 */
@Injectable()
export class GstAuthService {
  private readonly logger = new Logger(GstAuthService.name);
  private readonly timeoutMs = 15000;

  private cachedToken: string | null = null;
  private inFlight: Promise<string> | null = null;

  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string {
    return this.config
      .getOrThrow<string>('GST_API_BASE_URL')
      .replace(/\/+$/, '');
  }

  private get authUrl(): string {
    return (
      this.config.get<string>('GST_API_AUTH_URL') ||
      `${this.baseUrl}/authenticate`
    );
  }

  /** Returns a valid access token, authenticating if needed. */
  async getAccessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.cachedToken) {
      return this.cachedToken;
    }
    // Collapse concurrent callers onto a single authenticate request.
    if (!this.inFlight) {
      this.inFlight = this.authenticate()
        .then((token) => {
          this.cachedToken = token;
          return token;
        })
        .finally(() => {
          this.inFlight = null;
        });
    }
    return this.inFlight;
  }

  /** Drop the cached token so the next call re-authenticates. */
  invalidate(): void {
    this.cachedToken = null;
  }

  private async authenticate(): Promise<string> {
    try {
      const res = await axios.post(
        this.authUrl,
        undefined,
        {
          headers: {
            'x-api-key': this.config.getOrThrow<string>('GST_API_KEY_LIVE'),
            'x-api-secret': this.config.getOrThrow<string>('GST_API_SECRET_LIVE'),
            'x-api-version': this.config.get<string>('GST_API_VERSION', ''),
          },
          timeout: this.timeoutMs,
        },
      );

      const json = res.data ?? {};
      const token =
        json?.access_token ??
        json?.data?.access_token ??
        json?.data?.accessToken ??
        json?.accessToken;

      if (!token || typeof token !== 'string') {
        throw new Error(
          'GST authenticate response did not contain an access_token.',
        );
      }

      this.logger.log('Obtained new GST API access token.');
      return token;
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const axErr = err as AxiosError;
        const status = axErr.response?.status;
        const body = JSON.stringify(axErr.response?.data ?? {}).slice(0, 300);
        throw new Error(
          `GST authenticate failed${status ? ` (${status})` : ''}: ${body || axErr.message}`,
        );
      }
      throw err;
    }
  }
}
