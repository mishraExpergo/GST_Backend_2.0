import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MongooseModule } from '@nestjs/mongoose';
import { ClientsModule } from '@nestjs/microservices';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GstController } from './gst.controller';
import { GstService } from './gst.service';
import { Job } from '../../entities/job.entity';
import { JobTask } from '../../entities/job-task.entity';
import { FileStorageService } from '../shared/services/file-storage.service';
import { getRabbitMQClientConfig, QUEUES } from '../../config/rabbitmq.config';
import { GstConsumer } from './gst.consumer';
import { GstAuthService } from './services/gst-auth.service';
import { GstApiService } from './services/gst-api.service';
import { GstComplianceService } from './services/gst-compliance.service';
import {
  GstComplianceRecord,
  GstComplianceSchema,
} from './schemas/gst-compliance.schema';
import {
  GstrComplianceRecord,
  GstrComplianceSchema,
} from './schemas/gst-gstr-compliance.schema';
import {
  Gstr2bComplianceRecord,
  Gstr2bComplianceSchema,
} from './schemas/gst-2b-compliance.schema';

const enableRabbitMQ = process.env.ENABLE_RABBITMQ === 'true';
const enableMongo = process.env.ENABLE_MONGO === 'true';

@Module({
  imports: [
    TypeOrmModule.forFeature([Job, JobTask]),
    ...(enableMongo
      ? [
          MongooseModule.forFeature([
            { name: GstComplianceRecord.name, schema: GstComplianceSchema },
            {
              name: GstrComplianceRecord.name,
              schema: GstrComplianceSchema,
            },
            {
              name: Gstr2bComplianceRecord.name,
              schema: Gstr2bComplianceSchema,
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
              name: 'VERIFY_PARENT_SERVICE',
              imports: [ConfigModule],
              inject: [ConfigService],
              useFactory: (configService: ConfigService) =>
                getRabbitMQClientConfig(configService, QUEUES.VERIFY_PARENT),
            },
            {
              name: 'VERIFY_CHUNK_SERVICE',
              imports: [ConfigModule],
              inject: [ConfigService],
              useFactory: (configService: ConfigService) =>
                getRabbitMQClientConfig(configService, QUEUES.VERIFY_CHUNK),
            },
            {
              name: 'VERIFY_GSTR_PARENT_SERVICE',
              imports: [ConfigModule],
              inject: [ConfigService],
              useFactory: (configService: ConfigService) =>
                getRabbitMQClientConfig(
                  configService,
                  QUEUES.VERIFY_GSTR_PARENT,
                ),
            },
            {
              name: 'VERIFY_GSTR_CHUNK_SERVICE',
              imports: [ConfigModule],
              inject: [ConfigService],
              useFactory: (configService: ConfigService) =>
                getRabbitMQClientConfig(
                  configService,
                  QUEUES.VERIFY_GSTR_CHUNK,
                ),
            },
            {
              name: 'VERIFY_2B_PARENT_SERVICE',
              imports: [ConfigModule],
              inject: [ConfigService],
              useFactory: (configService: ConfigService) =>
                getRabbitMQClientConfig(configService, QUEUES.VERIFY_2B_PARENT),
            },
            {
              name: 'VERIFY_2B_CHUNK_SERVICE',
              imports: [ConfigModule],
              inject: [ConfigService],
              useFactory: (configService: ConfigService) =>
                getRabbitMQClientConfig(configService, QUEUES.VERIFY_2B_CHUNK),
            },
          ]),
        ]
      : []),
  ],
  controllers: enableRabbitMQ ? [GstController, GstConsumer] : [GstController],
  providers: [
    GstService,
    FileStorageService,
    GstAuthService,
    GstApiService,
    GstComplianceService,
  ],
  exports: [GstService],
})
export class GstModule {}
