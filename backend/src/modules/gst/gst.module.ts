import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsModule } from '@nestjs/microservices';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GstController } from './gst.controller';
import { GstService } from './gst.service';
import { Job } from '../../entities/job.entity';
import { JobTask } from '../../entities/job-task.entity';
import { FileStorageService } from '../shared/services/file-storage.service';
import { getRabbitMQClientConfig, QUEUES } from '../../config/rabbitmq.config';
import { GstConsumer } from './gst.consumer';

const enableRabbitMQ = process.env.ENABLE_RABBITMQ === 'true';

@Module({
  imports: [
    TypeOrmModule.forFeature([Job, JobTask]),
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
  providers: [GstService, FileStorageService],
  exports: [GstService],
})
export class GstModule {}
