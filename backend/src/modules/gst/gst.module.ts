import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MongooseModule } from '@nestjs/mongoose';
import { ClientsModule } from '@nestjs/microservices';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GstController } from './gst.controller';
import { GstService } from './gst.service';
import { Job } from '../../entities/job.entity';
import { JobTask } from '../../entities/job-task.entity';
import { PrimaryGstAggregation } from '../../entities/primary-gst-aggregation.entity';
import { SecondaryGstAggregation } from '../../entities/secondary-gst-aggregation.entity';
import { TaxpayerAuthSession } from '../../entities/taxpayer-auth-session.entity';
import { ApiRequestLog } from '../../entities/api-request-log.entity';
import { FileStorageService } from '../shared/services/file-storage.service';
import { getRabbitMQClientConfig, QUEUES } from '../../config/rabbitmq.config';
import { GstConsumer } from './gst.consumer';
import { GstAuthService } from './services/gst-auth.service';
import { GstApiService } from './services/gst-api.service';
import { GstComplianceService } from './services/gst-compliance.service';
import { GstAggregationService } from './services/gst-aggregation.service';
import { GstTaxpayerAuthService } from './services/gst-taxpayer-auth.service';
import { GstTaxpayerReturnsService } from './services/gst-taxpayer-returns.service';
import { ApiRequestLogService } from './services/api-request-log.service';
import {
  GstComplianceRecord,
  GstComplianceSchema,
} from './schemas/gst-compliance.schema';
import {
  Gstr2bComplianceRecord,
  Gstr2bComplianceSchema,
} from './schemas/gst-gstr2b-compliance.schema';
import {
  Gstr3bComplianceRecord,
  Gstr3bComplianceSchema,
} from './schemas/gst-gstr3b-compliance.schema';

const enableRabbitMQ = process.env.ENABLE_RABBITMQ === 'true';
const enableMongo = process.env.ENABLE_MONGO === 'true';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Job,
      JobTask,
      PrimaryGstAggregation,
      SecondaryGstAggregation,
      TaxpayerAuthSession,
      ApiRequestLog,
    ]),
    ...(enableMongo
      ? [
          MongooseModule.forFeature([
            { name: GstComplianceRecord.name, schema: GstComplianceSchema },
            { name: Gstr2bComplianceRecord.name, schema: Gstr2bComplianceSchema },
            { name: Gstr3bComplianceRecord.name, schema: Gstr3bComplianceSchema },
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
    GstAggregationService,
    GstTaxpayerAuthService,
    GstTaxpayerReturnsService,
    ApiRequestLogService,
  ],
  exports: [GstService],
})
export class GstModule {}
