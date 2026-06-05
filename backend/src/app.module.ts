import { config } from 'dotenv';
import { join } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { buildTypeOrmConfig } from './config/database.config';
import { GstModule } from './modules/gst/gst.module';

config({ path: join(__dirname, '..', '.env') });

const enableMongo = process.env.ENABLE_MONGO === 'true';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: join(__dirname, '..', '.env'),
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
      useFactory: (configService: ConfigService) =>
        buildTypeOrmConfig(configService),
    }),
    GstModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
