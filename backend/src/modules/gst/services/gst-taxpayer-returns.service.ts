import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { GstTaxpayerAuthService } from './gst-taxpayer-auth.service';

interface TaxpayerIdentity {
  username: string;
  gstin: string;
}

@Injectable()
export class GstTaxpayerReturnsService {
  private readonly logger = new Logger(GstTaxpayerReturnsService.name);
  private readonly timeoutMs = 15_000;

  constructor(
    private readonly config: ConfigService,
    private readonly taxpayerAuthService: GstTaxpayerAuthService,
  ) {}

  async fetchGstr1(
    identity: TaxpayerIdentity,
    year: number,
    month: number,
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
    );
  }

  async fetchGstr2b(
    identity: TaxpayerIdentity,
    year: number,
    month: number,
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
    );
  }

  async fetchGstr3b(
    identity: TaxpayerIdentity,
    year: number,
    month: number,
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
    );
  }

  private get baseUrl(): string {
    return this.config
      .getOrThrow<string>('GST_API_BASE_URL')
      .replace(/\/+$/, '');
  }

  private async fetchReturn(
    identity: TaxpayerIdentity,
    path: string,
    returnType: 'GSTR-1' | 'GSTR-2B' | 'GSTR-3B',
    year: number,
    month: number,
  ): Promise<Record<string, any>> {
    const maxRetries = Number(this.config.get('GST_API_MAX_RETRIES', '3'));
    const baseDelay = Number(this.config.get('GST_API_RETRY_BASE_MS', '500'));
    const forceRefreshPerRequest =
      this.config.get<string>('GST_TAXPAYER_REFRESH_ON_EVERY_REQUEST', 'true') ===
      'true';

    let attempt = 0;
    let retriedAfter401 = false;

    while (true) {
      const accessToken = await this.taxpayerAuthService.getAccessTokenForTaxpayer(
        identity,
        forceRefreshPerRequest,
      );

      const url = `${this.baseUrl}${path}`;
      const response = await axios.get(url, {
        headers: {
          authorization: accessToken,
          'x-api-key': this.config.get<string>('GST_API_KEY_LIVE', ''),
          'x-api-version': this.config.get<string>('GST_API_VERSION', '1.0.0'),
        },
        timeout: this.timeoutMs,
        validateStatus: () => true,
      });

      if (
        (response.status === 401 || response.status === 403) &&
        !retriedAfter401
      ) {
        retriedAfter401 = true;
        await this.taxpayerAuthService.refreshAccessToken(identity);
        continue;
      }

      if (
        (response.status === 429 || response.status >= 500) &&
        attempt < maxRetries
      ) {
        attempt++;
        await this.delay(baseDelay * 2 ** (attempt - 1));
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        throw new UnauthorizedException(
          `${returnType} fetch unauthorized. Taxpayer session may be expired; regenerate OTP.`,
        );
      }

      if (response.status < 200 || response.status >= 300) {
        const payload = JSON.stringify(response.data ?? {}).slice(0, 300);
        this.logger.error(
          `${returnType} fetch failed for ${identity.gstin} (${year}-${month}) with ${response.status}: ${payload}`,
        );
        throw new BadGatewayException(
          `${returnType} API failed with status ${response.status}.`,
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

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
