import 'dotenv/config';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { toNumber } from './config/database.config';
import { GstModule } from './modules/gst/gst.module';

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
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
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
        synchronize: configService.get<string>('POSTGRES_SYNC', 'false') === 'true',
      }),
    }),
    GstModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
