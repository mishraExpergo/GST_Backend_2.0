import { ConfigService } from '@nestjs/config';

export interface GstApiCredentials {
  apiKey: string;
  apiSecret: string;
  apiVersion: string;
}

/**
 * Resolve Sandbox API key/secret by host:
 * - test-api.sandbox.co.in → GST_API_KEY / GST_API_SECRET
 * - api.sandbox.co.in (and others) → prefer LIVE keys, fall back to test keys
 */
export function resolveGstApiCredentials(
  config: ConfigService,
): GstApiCredentials {
  const baseUrl = (
    config.get<string>('GST_API_BASE_URL') ?? ''
  ).toLowerCase();
  const apiVersion = config.get<string>('GST_API_VERSION', '1.0.0') || '1.0.0';

  const testKey = String(config.get<string>('GST_API_KEY') ?? '').trim();
  const testSecret = String(config.get<string>('GST_API_SECRET') ?? '').trim();
  const liveKey = String(config.get<string>('GST_API_KEY_LIVE') ?? '').trim();
  const liveSecret = String(
    config.get<string>('GST_API_SECRET_LIVE') ?? '',
  ).trim();

  const useTestHost = baseUrl.includes('test-api');

  if (useTestHost) {
    if (!testKey || !testSecret) {
      throw new Error(
        'GST_API_KEY and GST_API_SECRET are required when GST_API_BASE_URL uses test-api.',
      );
    }
    return { apiKey: testKey, apiSecret: testSecret, apiVersion };
  }

  const apiKey = liveKey || testKey;
  const apiSecret = liveSecret || testSecret;
  if (!apiKey || !apiSecret) {
    throw new Error(
      'GST_API_KEY_LIVE/GST_API_SECRET_LIVE (or GST_API_KEY/GST_API_SECRET) are required.',
    );
  }
  return { apiKey, apiSecret, apiVersion };
}
