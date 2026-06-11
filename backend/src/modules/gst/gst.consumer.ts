import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload, Ctx, RmqContext } from '@nestjs/microservices';
import { GstService } from './gst.service';
import { GstComplianceService } from './services/gst-compliance.service';

interface SourceRow {
  loan_id: string;
  gst_no: string | null;
  pan: string | null;
}

interface Gstr2bParams {
  year: number;
  month: number;
  filingPreference: string;
  reconciliationCriteria: string;
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

  /**
   * Consumes GSTIN verify-and-track-GSTR Parent/Orchestrator Tasks
   */
  @EventPattern('verify_gstr_parent')
  async handleVerifyGstrParent(
    @Payload()
    data: { jobId: string; tableName: string; financialYear: string },
    @Ctx() context: RmqContext,
  ) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    this.logger.log(`Received verify_gstr_parent event for Job: ${data.jobId}`);
    try {
      await this.gstComplianceService.processVerifyGstrParent(
        data.jobId,
        data.tableName,
        data.financialYear,
      );
      channel.ack(originalMsg);
      this.logger.log(`Successfully orchestrated GSTR verify parent Job: ${data.jobId}`);
    } catch (err) {
      this.logger.error(`Error orchestrating GSTR verify parent Job ${data.jobId}: ${(err as Error).message}`);
      channel.nack(originalMsg, false, false);
    }
  }

  /**
   * Consumes GSTIN verify-and-track-GSTR Batch/Chunk Tasks
   */
  @EventPattern('verify_gstr_chunk')
  async handleVerifyGstrChunk(
    @Payload()
    data: {
      taskId: string;
      jobId: string;
      tableName: string;
      financialYear: string;
      rows: SourceRow[];
    },
    @Ctx() context: RmqContext,
  ) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    this.logger.log(
      `Received verify_gstr_chunk event for Task: ${data.taskId} (Job: ${data.jobId})`,
    );
    try {
      await this.gstComplianceService.processVerifyGstrChunk(
        data.taskId,
        data.jobId,
        data.tableName,
        data.financialYear,
        data.rows,
      );
      channel.ack(originalMsg);
      this.logger.log(`Successfully finished GSTR verify chunk: ${data.taskId}`);
    } catch (err) {
      this.logger.error(`Error processing GSTR verify chunk ${data.taskId}: ${(err as Error).message}`);
      channel.nack(originalMsg, false, false);
    }
  }

  /**
   * Consumes GSTIN verify-and-reconcile-GSTR-2B Parent/Orchestrator Tasks
   */
  @EventPattern('verify_2b_parent')
  async handleVerify2bParent(
    @Payload()
    data: { jobId: string; tableName: string; params: Gstr2bParams },
    @Ctx() context: RmqContext,
  ) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    this.logger.log(`Received verify_2b_parent event for Job: ${data.jobId}`);
    try {
      await this.gstComplianceService.processVerify2bParent(
        data.jobId,
        data.tableName,
        data.params,
      );
      channel.ack(originalMsg);
      this.logger.log(`Successfully orchestrated GSTR-2B verify parent Job: ${data.jobId}`);
    } catch (err) {
      this.logger.error(`Error orchestrating GSTR-2B verify parent Job ${data.jobId}: ${(err as Error).message}`);
      channel.nack(originalMsg, false, false);
    }
  }

  /**
   * Consumes GSTIN verify-and-reconcile-GSTR-2B Batch/Chunk Tasks
   */
  @EventPattern('verify_2b_chunk')
  async handleVerify2bChunk(
    @Payload()
    data: {
      taskId: string;
      jobId: string;
      tableName: string;
      params: Gstr2bParams;
      rows: SourceRow[];
    },
    @Ctx() context: RmqContext,
  ) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    this.logger.log(
      `Received verify_2b_chunk event for Task: ${data.taskId} (Job: ${data.jobId})`,
    );
    try {
      await this.gstComplianceService.processVerify2bChunk(
        data.taskId,
        data.jobId,
        data.tableName,
        data.params,
        data.rows,
      );
      channel.ack(originalMsg);
      this.logger.log(`Successfully finished GSTR-2B verify chunk: ${data.taskId}`);
    } catch (err) {
      this.logger.error(`Error processing GSTR-2B verify chunk ${data.taskId}: ${(err as Error).message}`);
      channel.nack(originalMsg, false, false);
    }
  }
}
