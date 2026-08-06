import 'dotenv/config';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { toNumber } from './config/database.config';
import { GstModule } from './modules/gst/gst.module';
import { AuthModule } from './auth/auth.module';
import { SchemaBootstrapService } from './database/schema-bootstrap.service';
import { DbQueryLogModule } from './database/db-query-log/db-query-log.module';
import { DbQueryTypeOrmLogger } from './database/db-query-log/db-query-log.typeorm-logger';
import { isDbQueryLoggingEnabled } from './database/db-query-log/db-query-log.context';

const enableMongo = process.env.ENABLE_MONGO === 'true';
const enableDbQueryLogs = isDbQueryLoggingEnabled();

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    DbQueryLogModule,
    ...(enableMongo
      ? [
          MongooseModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => ({
              uri: configService.getOrThrow<string>('MONGO_URI'),
            }),
          }),
        ]
      : []),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const poolMax = Math.max(
          1,
          toNumber(configService.get<string>('POSTGRES_POOL_MAX'), 5),
        );
        return {
          type: 'postgres' as const,
          host: configService.get<string>('POSTGRES_HOST', 'localhost'),
          port: toNumber(configService.get<string>('POSTGRES_PORT'), 5432),
          username: configService.getOrThrow<string>('POSTGRES_USER'),
          password: configService.getOrThrow<string>('POSTGRES_PASSWORD'),
          database: configService.getOrThrow<string>('POSTGRES_DB'),
          autoLoadEntities: true,
          ssl:
            configService.get<string>('POSTGRES_SSL', 'false') === 'true'
              ? { rejectUnauthorized: false }
              : false,
          synchronize:
            configService.get<string>('POSTGRES_SYNC', 'false') === 'true',
          // Capture SQL when ENABLE_DB_QUERY_LOGS=true (custom logger → db_query_logs).
          logging: enableDbQueryLogs ? (['query', 'error'] as const) : false,
          logger: enableDbQueryLogs ? new DbQueryTypeOrmLogger() : undefined,
          maxQueryExecutionTime: enableDbQueryLogs ? 1000 : undefined,
          // Retry when RDS is temporarily at max_connections (53300).
          retryAttempts: 10,
          retryDelay: 3000,
          // Keep pool small on shared RDS (avoids "rds_reserved" slot exhaustion).
          extra: {
            max: poolMax,
            min: 0,
            idleTimeoutMillis: toNumber(
              configService.get<string>('POSTGRES_POOL_IDLE_MS'),
              10000,
            ),
            connectionTimeoutMillis: toNumber(
              configService.get<string>('POSTGRES_POOL_CONN_TIMEOUT_MS'),
              10000,
            ),
            allowExitOnIdle: true,
            application_name: 'gst-backend',
          },
        };
      },
    }),
    GstModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService, SchemaBootstrapService],
})
export class AppModule {}
