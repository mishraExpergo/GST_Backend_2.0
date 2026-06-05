import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export const toNumber = (
  value: string | undefined,
  fallback: number,
): number => {
  const parsedValue = Number.parseInt(value ?? '', 10);
  return Number.isNaN(parsedValue) ? fallback : parsedValue;
};

const isRdsHost = (host: string): boolean =>
  host.includes('.rds.amazonaws.com');

const rdsSsl = { rejectUnauthorized: false };

export const buildTypeOrmConfig = (
  configService: ConfigService,
): TypeOrmModuleOptions => {
  const synchronize =
    configService.get<string>('POSTGRES_SYNC', 'false') === 'true';
  const databaseUrl = configService.get<string>('DATABASE_URL');

  if (databaseUrl) {
    return {
      type: 'postgres',
      url: databaseUrl.split('?')[0],
      ssl: rdsSsl,
      autoLoadEntities: true,
      synchronize,
    };
  }

  const host = configService.get<string>('POSTGRES_HOST', 'localhost');
  const sslEnabled =
    configService.get<string>('POSTGRES_SSL', 'false') === 'true' ||
    isRdsHost(host);

  return {
    type: 'postgres',
    host,
    port: toNumber(configService.get<string>('POSTGRES_PORT'), 5432),
    username: configService.getOrThrow<string>('POSTGRES_USER'),
    password: configService.getOrThrow<string>('POSTGRES_PASSWORD'),
    database: configService.getOrThrow<string>('POSTGRES_DB'),
    autoLoadEntities: true,
    ssl: sslEnabled ? rdsSsl : false,
    synchronize,
  };
};
