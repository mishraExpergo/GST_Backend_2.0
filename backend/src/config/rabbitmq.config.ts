import { Logger } from '@nestjs/common';
import { ClientProvider, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';

export const QUEUES = {
  EXCEL_IMPORT: 'gst_excel_import_queue',
  API_PARENT: 'gst_api_parent_queue',
  API_CHUNK: 'gst_api_chunk_queue',
} as const;

export const ALL_QUEUES = Object.values(QUEUES);

export const getRabbitMQClientConfig = (
  configService: ConfigService,
  queueName: string,
): ClientProvider => {
  const url = configService.get<string>(
    'RABBITMQ_URL',
    'amqp://localhost:5672',
  );
  return {
    transport: Transport.RMQ,
    options: {
      urls: [url],
      queue: queueName,
      queueOptions: {
        durable: true,
      },
    },
  };
};

/** Redact credentials before logging AMQP URLs. */
export function sanitizeAmqpUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = '****';
    }
    return parsed.toString();
  } catch {
    return url.replace(/:([^@/]+)@/, ':****@');
  }
}

export type QueueStats = {
  messageCount: number;
  consumerCount: number;
};

/** Quick broker reachability check (use before NestFactory.create). */
export async function pingRabbitMQ(url: string): Promise<void> {
  const connection = await amqp.connect(url);
  await connection.close();
}

/**
 * Connects to RabbitMQ and verifies each job queue is reachable.
 * Call after microservices have started so queues are declared.
 */
export async function verifyRabbitMQJobQueues(
  url: string,
  queueNames: readonly string[] = ALL_QUEUES,
): Promise<Record<string, QueueStats>> {
  const logger = new Logger('RabbitMQ');
  const safeUrl = sanitizeAmqpUrl(url);

  logger.log(`Verifying job queue connection → ${safeUrl}`);

  const connection = await amqp.connect(url);
  const channel = await connection.createChannel();
  const stats: Record<string, QueueStats> = {};

  try {
    for (const queue of queueNames) {
      await channel.assertQueue(queue, { durable: true });
      const { messageCount, consumerCount } = await channel.checkQueue(queue);
      stats[queue] = { messageCount, consumerCount };
      logger.log(
        `  ✓ Queue "${queue}" ready (messages=${messageCount}, consumers=${consumerCount})`,
      );
    }
    logger.log('Job queue setup verified successfully.');
    return stats;
  } finally {
    await channel.close();
    await connection.close();
  }
}
