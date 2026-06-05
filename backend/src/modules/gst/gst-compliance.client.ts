import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface GstVerifyPayload {
  gstin: string;
}

export interface GstVerifyInnerData {
  legalName?: string;
  bussNature?: string;
  stateName?: string;
  validGstin?: boolean;
  stateCode?: string;
  pan?: string;
  gstin?: string;
  regStartDate?: string;
  status?: string;
}

export interface GstVerifyResponse {
  code?: number;
  timestamp?: number;
  data?: {
    data?: GstVerifyInnerData;
    status_cd?: string;
  };
  transaction_id?: string;
}

export interface GstSearchResponse {
  code?: number;
  timestamp?: number;
  data?: Record<string, unknown>;
  transaction_id?: string;
}

@Injectable()
export class GstComplianceClient {
  private readonly logger = new Logger(GstComplianceClient.name);

  constructor(private readonly configService: ConfigService) {}

  async verifyGstin(gstin: string): Promise<GstVerifyResponse> {
    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/gst/compliance/public/gstin/verify`;

    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildVerifyHeaders(),
      body: JSON.stringify({ gstin }),
    });

    const body = (await response.json()) as GstVerifyResponse;

    if (!response.ok) {
      this.logger.error(
        `GST verify failed for ${gstin}: HTTP ${response.status}`,
      );
      throw new Error(
        `GST verify API returned HTTP ${response.status} for ${gstin}`,
      );
    }

    return body;
  }

  async searchGstin(gstin: string): Promise<GstSearchResponse> {
    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/gst/compliance/public/gstin/search`;

    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildSearchHeaders(),
      body: JSON.stringify({ gstin }),
    });

    const body = (await response.json()) as GstSearchResponse;

    if (!response.ok) {
      this.logger.error(
        `GST search failed for ${gstin}: HTTP ${response.status}`,
      );
      throw new Error(
        `GST search API returned HTTP ${response.status} for ${gstin}`,
      );
    }

    return body;
  }

  private getBaseUrl(): string {
    const baseUrl = this.configService.get<string>('GST_API_BASE_URL');
    if (!baseUrl?.trim()) {
      throw new Error('GST_API_BASE_URL is not configured');
    }
    return baseUrl.replace(/\/+$/, '');
  }

  private buildVerifyHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-accept-cache': 'true',
      'x-api-key': this.configService.get<string>('GST_API_KEY', ''),
      'x-api-version': this.configService.get<string>('GST_API_VERSION', ''),
    };
  }

  private buildSearchHeaders(): Record<string, string> {
    const accessToken = this.configService.get<string>('GST_API_ACCESS_TOKEN');
    if (!accessToken?.trim()) {
      throw new Error('GST_API_ACCESS_TOKEN is not configured');
    }

    return {
      'Content-Type': 'application/json',
      authorization: accessToken,
      'x-api-key': this.configService.get<string>('GST_API_KEY', ''),
      'x-api-version': this.configService.get<string>('GST_API_VERSION', ''),
      'x-accept-cache': 'true',
    };
  }
}
