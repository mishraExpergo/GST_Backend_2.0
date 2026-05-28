import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { networkInterfaces } from 'os';
import { AppModule } from './app.module';

function getLocalIPs(): string[] {
  const nets = networkInterfaces();
  const ips: string[] = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST ?? '0.0.0.0';

  await app.listen(port, host);

  const logger = new Logger('Bootstrap');
  const url = await app.getUrl();

  logger.log('=================================================');
  logger.log(`Server is running`);
  logger.log(`Local:            http://localhost:${port}`);
  for (const ip of getLocalIPs()) {
    logger.log(`On Your Network:  http://${ip}:${port}`);
  }
  logger.log(`Bound to:         ${host}:${port}`);
  logger.log(`Nest URL:         ${url}`);
  logger.log(`Environment:      ${process.env.NODE_ENV ?? 'development'}`);
  logger.log(`PID:              ${process.pid}`);
  logger.log('=================================================');
}
bootstrap();
