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

const enableMongo = process.env.ENABLE_MONGO === 'true';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
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
          // Keep pool small on shared RDS (avoids "rds_reserved" slot exhaustion).
          extra: {
            max: poolMax,
            idleTimeoutMillis: toNumber(
              configService.get<string>('POSTGRES_POOL_IDLE_MS'),
              30000,
            ),
            connectionTimeoutMillis: toNumber(
              configService.get<string>('POSTGRES_POOL_CONN_TIMEOUT_MS'),
              10000,
            ),
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
