import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload, Ctx, RmqContext } from '@nestjs/microservices';
import { GstService } from './gst.service';
import { GstComplianceService } from './services/gst-compliance.service';

interface SourceRow {
  loan_id: string;
  gst_no: string | null;
  pan: string | null;
}

@Controller()
export class GstConsumer {
  private readonly logger = new Logger(GstConsumer.name);

  constructor(
    private readonly gstService: GstService,
    private readonly gstComplianceService: GstComplianceService,
  ) {}

  /**
   * Consumes Excel Import Tasks
   */
  @EventPattern('excel_import')
  async handleExcelImport(
    @Payload() data: { jobId: string; filePath: string; tableName: string },
    @Ctx() context: RmqContext,
  ) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    this.logger.log(`Received excel_import event for Job: ${data.jobId}`);
    try {
      await this.gstService.processExcel(data.filePath, data.tableName, data.jobId);
      channel.ack(originalMsg); // Acknowledge message successfully processed
      this.logger.log(`Successfully completed Excel Import Job: ${data.jobId}`);
    } catch (err) {
      this.logger.error(`Error processing Excel Import Job ${data.jobId}: ${(err as Error).message}`);
      // Nack and do not requeue to avoid infinite loop (job error is logged in database)
      channel.nack(originalMsg, false, false);
    }
  }

  /**
   * Consumes API Ingestion Parent/Orchestrator Tasks
   */
  @EventPattern('api_parent')
  async handleApiParent(
    @Payload() data: { jobId: string; endpoint: string; totalRecords: number; tableName: string },
    @Ctx() context: RmqContext,
  ) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    this.logger.log(`Received api_parent event for Job: ${data.jobId}`);
    try {
      await this.gstService.processApiParent(data.jobId, data.endpoint, data.totalRecords, data.tableName);
      channel.ack(originalMsg);
      this.logger.log(`Successfully orchestrated API parent Job: ${data.jobId}`);
    } catch (err) {
      this.logger.error(`Error orchestrating API parent Job ${data.jobId}: ${(err as Error).message}`);
      channel.nack(originalMsg, false, false);
    }
  }

  /**
   * Consumes Concurrent API Ingestion Page/Chunk Tasks
   */
  @EventPattern('api_chunk')
  async handleApiChunk(
    @Payload() data: { taskId: string; jobId: string; endpoint: string; page: number; limit: number; tableName: string },
    @Ctx() context: RmqContext,
  ) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    this.logger.log(`Received api_chunk event for Task: ${data.taskId} (Job: ${data.jobId}, Page: ${data.page})`);
    try {
      await this.gstService.processApiChunk(
        data.taskId,
        data.jobId,
        data.endpoint,
        data.page,
        data.limit,
        data.tableName,
      );
      channel.ack(originalMsg);
      this.logger.log(`Successfully finished API Ingestion chunk: ${data.taskId}`);
    } catch (err) {
      this.logger.error(`Error processing API Ingestion chunk ${data.taskId}: ${(err as Error).message}`);
      channel.nack(originalMsg, false, false);
    }
  }

  /**
   * Consumes GSTIN verify-and-fetch Parent/Orchestrator Tasks
   */
  @EventPattern('verify_parent')
  async handleVerifyParent(
    @Payload() data: { jobId: string; tableName: string },
    @Ctx() context: RmqContext,
  ) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    this.logger.log(`Received verify_parent event for Job: ${data.jobId}`);
    try {
      await this.gstComplianceService.processVerifyParent(
        data.jobId,
        data.tableName,
      );
      channel.ack(originalMsg);
      this.logger.log(`Successfully orchestrated verify parent Job: ${data.jobId}`);
    } catch (err) {
      this.logger.error(`Error orchestrating verify parent Job ${data.jobId}: ${(err as Error).message}`);
      channel.nack(originalMsg, false, false);
    }
  }

  /**
   * Consumes GSTIN verify-and-fetch Batch/Chunk Tasks
   */
  @EventPattern('verify_chunk')
  async handleVerifyChunk(
    @Payload()
    data: {
      taskId: string;
      jobId: string;
      tableName: string;
      rows: SourceRow[];
    },
    @Ctx() context: RmqContext,
  ) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    this.logger.log(
      `Received verify_chunk event for Task: ${data.taskId} (Job: ${data.jobId})`,
    );
    try {
      await this.gstComplianceService.processVerifyChunk(
        data.taskId,
        data.jobId,
        data.tableName,
        data.rows,
      );
      channel.ack(originalMsg);
      this.logger.log(`Successfully finished verify chunk: ${data.taskId}`);
    } catch (err) {
      this.logger.error(`Error processing verify chunk ${data.taskId}: ${(err as Error).message}`);
      channel.nack(originalMsg, false, false);
    }
  }
}
