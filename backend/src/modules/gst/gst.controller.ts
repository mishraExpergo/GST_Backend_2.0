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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ClientProxy } from '@nestjs/microservices';
import { GstService } from './gst.service';
import { FileStorageService } from '../shared/services/file-storage.service';

@Controller('gst')
export class GstController {
  constructor(
    private readonly gstService: GstService,
    private readonly fileStorageService: FileStorageService,
    @Optional() @Inject('EXCEL_SERVICE') private readonly excelClient?: ClientProxy,
    @Optional()
    @Inject('API_PARENT_SERVICE')
    private readonly apiParentClient?: ClientProxy,
  ) {}

  /**
   * POST /gst/upload
   * Multipart/form-data:
   *   - file:      .xlsx / .xls file (required)
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

    // 1. Cache the file to local temp directory
    const tempPath = await this.fileStorageService.saveBuffer(
      file.buffer,
      file.originalname,
    );

    // 2. Create tracking job in database
    const job = await this.gstService.createJob('EXCEL', {
      originalName: file.originalname,
      tableName,
      tempPath,
    });

    // 3. Queue import (RabbitMQ) or process inline when RMQ is disabled
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
   * POST /gst/api-ingest
   * Ingest high-volume external API data concurrently.
   */
  @Post('api-ingest')
  @HttpCode(HttpStatus.ACCEPTED)
  async triggerApiIngest(
    @Body('endpoint') endpoint: string,
    @Body('totalRecords') totalRecords: number,
    @Body('tableName') tableName: string,
  ) {
    if (!endpoint || !endpoint.trim()) {
      throw new BadRequestException('"endpoint" is required.');
    }
    if (!tableName || !tableName.trim()) {
      throw new BadRequestException('"tableName" is required.');
    }
    const count = Number(totalRecords) || 10000; // Default 10k rows

    // 1. Create API Job
    const job = await this.gstService.createJob('API', {
      endpoint,
      totalRecords: count,
      tableName,
    });

    // 2. Queue parent task (RabbitMQ) or process inline when RMQ is disabled
    if (this.apiParentClient) {
      this.apiParentClient.emit('api_parent', {
        jobId: job.id,
        endpoint,
        totalRecords: count,
        tableName,
      });
    } else {
      void this.gstService.processApiParent(
        job.id,
        endpoint,
        count,
        tableName,
      );
    }

    return {
      message: 'Bulk API data ingestion job initialized successfully.',
      jobId: job.id,
      status: job.status,
      checkStatusUrl: `/gst/status/${job.id}`,
    };
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
}
