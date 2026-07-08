import { BadRequestException, Body, Controller, Get, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';

import { FileInterceptor } from '@nestjs/platform-express';

import { GstService, GST_UPLOAD_TABLE } from './gst.service.js';



@Controller('gst')

export class GstController {

  constructor(private readonly gstService: GstService) {}



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

   * Replaces gst_uploaded_file_data with the new Excel file (single table).

   */

  @Post('upload')

  @UseInterceptors(

    FileInterceptor('file', {

      limits: { fileSize: 25 * 1024 * 1024 },

    }),

  )

  async uploadExcel(

    @UploadedFile() file: Express.Multer.File,

    @Body('tableName') tableName?: string,

  ) {

    if (!file) {

      throw new BadRequestException(

        'No file uploaded. Send the file under form field "file".',
                                                      
      );

    }



    const targetTable = (tableName?.trim() || GST_UPLOAD_TABLE).trim();



    const allowed = [

      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',

      'application/vnd.ms-excel',

      'application/octet-stream',

    ];

    if (file.mimetype && !allowed.includes(file.mimetype)) {

      throw new BadRequestException(

        `Unsupported file type: ${file.mimetype}. Upload an .xlsx or .xls file.`,

      );

    }



    return this.gstService.processExcel(file.buffer, targetTable);

  }

}