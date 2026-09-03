/// <reference types="multer" />
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Optional,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ClientProxy } from '@nestjs/microservices';
import { randomUUID } from 'crypto';
import { GstService, GST_UPLOAD_TABLE } from './gst.service';
import { GstComplianceService } from './services/gst-compliance.service';
import { GstApiService } from './services/gst-api.service';
import { GstTaxpayerAuthService } from './services/gst-taxpayer-auth.service';
import { GstTaxpayerReturnsService } from './services/gst-taxpayer-returns.service';
import { ApiRequestLogService } from './services/api-request-log.service';
import {
  GstReturnAggregationSchedulerService,
  type SchedulerReturnType,
} from './services/gst-return-aggregation-scheduler.service';
import { GstTaxPaymentChartService } from './services/gst-tax-payment-chart.service';
import { GstRegistrationStatusChartService } from './services/gst-registration-status-chart.service';
import { GstLegalRiskChartService } from './services/gst-legal-risk-chart.service';
import { GstSupplierConcentrationChartService } from './services/gst-supplier-concentration-chart.service';
import { GstGeographicConcentrationChartService } from './services/gst-geographic-concentration-chart.service';
import { FileStorageService } from '../shared/services/file-storage.service';
import type { ApiRequestStatus } from '../../entities/api-request-log.entity';
import { Public } from '../../auth/public.decorator';

@Controller('gst')
export class GstController {
  constructor(
    private readonly gstService: GstService,
    private readonly fileStorageService: FileStorageService,
    private readonly gstComplianceService: GstComplianceService,
    private readonly gstApiService: GstApiService,
    private readonly gstTaxpayerAuthService: GstTaxpayerAuthService,
    private readonly gstTaxpayerReturnsService: GstTaxpayerReturnsService,
    private readonly apiRequestLogService: ApiRequestLogService,
    private readonly returnAggregationScheduler: GstReturnAggregationSchedulerService,
    private readonly taxPaymentChartService: GstTaxPaymentChartService,
    private readonly registrationStatusChartService: GstRegistrationStatusChartService,
    private readonly legalRiskChartService: GstLegalRiskChartService,
    private readonly supplierConcentrationChartService: GstSupplierConcentrationChartService,
    private readonly geographicConcentrationChartService: GstGeographicConcentrationChartService,
    @Optional() @Inject('EXCEL_SERVICE') private readonly excelClient?: ClientProxy,
  ) {}

  /**
   * GET /gst/data
   * Returns rows from gst_uploaded_file_data (dashboard).
   */
  @Get('data')
  async getUploadedData(
    @Query('tableName') tableName = GST_UPLOAD_TABLE,
    @Query('page') page = '1',
    @Query('limit') limit = '50',
  ) {
    return this.gstService.getTableData(
      tableName,
      Number.parseInt(page, 10) || 1,
      Number.parseInt(limit, 10) || 50,
    );
  }

  /**
   * GET /gst/compliance/public?loanId=...
   * Returns all GST compliance records for the given loanId from MongoDB.
   */
  @Get('compliance/public')
  async getPublicComplianceData(@Query('loanId') loanId?: string) {
    const normalizedLoanId = loanId?.trim();
    if (!normalizedLoanId) {
      throw new BadRequestException('Query parameter "loanId" is required.');
    }

    const data = await this.gstService.getPublicComplianceData(normalizedLoanId);
    console.log(data);
    return data;
  }

  /**
   * POST /gst/compliance/public/batch
   * Batch equivalent of GET /gst/compliance/public used by the dashboard.
   */
  @Post('compliance/public/batch')
  @HttpCode(HttpStatus.OK)
  async getPublicComplianceDataBatch(
    @Body('requests')
    requests: Array<{
      loanId: string;
      pan?: string;
      page?: number;
      limit?: number;
    }>,
  ) {
    if (!Array.isArray(requests)) {
      throw new BadRequestException('"requests" must be an array.');
    }
    return this.gstService.getPublicComplianceDataBatch(requests);
  }

  /**
   * POST /gst/compliance/public/pan/search?state_code=37
   * Body: { "pan": "AAACN0255D" }
   * Resolves loanId + customerId from gst_uploaded_file_data (primary_pan),
   * then Sandbox-searches primary + considered-entity PANs and returns
   * listed/unlisted GSTINs per loan/customer.
   */
  @Post('compliance/public/pan/search')
  @Public()
  @HttpCode(HttpStatus.OK)
  async searchPanByPrimaryPan(
    @Body('pan') pan: string,
    @Query('state_code') stateCode?: string,
  ) {
    try {
      const data = await this.gstService.searchPanByPrimaryPan(pan, stateCode);
      return this.successResponse('compliance.public.pan-search', data);
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }
      throw new BadRequestException(
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /**
   * GET /gst/compliance/public/pan/search?pan=AAACN0255D&state_code=37
   * Resolves loanId/customerId from upload for the PAN, then reads stored
   * MongoDB snapshot(s). Omit state_code to return every searchKey.
   */
  @Get('compliance/public/pan/search')
  @Public()
  async getPanSearchByPrimaryPan(
    @Query('pan') pan?: string,
    @Query('state_code') stateCode?: string,
  ) {
    const data = await this.gstService.getPanSearchByPrimaryPan(
      pan ?? '',
      stateCode,
    );
    return this.successResponse('compliance.public.pan-search.get', data);
  }

  /**
   * GET /gst/compliance/gstr-2b-3b?customerId=...&years=2024,2025&months=1,2,3
   * Returns stored GSTR-2B and GSTR-3B compliance docs for a customer,
   * filtered by the given years and months, as { GST2B, GST3B }.
   */
  @Get('compliance/gstr-2b-3b')
  async getGstr2bAnd3bByCustomer(
    @Query('customerId') customerId?: string,
    @Query('years') yearsRaw?: string | string[],
    @Query('months') monthsRaw?: string | string[],
  ) {
    const normalizedCustomerId = customerId?.trim();
    if (!normalizedCustomerId) {
      throw new BadRequestException('Query parameter "customerId" is required.');
    }

    const years = this.parseIntList(yearsRaw, 'years');
    const months = this.parseIntList(monthsRaw, 'months');

    if (years.length === 0) {
      throw new BadRequestException(
        'Query parameter "years" is required (e.g. years=2024,2025).',
      );
    }
    if (months.length === 0) {
      throw new BadRequestException(
        'Query parameter "months" is required (e.g. months=1,2,3).',
      );
    }

    return this.gstService.getGstr2bAnd3bByCustomer({
      customerId: normalizedCustomerId,
      years,
      months,
    });
  }

  /**
   * GET /gst/customer-gstr-status-counts
   * Uses customer/loan/GSTIN units from gst_uploaded_file_data and returns
   * per-customer updated, pending, and failed counts from their latest
   * matching API logs for GSTREG1, GSTR1, GSTR2B, and GSTR3B.
   */
  @Get('customer-gstr-status-counts')
  async getCustomerGstrStatusCounts() {
    return this.gstService.getCustomerGstrStatusCounts();
  }

  /**
   * GET /gst/api-request-logs?loanId=...&gstin=...
   * Returns rows from api_request_logs matching the given loanId and/or
   * gstin (matched with OR), plus lastUpdatedAt (most recent log timestamp
   * among the matches). Matching on gstin as well as loanId matters because
   * some log rows have unreliable/placeholder associated_loan_id values but
   * a correctly populated gst_number. Used to fill the pending Operational
   * Status fields (API Name, Data Source, Retry Count, API Status) and the
   * "Last Updated" shown on Company Summary / Company Details.
   */
  @Get('api-request-logs')
  async getApiRequestLogs(
    @Query('loanId') loanId?: string,
    @Query('gstin') gstin?: string,
  ) {
    const normalizedLoanId = loanId?.trim();
    const normalizedGstin = gstin?.trim();

    if (!normalizedLoanId && !normalizedGstin) {
      throw new BadRequestException('Query parameter "loanId" or "gstin" is required.');
    }

    return this.gstService.getApiRequestLogs({
      loanId: normalizedLoanId,
      gstin: normalizedGstin,
    });
  }

  /**
   * POST /gst/api-request-logs/batch
   * Batch equivalent of GET /gst/api-request-logs used by the dashboard.
   */
  @Post('api-request-logs/batch')
  @HttpCode(HttpStatus.OK)
  async getApiRequestLogsBatch(
    @Body('requests')
    requests: Array<{ loanId?: string; gstin?: string }>,
  ) {
    if (!Array.isArray(requests)) {
      throw new BadRequestException('"requests" must be an array.');
    }
    return this.gstService.getApiRequestLogsBatch(requests);
  }

  /**
   * GET /gst/aggregation?loanId=...
   * Returns the flattened { outputField, output } rows for the Aggregation
   * Table modal (primary company + every considered/secondary entity for
   * that loan), read from primary_gst_aggregation / secondary_gst_aggregation.
   */
  @Get('aggregation')
  async getAggregationData(
    @Query('loanId') loanId: string,
    @Query('type') type?: string,
  ) {
    if (!loanId) {
      throw new BadRequestException('loanId is required');
    }

    // Default to primary if not provided, for backwards compatibility
    const requestedType = type === 'secondary' ? 'secondary' : 'primary';

    // Call the updated service method
    const result = await this.gstService.getAggregationTable(loanId, requestedType);

    // Format the response to match the AggregationApiResponse interface your frontend expects
    return {
      loanId: loanId,
      count: result.rows.length,
      data: result.rows,
      debug: result.debug // Optional: keep for debugging purposes
    };
  }

  /**
   * GET /gst/charts/tax-payment
   * Tax Payment chart (GSTR-3B): stacked ITC Utilised + Cash Tax Paid, dotted Total.
   *
   * Response data:
   *   - series: period points for bars/line and hover tooltip
   *   - incomplete + missing: Fetch Data | Continue Anyway popup
   *   - drilldown: GSTIN rows when financialYear / year+month is sent
   *   - fetch: job ids when fetchMissing=true
   *
   * Required: entityType=PAN|LOAN, entityId, range=1y|3y|5y
   * Optional: granularity, financialYear, half, quarter, year, month, fetchMissing, username, tableName
   */
  @Get('charts/tax-payment')
  async getTaxPaymentChart(
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('range') range?: string,
    @Query('granularity') granularity?: string,
    @Query('tableName') tableName?: string,
    @Query('financialYear') financialYear?: string,
    @Query('half') half?: string,
    @Query('quarter') quarter?: string,
    @Query('year') year?: string,
    @Query('month') month?: string,
    @Query('fetchMissing') fetchMissing?: string,
    @Query('username') username?: string,
  ) {
    const data = await this.taxPaymentChartService.getChart({
      entityType: entityType ?? '',
      entityId: entityId ?? '',
      range: range ?? '',
      granularity,
      tableName,
      financialYear,
      half,
      quarter,
      year,
      month,
      fetchMissing,
      username,
    });
    return this.successResponse('charts.tax-payment', data);
  }

  /**
   * GET /gst/charts/registration-status
   * Registration Status Sankey (GSTREG1): Active / Cancelled / Suspended by FY.
   *
   * Response data:
   *   - series: yearly counts + %
   *   - flows: GSTIN status transitions between consecutive FYs
   *   - netChange: first vs last FY (hover)
   *   - incomplete + missing: Fetch Data | Continue Anyway popup
   *   - drilldown: GSTIN rows when financialYear + status provided
   *   - fetch: job id when fetchMissing=true (GSTREG1 verify/search refresh)
   *
   * Required: entityType=PAN|LOAN, entityId, range=1y|3y|5y
   * Optional: financialYear, status=ACTIVE|CANCELLED|SUSPENDED, fetchMissing, tableName
   */
  @Get('charts/registration-status')
  async getRegistrationStatusChart(
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('range') range?: string,
    @Query('tableName') tableName?: string,
    @Query('financialYear') financialYear?: string,
    @Query('status') status?: string,
    @Query('fetchMissing') fetchMissing?: string,
  ) {
    const data = await this.registrationStatusChartService.getChart({
      entityType: entityType ?? '',
      entityId: entityId ?? '',
      range: range ?? '',
      tableName,
      financialYear,
      status,
      fetchMissing,
    });
    return this.successResponse('charts.registration-status', data);
  }

  /**
   * GET /gst/charts/legal-risk
   * Legal Risk donut from gst_notices_data: High / Medium / Low for a financial year.
   *
   * Response data:
   *   - total, high, medium, low, pct*: donut slices (centre = total)
   *   - interpretation: active / overdue / YoY / repeated notices
   *   - incomplete + missing: Fetch Data | Continue Anyway
   *   - drilldown: notice rows when risk=HIGH|MEDIUM|LOW
   *   - fetch: notice-list refresh when fetchMissing=true (requires username)
   *
   * Required: entityType=PAN|LOAN, entityId
   * Optional: financialYear (default current FY), risk, fetchMissing, username, tableName
   */
  @Get('charts/legal-risk')
  async getLegalRiskChart(
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('tableName') tableName?: string,
    @Query('financialYear') financialYear?: string,
    @Query('risk') risk?: string,
    @Query('fetchMissing') fetchMissing?: string,
    @Query('username') username?: string,
  ) {
    const data = await this.legalRiskChartService.getChart({
      entityType: entityType ?? '',
      entityId: entityId ?? '',
      tableName,
      financialYear,
      risk,
      fetchMissing,
      username,
    });
    return this.successResponse('charts.legal-risk', data);
  }

  /**
   * GET /gst/charts/supplier-concentration
   * Top 5 supplier dependency from GSTR-2B (two-period comparison).
   *
   * Response data:
   *   - series: Top 5 by current-period share (previous vs current + movement)
   *   - totals / concentration / churn: company totals, Top 5 %, new + attrition
   *   - incomplete + missing: Fetch Data | Continue Anyway (GSTIN-months)
   *   - drilldown: full supplier table when view=table
   *   - fetch: GSTR-2B jobs when fetchMissing=true
   *
   * Required: entityType=PAN|LOAN, entityId, range=1y|3y|5y
   * Optional: view=table, fetchMissing, username, tableName
   */
  @Get('charts/supplier-concentration')
  async getSupplierConcentrationChart(
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('range') range?: string,
    @Query('tableName') tableName?: string,
    @Query('view') view?: string,
    @Query('fetchMissing') fetchMissing?: string,
    @Query('username') username?: string,
  ) {
    const data = await this.supplierConcentrationChartService.getChart({
      entityType: entityType ?? '',
      entityId: entityId ?? '',
      range: range ?? '',
      tableName,
      view,
      fetchMissing,
      username,
    });
    return this.successResponse('charts.supplier-concentration', data);
  }

  /**
   * GET /gst/charts/geographic-concentration
   * India map: composite geographic risk by state (yearly).
   *
   * Response data:
   *   - series: stateCode, compositeScore, riskLevel, factor cells
   *   - incomplete + missing: Fetch Data | Continue Anyway (by source)
   *   - drilldown: factor table + GSTIN rows when state= is sent
   *   - fetch: 2B/3B/GSTR-1/REG1/notice jobs when fetchMissing=true
   *
   * Required: entityType=PAN|LOAN, entityId, range=1y|3y|5y
   * Optional: state (code or name), fetchMissing, username, tableName
   */
  @Get('charts/geographic-concentration')
  async getGeographicConcentrationChart(
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('range') range?: string,
    @Query('tableName') tableName?: string,
    @Query('state') state?: string,
    @Query('fetchMissing') fetchMissing?: string,
    @Query('username') username?: string,
  ) {
    const data = await this.geographicConcentrationChartService.getChart({
      entityType: entityType ?? '',
      entityId: entityId ?? '',
      range: range ?? '',
      tableName,
      state,
      fetchMissing,
      username,
    });
    return this.successResponse('charts.geographic-concentration', data);
  }

  /**
   * POST /gst/upload
   * multipart/form-data:
   *   - file:      .xlsx / .xls / .csv file (required)
   *   - tableName: target table name to create in Postgres (required)
   *
   * Asynchronously offloads processing to RabbitMQ queue.
   */
  @Post('upload')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
    }),
  )
  async uploadExcel(
    @UploadedFile() file: Express.Multer.File,
    @Body('tableName') tableName: string,
  ) {
    if (!file) {
      throw new BadRequestException(
        'No file uploaded. Send the file under form field "file".',
      );
    }
    if (!tableName || !tableName.trim()) {
      throw new BadRequestException(
        '"tableName" is required in form-data body.',
      );
    }

    const allowedMime = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/octet-stream',
      'text/csv',
      'application/csv',
      'text/plain',
    ];
    const allowedExt = ['.xlsx', '.xls', '.csv'];
    const ext = (file.originalname || '')
      .toLowerCase()
      .slice(((file.originalname || '').lastIndexOf('.') >>> 0));
    const mimeOk = !file.mimetype || allowedMime.includes(file.mimetype);
    const extOk = allowedExt.includes(ext);
    if (!mimeOk && !extOk) {
      throw new BadRequestException(
        `Unsupported file type: ${file.mimetype || ext}. Upload an .xlsx, .xls or .csv file.`,
      );
    }

    const tempPath = await this.fileStorageService.saveBuffer(
      file.buffer,
      file.originalname,
    );

    const job = await this.gstService.createJob('EXCEL', {
      originalName: file.originalname,
      mimetype: file.mimetype,
      tableName,
      tempPath,
    });

    if (this.excelClient && process.env.ENABLE_RABBITMQ === 'true') {
      this.excelClient.emit('excel_import', {
        jobId: job.id,
        filePath: tempPath,
        tableName,
      });
    } else {
      void this.gstService.processExcel(tempPath, tableName, job.id);
    }

    return {
      message: 'Excel upload accepted for asynchronous processing.',
      jobId: job.id,
      status: job.status,
      checkStatusUrl: `/gst/status/${job.id}`,
    };
  }

  /**
   * POST /gst/verify-and-fetch
   * Reads loanId / gst_no / pan from the uploaded-data table, verifies each
   * GSTIN against the external GST API, and (when the verify response contains
   * a status) fetches full GSTIN details and stores them in MongoDB.
   *
   * Runs in the background; poll GET /gst/status/:jobId for progress.
   *
   * body (optional):
   *   - tableName: source Postgres table (defaults to "gst_uploaded_file_data")
   */

  @Post('verify-and-fetch')
  @HttpCode(HttpStatus.ACCEPTED)
  async verifyAndFetch(@Body('tableName') tableName?: string) {
    const job = await this.gstComplianceService.startVerifyAndFetch(tableName);

    return {
      message:
        'GSTIN verification & fetch job accepted for background processing.',
      jobId: job.id,
      status: job.status,
      checkStatusUrl: `/gst/status/${job.id}`,
    };
  }

  /**
   * POST /gst/verify-and-fetch/gstr-2b
   */
  @Post('verify-and-fetch/gstr-2b')
  @HttpCode(HttpStatus.ACCEPTED)
  async verifyAndFetchGstr2b(
    @Body('year') year: number,
    @Body('month') month: number,
    @Body('tableName') tableName?: string,
    @Body('username') username?: string,
  ) {
    const job = await this.gstComplianceService.startGstr2bVerifyAndFetch(
      Number(year),
      Number(month),
      tableName,
      username,
    );
    return {
      message: 'GSTR-2B verify & fetch job accepted for background processing.',
      jobId: job.id,
      status: job.status,
      checkStatusUrl: `/gst/status/${job.id}`,
    };
  }

  /**
   * POST /gst/verify-and-fetch/gstr-3b
   */
  @Post('verify-and-fetch/gstr-3b')
  @HttpCode(HttpStatus.ACCEPTED)
  async verifyAndFetchGstr3b(
    @Body('year') year: number,
    @Body('month') month: number,
    @Body('tableName') tableName?: string,
    @Body('username') username?: string,
  ) {
    const job = await this.gstComplianceService.startGstr3bVerifyAndFetch(
      Number(year),
      Number(month),
      tableName,
      username,
    );
    return {
      message: 'GSTR-3B verify & fetch job accepted for background processing.',
      jobId: job.id,
      status: job.status,
      checkStatusUrl: `/gst/status/${job.id}`,
    };
  }

  /**
   * POST /gst/verify-and-fetch/gstr-track
   * Track filing status only — does NOT re-verify GSTINs.
   * Reads GSTINs from the upload table and calls Sandbox public track.
   * Skips Sandbox when gst_gstR1_returns_compliance_data already has that
   * GSTIN + FY (FETCHED / NO_RECORD / INVALID_FY).
   * body:
   *   - financialYear (required): Sandbox format e.g. "FY 2021-22"
   *   - tableName (optional)
   */
  @Post('verify-and-fetch/gstr-track')
  @HttpCode(HttpStatus.ACCEPTED)
  async verifyAndFetchGstrTrack(
    @Body('financialYear') financialYear: string,
    @Body('tableName') tableName?: string,
  ) {
    if (!String(financialYear ?? '').trim()) {
      throw new BadRequestException(
        '"financialYear" is required (Sandbox format e.g. "FY 2021-22").',
      );
    }

    const job = await this.gstComplianceService.startGstrTrackVerifyAndFetch(
      financialYear,
      tableName,
    );
    return {
      message:
        'GSTR track verify & fetch job accepted for background processing.',
      jobId: job.id,
      status: job.status,
      financialYear: job.metadata?.financialYear ?? financialYear,
      checkStatusUrl: `/gst/status/${job.id}`,
    };
  }

  /**
   * POST /gst/taxpayer/otp/generate
   * Triggers OTP generation on Sandbox for a taxpayer session.
   * Body: gstin (required). username is optional — if omitted, loaded from
   * gst_uploaded_file_data.username for that GSTIN.
   */
  @Post('taxpayer/otp/generate')
  async generateTaxpayerOtp(
    @Body('username') username: string | undefined,
    @Body('gstin') gstin: string,
  ) {
    const data = await this.gstTaxpayerAuthService.generateOtp({ username, gstin });
    return this.successResponse('taxpayer-auth.generate-otp', data);
  }

  /**
   * POST /gst/taxpayer/otp/submit
   * Stores OTP in backend for up to 10 minutes before verify call.
   * Body: gstin + otp (required). username optional (auto from upload table).
   */
  @Post('taxpayer/otp/submit')
  async submitTaxpayerOtp(
    @Body('username') username: string | undefined,
    @Body('gstin') gstin: string,
    @Body('otp') otp: string,
  ) {
    const data = await this.gstTaxpayerAuthService.submitOtp({
      username,
      gstin,
      otp,
    });
    return this.successResponse('taxpayer-auth.submit-otp', data);
  }

  /**
   * POST /gst/taxpayer/otp/verify?otp=...
   * Verifies OTP and saves taxpayer access token.
   * Query: otp (required).
   * Body: gstin (required). username optional (auto from upload table).
   */
  @Post('taxpayer/otp/verify')
  async verifyTaxpayerOtp(
    @Body('username') username: string | undefined,
    @Body('gstin') gstin: string,
    @Query('otp') otp: string,
  ) {
    if (!String(otp ?? '').trim()) {
      throw new BadRequestException(
        '"otp" query parameter is required in verify request.',
      );
    }
    const data = await this.gstTaxpayerAuthService.verifyOtp({
      username,
      gstin,
      otp,
    });
    return this.successResponse('taxpayer-auth.verify-otp', data);
  }

  /*
   * POST /gst/taxpayer/session/refresh
   * Refreshes taxpayer access token (manual endpoint).
   */
  @Post('taxpayer/session/refresh')
  async refreshTaxpayerSession(
    @Body('username') username: string,
    @Body('gstin') gstin: string,
  ) {
    const data = await this.gstTaxpayerAuthService.refreshAccessToken({
      username,
      gstin,
    });
    return this.successResponse('taxpayer-auth.refresh-session', data);
  }

  /**
   * GET /gst/taxpayer/session/status?username=...&gstin=...
   * Returns current taxpayer OTP/session status.
   */
  @Get('taxpayer/session/status')
  async getTaxpayerSessionStatus(
    @Query('username') username: string,
    @Query('gstin') gstin: string,
  ) {
    const data = await this.gstTaxpayerAuthService.getSessionStatus({
      username,
      gstin,
    });
    return this.successResponse('taxpayer-auth.session-status', data);
  }

  /**
   * GET /gst/taxpayer/gstr-2b/:year
   * Cache-first year fetch. Uses Mongo for existing months and calls Sandbox
   * only for missing months. Username is resolved from upload data when omitted.
   * Required query: gstin, customerId, associatedLoanId.
   */
  @Get('taxpayer/gstr-2b/:year')
  async fetchTaxpayerGstr2b(
    @Param('year') year: string,
    @Query('username') username: string | undefined,
    @Query('gstin') gstin: string,
    @Query('associatedLoanId') associatedLoanId: string,
    @Query('customerId') customerId: string,
    @Query('dataSource') dataSource?: string,
  ) {
    const data = await this.gstTaxpayerReturnsService.fetchGstr2bForYear(
      { username, gstin },
      Number(year),
      { associatedLoanId, customerId, dataSource },
    );
    return this.successResponse('taxpayer-returns.gstr-2b', data);
  }

  /**
   * GET /gst/taxpayer/gstr-3b/:year
   * Cache-first year fetch. Uses Mongo for existing months and calls Sandbox
   * only for missing months. Username is resolved from upload data when omitted.
   * Required query: gstin, customerId, associatedLoanId.
   */
  @Get('taxpayer/gstr-3b/:year')
  async fetchTaxpayerGstr3b(
    @Param('year') year: string,
    @Query('username') username: string | undefined,
    @Query('gstin') gstin: string,
    @Query('associatedLoanId') associatedLoanId: string,
    @Query('customerId') customerId: string,
    @Query('dataSource') dataSource?: string,
  ) {
    const data = await this.gstTaxpayerReturnsService.fetchGstr3bForYear(
      { username, gstin },
      Number(year),
      { associatedLoanId, customerId, dataSource },
    );
    return this.successResponse('taxpayer-returns.gstr-3b', data);
  }

  /**
   * POST /gst/taxpayer/notices/fetch
   * Cache-first list fetch. Body requires username, gstin, date,
   * associatedLoanId, customerId. Optional: dataSource.
   */
  @Post('taxpayer/notices/fetch')
  async fetchAndStoreTaxpayerNotices(
    @Body('username') username: string,
    @Body('gstin') gstin: string,
    @Body('date') date: string,
    @Body('associatedLoanId') associatedLoanId: string,
    @Body('customerId') customerId: string,
    @Body('dataSource') dataSource?: string,
  ) {
    const data = await this.gstTaxpayerReturnsService.fetchNotices(
      { username, gstin },
      date,
      {
        associatedLoanId,
        customerId,
        dataSource,
        requireTracking: true,
      },
    );
    return this.successResponse('taxpayer-returns.notices-fetch', data);
  }

  /**
   * POST /gst/taxpayer/notices/fetch/:referenceId
   * Cache-first detail fetch. Body requires username, gstin,
   * associatedLoanId, customerId. Optional: dataSource.
   */
  @Post('taxpayer/notices/fetch/:referenceId')
  async fetchAndStoreTaxpayerNoticeByReferenceId(
    @Param('referenceId') referenceId: string,
    @Body('username') username: string,
    @Body('gstin') gstin: string,
    @Body('associatedLoanId') associatedLoanId: string,
    @Body('customerId') customerId: string,
    @Body('dataSource') dataSource?: string,
  ) {
    const data = await this.gstTaxpayerReturnsService.fetchNoticeByReferenceId(
      { username, gstin },
      referenceId,
      {
        associatedLoanId,
        customerId,
        dataSource,
        requireTracking: true,
      },
    );
    return this.successResponse('taxpayer-returns.notice-detail-fetch', data);
  }

  /**
   * GET /gst/taxpayer/notices/stored
   * Reads Mongo-stored notice lists. Required: associatedLoanId, customerId, gstin.
   * Optional exact filter: date=DD/MM/YYYY.
   */
  @Get('taxpayer/notices/stored')
  async getStoredTaxpayerNotices(
    @Query('associatedLoanId') associatedLoanId: string,
    @Query('customerId') customerId: string,
    @Query('gstin') gstin: string,
    @Query('date') date?: string,
  ) {
    const data = await this.gstTaxpayerReturnsService.getStoredNotices({
      associatedLoanId,
      customerId,
      gstin,
      noticeDate: date,
    });
    return this.successResponse('taxpayer-returns.notices-stored', data);
  }

  /**
   * GET /gst/taxpayer/notices/stored/:referenceId
   * Reads one Mongo-stored notice detail. Required: associatedLoanId, gstin.
   */
  @Get('taxpayer/notices/stored/:referenceId')
  async getStoredTaxpayerNoticeByReferenceId(
    @Param('referenceId') referenceId: string,
    @Query('associatedLoanId') associatedLoanId: string,
    @Query('gstin') gstin: string,
    @Query('customerId') customerId?: string,
  ) {
    const data = await this.gstTaxpayerReturnsService.getStoredNoticeDetail({
      associatedLoanId,
      gstin,
      referenceId,
      customerId,
    });
    return this.successResponse('taxpayer-returns.notice-detail-stored', data);
  }

  /**
   * GET /gst/taxpayer/notices?username=...&gstin=...&date=DD/MM/YYYY
   * Date must be within the last 60 days. Cache-first when Mongo has a match.
   */
  @Get('taxpayer/notices')
  async fetchTaxpayerNotices(
    @Query('username') username: string,
    @Query('gstin') gstin: string,
    @Query('date') date: string,
    @Query('associatedLoanId') associatedLoanId?: string,
    @Query('customerId') customerId?: string,
    @Query('dataSource') dataSource?: string,
  ) {
    const data = await this.gstTaxpayerReturnsService.fetchNotices(
      { username, gstin },
      date,
      { associatedLoanId, customerId, dataSource },
    );
    return this.successResponse('taxpayer-returns.notices', data);
  }

  /**
   * GET /gst/taxpayer/notices/:referenceId?username=...&gstin=...
   * Cache-first when Mongo has a match.
   */
  @Get('taxpayer/notices/:referenceId')
  async fetchTaxpayerNoticeByReferenceId(
    @Param('referenceId') referenceId: string,
    @Query('username') username: string,
    @Query('gstin') gstin: string,
    @Query('associatedLoanId') associatedLoanId?: string,
    @Query('customerId') customerId?: string,
    @Query('dataSource') dataSource?: string,
  ) {
    const data = await this.gstTaxpayerReturnsService.fetchNoticeByReferenceId(
      { username, gstin },
      referenceId,
      { associatedLoanId, customerId, dataSource },
    );
    return this.successResponse('taxpayer-returns.notice-detail', data);
  }

  /**
   * GET /gst/api-logs
   * Optional filters:
   * gstrType, status, customerId, associatedLoanId, gstNumber,
   * dataSource, apiName, fromDate, toDate, limit, offset
   */
  @Get('api-logs')
  async getApiLogs(
    @Query('gstrType')
    gstrType?: 'GST-RETURN' | 'GST-NOTICES' | 'GSTR' | 'GSTR-2B' | 'GSTR-3B',
    @Query('status') status?: string,
    @Query('customerId') customerId?: string,
    @Query('associatedLoanId') associatedLoanId?: string,
    @Query('gstNumber') gstNumber?: string,
    @Query('dataSource') dataSource?: string,
    @Query('apiName') apiName?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
  ) {
    const allowedGstrTypes = new Set([
      'GST-RETURN',
      'GST-NOTICES',
      'GSTR',
      'GSTR-2B',
      'GSTR-3B',
    ]);
    const allowedStatuses = new Set(['PENDING', 'SUCCESS', 'FAILED']);

    if (gstrType && !allowedGstrTypes.has(gstrType)) {
      throw new BadRequestException(
        'Invalid gstrType. Allowed values: GST-RETURN, GST-NOTICES, GSTR, GSTR-2B, GSTR-3B.',
      );
    }
    if (status && !allowedStatuses.has(status)) {
      throw new BadRequestException(
        'Invalid status. Allowed values: PENDING, SUCCESS, FAILED.',
      );
    }
    const normalizedStatus = status as ApiRequestStatus | undefined;

    const parsedFromDate = this.parseDate(fromDate, 'fromDate');
    const parsedToDate = this.parseDate(toDate, 'toDate');
    const limit = this.parseIntWithBounds(limitRaw, 'limit', 1, 200, 50);
    const offset = this.parseIntWithBounds(offsetRaw, 'offset', 0, 1000000, 0);

    const data = await this.apiRequestLogService.getLogs({
      gstrType,
      status: normalizedStatus,
      customerId,
      associatedLoanId,
      gstNumber,
      dataSource,
      apiName,
      fromDate: parsedFromDate,
      toDate: parsedToDate,
      limit,
      offset,
    });

    return this.successResponse('taxpayer-returns.api-logs', data);
  }

  /**
   * POST /gst/scheduler/aggregate-returns
   * Runs aggregation when every expected GSTIN for a customer+loan has at least
   * one Mongo document (any year/month). No year/month required.
   *
   * body (all optional):
   *   - returnType: GSTR-2B | GSTR-3B | ALL (default ALL)
   *   - customerId
   *   - loanId
   *   - tableName (default gst_uploaded_file_data)
   */
  @Post('scheduler/aggregate-returns')
  @HttpCode(HttpStatus.OK)
  async runReturnAggregationScheduler(
    @Body('returnType') returnType?: SchedulerReturnType,
    @Body('customerId') customerId?: string,
    @Body('loanId') loanId?: string,
    @Body('tableName') tableName?: string,
  ) {
    if (!this.returnAggregationScheduler) {
      throw new BadRequestException(
        'Return aggregation scheduler is not available.',
      );
    }

    const normalizedReturnType: SchedulerReturnType = returnType ?? 'ALL';
    const allowedReturnTypes = new Set<SchedulerReturnType>([
      'GSTR-2B',
      'GSTR-3B',
      'ALL',
    ]);
    if (!allowedReturnTypes.has(normalizedReturnType)) {
      throw new BadRequestException(
        'Invalid returnType. Allowed: GSTR-2B, GSTR-3B, ALL.',
      );
    }

    const data = await this.returnAggregationScheduler.run({
      returnType: normalizedReturnType,
      customerId,
      loanId,
      tableName,
    });

    return this.successResponse('scheduler.aggregate-returns', data);
  }

  /**
   * GET /gst/status/:jobId
   * Return real-time job status and page ingestion statistics.
   */
  @Get('status/:jobId')
  async getStatus(@Param('jobId') jobId: string) {
    const job = await this.gstService.getJobStatus(jobId);
    if (!job) {
      throw new BadRequestException(`Job with ID "${jobId}" not found.`);
    }

    const progress =
      job.totalChunks > 0
        ? Math.round((job.completedChunks / job.totalChunks) * 100)
        : 0;

    return {
      id: job.id,
      type: job.type,
      status: job.status,
      totalChunks: job.totalChunks,
      completedChunks: job.completedChunks,
      progressPercentage: `${progress}%`,
      errorMessage: job.errorMessage,
      metadata: job.metadata,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }

  private successResponse(flow: string, data: Record<string, any>) {
    return {
      success: true,
      flow,
      requestId: randomUUID(),
      timestamp: new Date().toISOString(),
      data,
    };
  }

  private parseDate(rawDate: string | undefined, fieldName: string): Date | undefined {
    if (!rawDate) return undefined;
    const parsed = new Date(rawDate);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${fieldName} must be a valid ISO date string.`);
    }
    return parsed;



  }

  private parseIntWithBounds(
    value: string | undefined,
    fieldName: string,
    min: number,
    max: number,
    defaultValue: number,
  ): number {
    if (!value || value.trim() === '') return defaultValue;
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
      throw new BadRequestException(`${fieldName} must be an integer.`);
    }
    if (parsed < min || parsed > max) {
      throw new BadRequestException(
        `${fieldName} must be between ${min} and ${max}.`,
      );
    }
    return parsed;
  }

  /** Parses `1,2,3` or repeated query values into unique integers. */
  private parseIntList(
    raw: string | string[] | undefined,
    fieldName: string,
  ): number[] {
    if (raw == null) return [];

    const parts = (Array.isArray(raw) ? raw : [raw])
      .flatMap((value) => String(value).split(','))
      .map((value) => value.trim())
      .filter(Boolean);

    const numbers: number[] = [];
    for (const part of parts) {
      if (!/^-?\d+$/.test(part)) {
        throw new BadRequestException(
          `Query parameter "${fieldName}" must contain integers only.`,
        );
      }
      numbers.push(Number.parseInt(part, 10));
    }

    return Array.from(new Set(numbers));
  }
}

