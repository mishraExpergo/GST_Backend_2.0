import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { GstService } from './gst.service';
import { GstComplianceService } from './services/gst-compliance.service';

interface SourceRow {
  loan_id: string;
  customer_id: string | null;
  username: string | null;
  gst_no: string | null;
  pan: string | null;
  entity_type: 'PRIMARY' | 'CONSIDERED_ENTITY';
}

@Controller()
export class GstConsumer {
  private readonly logger = new Logger(GstConsumer.name);

  constructor(
    private readonly gstService: GstService,
    private readonly gstComplianceService: GstComplianceService,
  ) {}

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
      channel.ack(originalMsg);
      this.logger.log(`Successfully completed Excel Import Job: ${data.jobId}`);
    } catch (err) {
      this.logger.error(
        `Error processing Excel Import Job ${data.jobId}: ${(err as Error).message}`,
      );
      channel.nack(originalMsg, false, false);
    }
  }

  @EventPattern('verify_parent')
  async handleVerifyParent(
    @Payload() data: { jobId: string; tableName: string },
    @Ctx() context: RmqContext,
  ) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    this.logger.log(`Received verify_parent event for Job: ${data.jobId}`);
    try {
      await this.gstComplianceService.processVerifyParent(data.jobId, data.tableName);
      channel.ack(originalMsg);
      this.logger.log(`Successfully orchestrated verify parent Job: ${data.jobId}`);
    } catch (err) {
      this.logger.error(
        `Error orchestrating verify parent Job ${data.jobId}: ${(err as Error).message}`,
      );
      channel.nack(originalMsg, false, false);
    }
  }

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
      this.logger.error(
        `Error processing verify chunk ${data.taskId}: ${(err as Error).message}`,
      );
      channel.nack(originalMsg, false, false);
    }
  }
}
