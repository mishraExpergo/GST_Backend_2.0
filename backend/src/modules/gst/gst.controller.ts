/// <reference types="multer" />
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
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
import { GstTaxpayerAuthService } from './services/gst-taxpayer-auth.service';
import { GstTaxpayerReturnsService } from './services/gst-taxpayer-returns.service';
import { ApiRequestLogService } from './services/api-request-log.service';
import {
  GstReturnAggregationSchedulerService,
  type SchedulerReturnType,
} from './services/gst-return-aggregation-scheduler.service';
import { FileStorageService } from '../shared/services/file-storage.service';
import type { ApiRequestStatus } from '../../entities/api-request-log.entity';

@Controller('gst')
export class GstController {
  constructor(
    private readonly gstService: GstService,
    private readonly fileStorageService: FileStorageService,
    private readonly gstComplianceService: GstComplianceService,
    private readonly gstTaxpayerAuthService: GstTaxpayerAuthService,
    private readonly gstTaxpayerReturnsService: GstTaxpayerReturnsService,
    private readonly apiRequestLogService: ApiRequestLogService,
    private readonly returnAggregationScheduler: GstReturnAggregationSchedulerService,
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
   * GET /gst/taxpayer/notices?username=...&gstin=...&date=DD/MM/YYYY
   * Date must be within the last 60 days.
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

