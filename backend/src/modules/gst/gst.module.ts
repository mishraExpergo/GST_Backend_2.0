import { Module } from '@nestjs/common';
import { GstController } from './gst.controller.js';
import { GstService } from './gst.service.js';

@Module({
  controllers: [GstController],
  providers: [GstService],
})
export class GstModule {}
