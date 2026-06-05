import * as dns from 'node:dns';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Transport } from '@nestjs/microservices';
import { networkInterfaces } from 'os';
import { AppModule } from './app.module';

// On some Windows/VPN setups Node's DNS resolver (c-ares) fails SRV lookups
// with `querySrv ECONNREFUSED`, which breaks `mongodb+srv://` (Atlas) URIs even
// when the OS resolver works. Force public DNS resolvers for these lookups.
if (process.env.DNS_SERVERS) {
  dns.setServers(process.env.DNS_SERVERS.split(',').map((s) => s.trim()));
} else {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
}
import {
  ALL_QUEUES,
  pingRabbitMQ,
  QUEUES,
  sanitizeAmqpUrl,
  verifyRabbitMQJobQueues,
} from './config/rabbitmq.config';

/** If broker is down, disable RMQ before modules load (GstModule reads this env). */
async function resolveRabbitMQMode(logger: Logger): Promise<boolean> {
  if (process.env.ENABLE_RABBITMQ !== 'true') {
    return false;
  }

  const rmqUrl = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
  try {
    await pingRabbitMQ(rmqUrl);
    return true;
  } catch (err) {
    logger.warn('=================================================');
    logger.warn(`RabbitMQ unreachable at ${sanitizeAmqpUrl(rmqUrl)}`);
    logger.warn(
      `Reason: ${err instanceof Error ? err.message : String(err)}`,
    );
    logger.warn('Falling back to INLINE job processing for this session.');
    logger.warn(
      'Start RabbitMQ and set ENABLE_RABBITMQ=true to use queue mode.',
    );
    logger.warn('=================================================');
    process.env.ENABLE_RABBITMQ = 'false';
    return false;
  }
}

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
  const logger = new Logger('Bootstrap');
  const enableRabbitMQ = await resolveRabbitMQMode(logger);

  const app = await NestFactory.create(AppModule);

  if (enableRabbitMQ) {
    const rmqUrl = process.env.RABBITMQ_URL || 'amqp://localhost:5672';

    logger.log('=================================================');
    logger.log('Job queue: RabbitMQ ENABLED');
    logger.log(`Broker:    ${sanitizeAmqpUrl(rmqUrl)}`);
    logger.log('Queues:');
    logger.log(`  - ${QUEUES.EXCEL_IMPORT}  (excel_import)`);
    logger.log(`  - ${QUEUES.API_PARENT}     (api_parent)`);
    logger.log(`  - ${QUEUES.API_CHUNK}      (api_chunk)`);
    logger.log(`  - ${QUEUES.VERIFY_PARENT}  (verify_parent)`);
    logger.log(`  - ${QUEUES.VERIFY_CHUNK}   (verify_chunk)`);
    logger.log('Connecting microservice consumers...');

    app.connectMicroservice({
      transport: Transport.RMQ,
      options: {
        urls: [rmqUrl],
        queue: 'gst_excel_import_queue',
        queueOptions: { durable: true },
        noAck: false,
      },
    });

    app.connectMicroservice({
      transport: Transport.RMQ,
      options: {
        urls: [rmqUrl],
        queue: 'gst_api_parent_queue',
        queueOptions: { durable: true },
        noAck: false,
      },
    });

    app.connectMicroservice({
      transport: Transport.RMQ,
      options: {
        urls: [rmqUrl],
        queue: 'gst_api_chunk_queue',
        queueOptions: { durable: true },
        noAck: false,
      },
    });

    app.connectMicroservice({
      transport: Transport.RMQ,
      options: {
        urls: [rmqUrl],
        queue: QUEUES.VERIFY_PARENT,
        queueOptions: { durable: true },
        noAck: false,
      },
    });

    app.connectMicroservice({
      transport: Transport.RMQ,
      options: {
        urls: [rmqUrl],
        queue: QUEUES.VERIFY_CHUNK,
        queueOptions: { durable: true },
        noAck: false,
      },
    });

    await app.startAllMicroservices();
    logger.log('Microservice consumers connected.');

    await verifyRabbitMQJobQueues(rmqUrl, ALL_QUEUES);
    logger.log('=================================================');
  } else {
    logger.log('=================================================');
    logger.log('Job queue: INLINE mode (ENABLE_RABBITMQ≠true)');
    logger.log('RabbitMQ is not used; upload/API jobs run in-process.');
    logger.log('Set ENABLE_RABBITMQ=true and start RabbitMQ for queue mode.');
    logger.log('=================================================');
  }

  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST ?? '0.0.0.0';

  await app.listen(port, host);

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
