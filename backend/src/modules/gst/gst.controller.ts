import { BadRequestException, Body,Controller, Get, Headers, Post,Query,UploadedFile,UseInterceptors,} from '@nestjs/common';

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
   * GET /gst/compliance/public
   * Returns public records from MongoDB collection gst_compliance_data.
   */
  @Get('compliance/public')
  async getPublicComplianceData(
    @Query('page') page = '1',
    @Query('limit') limit = '50',
    @Query('companyId') companyId?: string | string[],
    @Query('gstin') gstin?: string | string[],
    @Headers('x-company-id') companyIdHeader?: string | string[],
    @Headers('gstin') gstinHeader?: string | string[],
    @Headers('x-gstin') xGstinHeader?: string | string[],
    @Headers('x-gstin-number') xGstinNumberHeader?: string | string[],
  ) {
    const resolvedCompanyId =
      this.getFirstNonEmptyValue(companyId) ||
      this.getFirstNonEmptyValue(companyIdHeader);
    const resolvedGstin =
      this.getFirstNonEmptyValue(gstin) ||
      this.getFirstNonEmptyValue(gstinHeader) ||
      this.getFirstNonEmptyValue(xGstinHeader) ||
      this.getFirstNonEmptyValue(xGstinNumberHeader);

    return this.gstService.getPublicComplianceData(
      Number.parseInt(page, 10) || 1,
      Number.parseInt(limit, 10) || 50,
      resolvedCompanyId,
      resolvedGstin,
    );
  }

  private getFirstNonEmptyValue(input?: string | string[]): string | undefined {
    if (Array.isArray(input)) {
      for (const value of input) {
        const normalized = this.getFirstNonEmptyValue(value);
        if (normalized) {
          return normalized;
        }
      }
      return undefined;
    }

    if (typeof input !== 'string') {
      return undefined;
    }

    const trimmed = input.trim();
    return trimmed.length > 0 ? trimmed : undefined;
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


