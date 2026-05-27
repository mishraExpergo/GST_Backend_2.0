import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { GstService } from './gst.service.js';

@Controller('gst')
export class GstController {
  constructor(private readonly gstService: GstService) {}

  /**
   * POST /gst/upload
   * multipart/form-data:
   *   - file:      .xlsx / .xls file (required)
   *   - tableName: target table name to create in Postgres (required)
   */
  @Post('upload')
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

    return this.gstService.processExcel(file.buffer, tableName);
  }
}
