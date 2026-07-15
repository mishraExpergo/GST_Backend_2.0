import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import { DataSource, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import {
  TaxpayerAuthSession,
  TaxpayerAuthState,
} from '../../../entities/taxpayer-auth-session.entity';
import { GstAuthService } from './gst-auth.service';

interface TaxpayerIdentity {
  username?: string;
  gstin: string;
}

@Injectable()
export class GstTaxpayerAuthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GstTaxpayerAuthService.name);
  private intervalRef: NodeJS.Timeout | null = null;
  private refreshRunning = false;

  constructor(
    private readonly config: ConfigService,
    private readonly gstAuthService: GstAuthService,
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(TaxpayerAuthSession)
    private readonly sessionRepo: Repository<TaxpayerAuthSession>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureTable();
    this.startRefreshScheduler();
  }

  onModuleDestroy(): void {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = null;
    }
  }

  async generateOtp(identity: TaxpayerIdentity): Promise<Record<string, any>> {
    const normalized = await this.normalizeIdentity(identity);
    const session = await this.getOrCreateSession(normalized);

    try {
      const platformToken = await this.gstAuthService.getAccessToken();
      const response = await this.postToSandbox(
        '/gst/compliance/tax-payer/otp',
        normalized,
        this.buildHeaders(platformToken, true),
      );

      await this.updateSession(session, {
        state: 'OTP_REQUIRED',
        otpValue: null,
        otpSubmittedAt: null,
        otpExpiresAt: null,
        lastError: null,
        metadata: {
          ...(session.metadata ?? {}),
          otpGeneratedAt: new Date().toISOString(),
          otpGenerateResponse: response,
        },
      });

      return {
        message: 'OTP generation request submitted successfully.',
        username: session.username,
        gstin: session.gstin,
        // state: 'OTP_REQUIRED',
        sandboxResponse: response,
      };
    } catch (err) {
      await this.markFailed(session, err);
      throw err;
    }
  }

  async submitOtp(
    identity: TaxpayerIdentity & { otp: string },
  ): Promise<Record<string, any>> {
    const normalized = await this.normalizeIdentity(identity);
    const otp = String(identity.otp ?? '').trim();
    if (!otp) {
      throw new BadRequestException('"otp" is required.');
    }

    const session = await this.getOrCreateSession(normalized);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.otpTtlMinutes * 60_000);

    await this.updateSession(session, {
      state: 'OTP_SUBMITTED',
      otpValue: otp,
      otpSubmittedAt: now,
      otpExpiresAt: expiresAt,
      lastError: null,
    });

    return {
      message: 'OTP submitted. Please verify within 10 minutes.',
      username: session.username,
      gstin: session.gstin,
      otpExpiresAt: expiresAt.toISOString(),
      state: 'OTP_SUBMITTED',
    };
  }

  async verifyOtp(
    identity: TaxpayerIdentity & { otp: string },
  ): Promise<Record<string, any>> {
    const normalized = await this.normalizeIdentity(identity);
    const session = await this.findSessionOrThrow(normalized);
    const otpValue = String(identity.otp ?? '').trim();
    if (!otpValue) {
      throw new BadRequestException('"otp" is required in verify request.');
    }

    const now = new Date();
    const otpExpiresAt = new Date(now.getTime() + this.otpTtlMinutes * 60_000);
    await this.updateSession(session, {
      state: 'OTP_SUBMITTED',
      otpValue,
      otpSubmittedAt: now,
      otpExpiresAt,
      lastError: null,
    });
    if (otpExpiresAt.getTime() <= Date.now()) {
      await this.updateSession(session, {
        state: 'OTP_REQUIRED',
        otpValue: null,
        otpSubmittedAt: null,
        otpExpiresAt: null,
        accessToken: null,
        tokenExpiresAt: null,
        lastError: 'OTP expired after 10 minutes. Regenerate OTP.',
      });
      throw new BadRequestException(
        'OTP has expired. Generate OTP and submit again.',
      );
    }

    try {
      const platformToken = await this.gstAuthService.getAccessToken();
      const body: Record<string, any> = {
        username: normalized.username,
        gstin: normalized.gstin,
        otp: otpValue,
      };

      const response = await this.postToSandbox(
        '/gst/compliance/tax-payer/otp/verify',
        body,
        this.buildHeaders(platformToken, true),
      );

      const accessToken = this.extractToken(response);
      if (!accessToken) {
        throw new BadRequestException(
          'OTP verify succeeded but no access token was returned.',
        );
      }

      const tokenExpiresAt = this.computeTokenExpiry(response);
      const now = new Date();

      await this.updateSession(session, {
        state: 'AUTHENTICATED',
        otpValue: null,
        otpSubmittedAt: null,
        otpExpiresAt: null,
        accessToken,
        tokenExpiresAt,
        lastVerifiedAt: now,
        lastRefreshedAt: now,
        lastError: null,
        metadata: {
          ...(session.metadata ?? {}),
          otpVerifyResponse: response,
        },
      });

      return {
        message: 'OTP verified successfully. Taxpayer session is authenticated.',
        username: session.username,
        gstin: session.gstin,
        state: 'AUTHENTICATED',
        tokenExpiresAt: tokenExpiresAt.toISOString(),
      };
    } catch (err) {
      await this.markFailed(session, err);
      throw err;
    }
  }

  async refreshAccessToken(identity: TaxpayerIdentity): Promise<Record<string, any>> {
    const normalized = await this.normalizeIdentity(identity);
    const session = await this.findSessionOrThrow(normalized);
    return this.refreshSession(session);
  }

  async getAccessTokenForTaxpayer(
    identity: TaxpayerIdentity,
    refreshBeforeUse = true,
  ): Promise<string> {
    const normalized = await this.normalizeIdentity(identity);
    const session = await this.findSessionOrThrow(normalized);

    if (!session.accessToken) {
      throw new BadRequestException(
        'Taxpayer session is not authenticated. Complete OTP verification first.',
      );
   
   
    }

    if (refreshBeforeUse) {
      const refreshed = await this.refreshSession(session);
      const latest = await this.findSessionOrThrow(normalized);
      if (!latest.accessToken) {
        throw new BadRequestException(
          'Token refresh succeeded but access token is missing.',
        );
      }
      void refreshed;
      return latest.accessToken;
    }

    return session.accessToken;
  }

  async getSessionStatus(identity: TaxpayerIdentity): Promise<Record<string, any>> {
    const normalized = await this.normalizeIdentity(identity);
    const session = await this.findSessionOrThrow(normalized);
    return {
      username: session.username,
      gstin: session.gstin,
      state: session.state,
      tokenExpiresAt: session.tokenExpiresAt?.toISOString() ?? null,
      otpExpiresAt: session.otpExpiresAt?.toISOString() ?? null,
      lastVerifiedAt: session.lastVerifiedAt?.toISOString() ?? null,
      lastRefreshedAt: session.lastRefreshedAt?.toISOString() ?? null,
      lastError: session.lastError,
    };
  }

  private get otpTtlMinutes(): number {
    return Math.max(
      1,
      Number(this.config.get('GST_TAXPAYER_OTP_TTL_MINUTES', '10')),
    );
  }

  private get tokenTtlHours(): number {
    return Math.max(
      1,
      Number(this.config.get('GST_TAXPAYER_TOKEN_TTL_HOURS', '6')),
    );
  }

  private get refreshLeadMinutes(): number {
    return Math.max(
      1,
      Number(this.config.get('GST_TAXPAYER_REFRESH_LEAD_MINUTES', '15')),
    );
  }

  private get refreshIntervalMs(): number {
    return Math.max(
      60_000,
      Number(this.config.get('GST_TAXPAYER_REFRESH_INTERVAL_MS', '300000')),
    );
  }

  private get sandboxBaseUrl(): string {
    return this.config
      .getOrThrow<string>('GST_API_BASE_URL')
      .replace(/\/+$/, '');
  }

  private async normalizeIdentity(
    identity: TaxpayerIdentity,
  ): Promise<{ username: string; gstin: string }> {
    const gstin = String(identity.gstin ?? '').trim().toUpperCase();
    if (!gstin) {
      throw new BadRequestException('"gstin" is required.');
    }

    let username = String(identity.username ?? '').trim();
    if (!username) {
      username = await this.resolveUsernameFromUploadTable(gstin);
    }

    return { username, gstin };
  }

  /**
   * Loads taxpayer portal username from gst_uploaded_file_data.username
   * for the given GSTIN (primary_gst_no or considered_entity_gst_no).
   */
  private async resolveUsernameFromUploadTable(gstin: string): Promise<string> {
    const tableName = this.sanitizeTableName(
      this.config.get<string>(
        'GST_AGGREGATION_SOURCE_TABLE',
        'gst_uploaded_file_data',
      ),
    );

    const columns: Array<{ column_name: string }> = await this.dataSource.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1`,
      [tableName],
    );
    const colSet = new Set(
      columns.map((c) => String(c.column_name ?? '').toLowerCase()),
    );

    if (!colSet.has('username')) {
      throw new BadRequestException(
        `Column "username" not found in "${tableName}". Upload data must include a username column.`,
      );
    }

    const gstColumns = [
      'primary_gst_no',
      'considered_entity_gst_no',
      'gst_no',
    ].filter((name) => colSet.has(name));

    if (gstColumns.length === 0) {
      throw new BadRequestException(
        `No GSTIN column found in "${tableName}" (expected primary_gst_no / considered_entity_gst_no).`,
      );
    }

    const whereClause = gstColumns
      .map((col) => `UPPER(TRIM(COALESCE("${col}", ''))) = $1`)
      .join(' OR ');

    const rows: Array<{ username: string | null }> = await this.dataSource.query(
  
      `SELECT TRIM(username) AS username
         FROM "${tableName}"
        WHERE (${whereClause})
          AND TRIM(COALESCE(username, '')) <> ''
        LIMIT 1`,
      [gstin],
    );

    const username = String(rows[0]?.username ?? '').trim();
    if (!username) {
      throw new NotFoundException(
        `No username found in "${tableName}" for GSTIN "${gstin}".`,
      );
    }

    return username;
  }

  private sanitizeTableName(rawTableName?: string): string {
    const tableName = String(rawTableName ?? 'gst_uploaded_file_data').trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) {
      throw new BadRequestException(`Invalid source table name: ${tableName}`);
    }
    return tableName;
  }

  private async getOrCreateSession(
    identity: { username: string; gstin: string },
  ): Promise<TaxpayerAuthSession> {
    const existing = await this.sessionRepo.findOne({
      where: { username: identity.username, gstin: identity.gstin },
    });
    if (existing) return existing;

    return this.sessionRepo.save(
      this.sessionRepo.create({
        username: identity.username,
        gstin: identity.gstin,
        state: 'OTP_REQUIRED',
      }),
    );
  }

  private async findSessionOrThrow(
    identity: { username: string; gstin: string },
  ): Promise<TaxpayerAuthSession> {
    const session = await this.sessionRepo.findOne({
      where: { username: identity.username, gstin: identity.gstin },
    });
    if (!session) {
      throw new NotFoundException(
        `No taxpayer session found for username="${identity.username}" and gstin="${identity.gstin}".`,
      );
    }
    return session;
  }

  private async refreshSession(
    session: TaxpayerAuthSession,
  ): Promise<Record<string, any>> {
    if (!session.accessToken) {
      throw new BadRequestException(
        'No active access token found. Complete OTP verification first.',
      );
    }

    try {
      const response = await this.postToSandbox(
        '/gst/compliance/tax-payer/session/refresh',
        undefined,
        this.buildHeaders(session.accessToken, false),
      );

      const refreshedToken = this.extractToken(response) || session.accessToken;
      const tokenExpiresAt = this.computeTokenExpiry(response);

      await this.updateSession(session, {
        state: 'AUTHENTICATED',
        accessToken: refreshedToken,
        tokenExpiresAt,
        lastRefreshedAt: new Date(),
        lastError: null,
        metadata: {
          ...(session.metadata ?? {}),
          refreshResponse: response,
        },
      });

      return {
        message: 'Access token refreshed successfully.',
        username: session.username,
        gstin: session.gstin,
        state: 'AUTHENTICATED',
        tokenExpiresAt: tokenExpiresAt.toISOString(),
      };
    } catch (err) {
      const tokenExpired =
        !!session.tokenExpiresAt && session.tokenExpiresAt.getTime() <= Date.now();
      await this.updateSession(session, {
        state: tokenExpired ? 'OTP_REQUIRED' : session.state,
        lastError: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  private extractToken(response: Record<string, any>): string | null {
    const candidates = [
      response?.access_token,
      response?.accessToken,
      response?.data?.access_token,
      response?.data?.accessToken,
      response?.token,
      response?.data?.token,
    ];

    for (const token of candidates) {
      if (typeof token === 'string' && token.trim()) {
        return token;
      }
    }
    return null;
  }

  private computeTokenExpiry(response: Record<string, any>): Date {
    const ttlCandidates = [
      response?.expires_in,
      response?.expiresIn,
      response?.data?.expires_in,
      response?.data?.expiresIn,
    ];
    for (const c of ttlCandidates) {
      const seconds = Number(c);
      if (Number.isFinite(seconds) && seconds > 0) {
        return new Date(Date.now() + seconds * 1000);
      }
    }
    return new Date(Date.now() + this.tokenTtlHours * 60 * 60 * 1000);
  }

  private buildHeaders(
    authorization: string,
    includeJsonContentType: boolean,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      authorization,
      'x-api-key': this.config.get<string>('GST_API_KEY_LIVE', ''),
      'x-api-version': this.config.get<string>('GST_API_VERSION', '1.0.0'),
      'x-source': this.config.get<string>('GST_TAXPAYER_SOURCE', 'primary'),
    };
    if (includeJsonContentType) {
      headers['content-type'] = 'application/json';
    }
    return headers;
  }

  private async postToSandbox(
    path: string,
    body: Record<string, any> | undefined,
    headers: Record<string, string>,
  ): Promise<Record<string, any>> {
    const url = `${this.sandboxBaseUrl}${path}`;
    const timeoutMs = 15_000;
    const maxRetries = Number(this.config.get('GST_API_MAX_RETRIES', '3'));
    const baseDelay = Number(this.config.get('GST_API_RETRY_BASE_MS', '500'));

    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const response = await axios.post(url, body, {
        headers,
        timeout: timeoutMs,
        validateStatus: () => true,
      });

      if (
        (response.status === 429 || response.status >= 500) &&
        attempt < maxRetries
      ) {
        attempt++;
        await this.delay(baseDelay * 2 ** (attempt - 1));
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        const payload = JSON.stringify(response.data ?? {}).slice(0, 300);
        throw new BadRequestException(
          `Sandbox API ${path} failed with ${response.status}: ${payload}`,
        );
      }
      return (response.data ?? {}) as Record<string, any>;
    }
  }

  private async updateSession(
    session: TaxpayerAuthSession,
    patch: Partial<TaxpayerAuthSession>,
  ): Promise<TaxpayerAuthSession> {
    Object.assign(session, patch);
    return this.sessionRepo.save(session);
  }

  private async markFailed(
    session: TaxpayerAuthSession,
    err: unknown,
  ): Promise<void> {
    await this.updateSession(session, {
      state: 'FAILED',
      lastError: err instanceof Error ? err.message : String(err),
    });
  }

  private startRefreshScheduler(): void {
    this.intervalRef = setInterval(() => {
      void this.refreshSessionsDue().catch((err) => {
        this.logger.error(
          `Auto-refresh scheduler failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    }, this.refreshIntervalMs);
  }

  private async refreshSessionsDue(): Promise<void> {
    if (this.refreshRunning) return;
    this.refreshRunning = true;

    try {
      const cutoff = new Date(Date.now() + this.refreshLeadMinutes * 60_000);
      const dueSessions = await this.sessionRepo.find({
        where: [
          {
            state: 'AUTHENTICATED' as TaxpayerAuthState,
            tokenExpiresAt: LessThanOrEqual(cutoff),
          },
          {
            state: 'AUTHENTICATED' as TaxpayerAuthState,
            tokenExpiresAt: IsNull(),
          },
        ],
      });

      for (const session of dueSessions) {
        try {
          await this.refreshSession(session);
          this.logger.log(
            `Auto-refreshed taxpayer token for username=${session.username}, gstin=${session.gstin}`,
          );
        } catch (err) {
          this.logger.error(
            `Auto-refresh failed for username=${session.username}, gstin=${session.gstin}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    } finally {
      this.refreshRunning = false;
    }
  }

  private async ensureTable(): Promise<void> {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS taxpayer_auth_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        username text NOT NULL,
        gstin text NOT NULL,
        state character varying(32) NOT NULL DEFAULT 'OTP_REQUIRED',
        otp_value text NULL,
        otp_submitted_at timestamptz NULL,
        otp_expires_at timestamptz NULL,
        access_token text NULL,
        token_expires_at timestamptz NULL,
        last_verified_at timestamptz NULL,
        last_refreshed_at timestamptz NULL,
        last_error text NULL,
        metadata jsonb NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await this.dataSource.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_taxpayer_auth_sessions_username_gstin
      ON taxpayer_auth_sessions (username, gstin)
    `);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
