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
import { GstService } from './gst.service';
import { GstComplianceService } from './services/gst-compliance.service';
import { GstTaxpayerAuthService } from './services/gst-taxpayer-auth.service';
import { GstTaxpayerReturnsService } from './services/gst-taxpayer-returns.service';
import { GstGstr1ReturnService } from './services/gst-gstr1-return.service';
import { ApiRequestLogService } from './services/api-request-log.service';
import { GstReturnAggregationSchedulerService } from './services/gst-return-aggregation-scheduler.service';
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
    private readonly gstGstr1ReturnService: GstGstr1ReturnService,
    private readonly apiRequestLogService: ApiRequestLogService,
    private readonly returnAggregationScheduler: GstReturnAggregationSchedulerService,
    @Optional() @Inject('EXCEL_SERVICE') private readonly excelClient?: ClientProxy,
  ) {}

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

    if (this.excelClient) {
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
   * POST /gst/verify-and-fetch/gstr-1
   * body:
   *   - year (required)
   *   - month (required)
   *   - tableName (optional)
   *   - username (optional; defaults to GSTIN per row)
   */
  @Post('verify-and-fetch/gstr-1')
  @HttpCode(HttpStatus.ACCEPTED)
  async verifyAndFetchGstr1(
    @Body('year') year: number,
    @Body('month') month: number,
    @Body('tableName') tableName?: string,
    @Body('username') username?: string,
  ) {
    const job = await this.gstComplianceService.startGstr1VerifyAndFetch(
      Number(year),
      Number(month),
      tableName,
      username,
    );
    return {
      message: 'GSTR-1 verify & fetch job accepted for background processing.',
      jobId: job.id,
      status: job.status,
      checkStatusUrl: `/gst/status/${job.id}`,
    };
  }

  /**
   * POST /gst/verify-and-fetch/gstr-1a
   */
  @Post('verify-and-fetch/gstr-1a')
  @HttpCode(HttpStatus.ACCEPTED)
  async verifyAndFetchGstr1a(
    @Body('year') year: number,
    @Body('month') month: number,
    @Body('tableName') tableName?: string,
    @Body('username') username?: string,
  ) {
    const job = await this.gstComplianceService.startGstr1aVerifyAndFetch(
      Number(year),
      Number(month),
      tableName,
      username,
    );
    return {
      message: 'GSTR-1A verify & fetch job accepted for background processing.',
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
   * POST /gst/taxpayer/otp/generate
   * Triggers OTP generation on Sandbox for a taxpayer session.
   */
  @Post('taxpayer/otp/generate')
  async generateTaxpayerOtp(
    @Body('username') username: string,
    @Body('gstin') gstin: string,
  ) {
    const data = await this.gstTaxpayerAuthService.generateOtp({ username, gstin });
    return this.successResponse('taxpayer-auth.generate-otp', data);
  }

  /**
   * POST /gst/taxpayer/otp/submit
   * Stores OTP in backend for up to 10 minutes before verify call.
   */
  @Post('taxpayer/otp/submit')
  async submitTaxpayerOtp(
    @Body('username') username: string,
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
   * POST /gst/taxpayer/otp/verify
   * Verifies submitted OTP and saves taxpayer access token.
   */
  @Post('taxpayer/otp/verify')
  async verifyTaxpayerOtp(
    @Body('username') username: string,
    @Body('gstin') gstin: string,
    @Body('otp') otp: string,
  ) {
    if (!String(otp ?? '').trim()) {
      throw new BadRequestException('"otp" is required in verify request.');
    }
    const data = await this.gstTaxpayerAuthService.verifyOtp({ username, gstin, otp });
    return this.successResponse('taxpayer-auth.verify-otp', data);
  }

  /**
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
   * GET /gst/gstr1-return?gstin=...&customerId=...&associatedLoanId=...&year=2024
   * Fetches one GSTIN's GSTR-1 filing track data via the public Sandbox track API.
   * Skips Sandbox when Mongo already has all required months (Jan..current month) for the year.
   * Uses platform auth (no taxpayer OTP). Stores in Mongo collection
   * gst_gstR1_returns_compliance_data if absent; no aggregation.
   */
  @Get('gstr1-return')
  async fetchGstr1Return(
    @Query('gstin') gstin: string,
    @Query('associatedLoanId') associatedLoanId?: string,
    @Query('customerId') customerId?: string,
    @Query('year') year?: string,
    @Query('dataSource') dataSource?: string,
    @Query('tableName') tableName?: string,
  ) {
    const data = await this.gstGstr1ReturnService.fetchGstr1Return(gstin, {
      associatedLoanId,
      customerId,
      year: year !== undefined ? Number(year) : undefined,
      dataSource,
      sourceTable: tableName,
    });
    return this.successResponse('gstr1-return', data);
  }

  /**
   * GET /gst/taxpayer/gstr-1/:year
   * Fetches one GSTIN's GSTR-1 for all 12 months of the calendar year.
   */
  @Get('taxpayer/gstr-1/:year')
  async fetchTaxpayerGstr1(
    @Param('year') year: string,
    @Query('username') username: string,
    @Query('gstin') gstin: string,
    @Query('associatedLoanId') associatedLoanId?: string,
    @Query('customerId') customerId?: string,
    @Query('dataSource') dataSource?: string,
  ) {
    const data = await this.gstTaxpayerReturnsService.fetchGstr1ForYear(
      { username, gstin },
      Number(year),
      { associatedLoanId, customerId, dataSource },
    );
    return this.successResponse('taxpayer-returns.gstr-1', data);
  }

  /**
   * GET /gst/taxpayer/gstr-2b/:year
   * Fetches one GSTIN's GSTR-2B for all 12 months of the calendar year.
   */
  @Get('taxpayer/gstr-2b/:year')
  async fetchTaxpayerGstr2b(
    @Param('year') year: string,
    @Query('username') username: string,
    @Query('gstin') gstin: string,
    @Query('associatedLoanId') associatedLoanId?: string,
    @Query('customerId') customerId?: string,
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
   * Fetches one GSTIN's GSTR-3B for all 12 months of the calendar year.
   */
  @Get('taxpayer/gstr-3b/:year')
  async fetchTaxpayerGstr3b(
    @Param('year') year: string,
    @Query('username') username: string,
    @Query('gstin') gstin: string,
    @Query('associatedLoanId') associatedLoanId?: string,
    @Query('customerId') customerId?: string,
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
   * GET /gst/taxpayer/gstr-1a/:year/:month?username=...&gstin=...
   */
  @Get('taxpayer/gstr-1a/:year/:month')
  async fetchTaxpayerGstr1a(
    @Param('year') year: string,
    @Param('month') month: string,
    @Query('username') username: string,
    @Query('gstin') gstin: string,
    @Query('associatedLoanId') associatedLoanId?: string,
    @Query('customerId') customerId?: string,
    @Query('dataSource') dataSource?: string,
  ) {
    const data = await this.gstTaxpayerReturnsService.fetchGstr1a(
      { username, gstin },
      Number(year),
      Number(month),
      { associatedLoanId, customerId, dataSource },
    );
    return this.successResponse('taxpayer-returns.gstr-1a', data);
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
    @Query('gstrType') gstrType?: 'GSTR-1' | 'GSTR-1A' | 'GSTR-2B' | 'GSTR-3B',
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
    const allowedGstrTypes = new Set(['GSTR-1', 'GSTR-1A', 'GSTR-2B', 'GSTR-3B']);
    const allowedStatuses = new Set(['PROCESSING', 'SUCCESS', 'FAILED']);

    if (gstrType && !allowedGstrTypes.has(gstrType)) {
      throw new BadRequestException(
        'Invalid gstrType. Allowed values: GSTR-1, GSTR-1A, GSTR-2B, GSTR-3B.',
      );
    }
    if (status && !allowedStatuses.has(status)) {
      throw new BadRequestException(
        'Invalid status. Allowed values: PROCESSING, SUCCESS, FAILED.',
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
   * Checks Mongo GSTR-1 / 2B / 3B collections per customer+loan and runs
   * aggregation when every expected GSTIN (primary + considered entity) for that loan is present.
   * GSTR-1 metrics go to primary_gst_aggregation (PRIMARY_*) and secondary_gst_aggregation (CONSIDERED_*).
   *
   * body:
   *   - year (required)
   *   - month (optional; omit to require all 12 months for the year)
   *   - returnType: GSTR-1 | GSTR-2B | GSTR-3B | ALL (default ALL)
   *   - customerId (optional filter)
   *   - loanId (optional filter)
   *   - tableName (optional, default gst_uploaded_file_data)
   */
  @Post('scheduler/aggregate-returns')
  @HttpCode(HttpStatus.OK)
  async runReturnAggregationScheduler(
    @Body('year') year: number,
    @Body('month') month?: number,
    @Body('returnType') returnType?: 'GSTR-1' | 'GSTR-2B' | 'GSTR-3B' | 'ALL',
    @Body('customerId') customerId?: string,
    @Body('loanId') loanId?: string,
    @Body('tableName') tableName?: string,
  ) {
    if (!this.returnAggregationScheduler) {
      throw new BadRequestException(
        'Return aggregation scheduler is not available.',
      );
    }

    const yearNum = Number(year);
    if (!Number.isInteger(yearNum) || yearNum < 2017 || yearNum > 2100) {
      throw new BadRequestException(
        `Invalid "year" "${year}". Expected a 4-digit year (e.g. 2024).`,
      );
    }

    const normalizedReturnType = returnType ?? 'ALL';
    const allowedReturnTypes = new Set(['GSTR-1', 'GSTR-2B', 'GSTR-3B', 'ALL']);
    if (!allowedReturnTypes.has(normalizedReturnType)) {
      throw new BadRequestException(
        'Invalid returnType. Allowed: GSTR-1, GSTR-2B, GSTR-3B, ALL.',
      );
    }

    let monthNum: number | undefined;
    if (month !== undefined && month !== null && String(month).trim() !== '') {
      monthNum = Number(month);
      if (!Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12) {
        throw new BadRequestException(
          `Invalid "month" "${month}". Expected a number between 1 and 12.`,
        );
      }
    }

    const data = await this.returnAggregationScheduler.run({
      returnType: normalizedReturnType,
      year: yearNum,
      month: monthNum,
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
}
