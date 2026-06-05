import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MongooseModule } from '@nestjs/mongoose';
import { ClientsModule } from '@nestjs/microservices';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GstController } from './gst.controller';
import { GstService } from './gst.service';
import { GstComplianceService } from './gst-compliance.service';
import { GstComplianceClient } from './gst-compliance.client';
import { Job } from '../../entities/job.entity';
import { JobTask } from '../../entities/job-task.entity';
import {
  GstComplianceRecord,
  GstComplianceRecordSchema,
} from '../../schemas/gst-compliance-record.schema';
import { FileStorageService } from '../shared/services/file-storage.service';
import { getRabbitMQClientConfig, QUEUES } from '../../config/rabbitmq.config';
import { GstConsumer } from './gst.consumer';

const enableRabbitMQ = process.env.ENABLE_RABBITMQ === 'true';
const enableMongo = process.env.ENABLE_MONGO === 'true';

@Module({
  imports: [
    TypeOrmModule.forFeature([Job, JobTask]),
    ...(enableMongo
      ? [
          MongooseModule.forFeature([
            {
              name: GstComplianceRecord.name,
              schema: GstComplianceRecordSchema,
            },
          ]),
        ]
      : []),
    ...(enableRabbitMQ
      ? [
          ClientsModule.registerAsync([
            {
              name: 'EXCEL_SERVICE',
              imports: [ConfigModule],
              inject: [ConfigService],
              useFactory: (configService: ConfigService) =>
                getRabbitMQClientConfig(configService, QUEUES.EXCEL_IMPORT),
            },
            {
              name: 'API_PARENT_SERVICE',
              imports: [ConfigModule],
              inject: [ConfigService],
              useFactory: (configService: ConfigService) =>
                getRabbitMQClientConfig(configService, QUEUES.API_PARENT),
            },
            {
              name: 'API_CHUNK_SERVICE',
              imports: [ConfigModule],
              inject: [ConfigService],
              useFactory: (configService: ConfigService) =>
                getRabbitMQClientConfig(configService, QUEUES.API_CHUNK),
            },
          ]),
        ]
      : []),
  ],
  controllers: enableRabbitMQ ? [GstController, GstConsumer] : [GstController],
  providers: [
    GstService,
    GstComplianceService,
    GstComplianceClient,
    FileStorageService,
  ],
  exports: [GstService, GstComplianceService],
})
export class GstModule {}
