import { ClientProvider } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
export declare const QUEUES: {
    readonly EXCEL_IMPORT: "gst_excel_import_queue";
    readonly API_PARENT: "gst_api_parent_queue";
    readonly API_CHUNK: "gst_api_chunk_queue";
};
export declare const ALL_QUEUES: ("gst_excel_import_queue" | "gst_api_parent_queue" | "gst_api_chunk_queue")[];
export declare const getRabbitMQClientConfig: (configService: ConfigService, queueName: string) => ClientProvider;
export declare function sanitizeAmqpUrl(url: string): string;
export type QueueStats = {
    messageCount: number;
    consumerCount: number;
};
export declare function pingRabbitMQ(url: string): Promise<void>;
export declare function verifyRabbitMQJobQueues(url: string, queueNames?: readonly string[]): Promise<Record<string, QueueStats>>;
