"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRabbitMQClientConfig = exports.ALL_QUEUES = exports.QUEUES = void 0;
exports.sanitizeAmqpUrl = sanitizeAmqpUrl;
exports.pingRabbitMQ = pingRabbitMQ;
exports.verifyRabbitMQJobQueues = verifyRabbitMQJobQueues;
const common_1 = require("@nestjs/common");
const microservices_1 = require("@nestjs/microservices");
const amqp = __importStar(require("amqplib"));
exports.QUEUES = {
    EXCEL_IMPORT: 'gst_excel_import_queue',
    API_PARENT: 'gst_api_parent_queue',
    API_CHUNK: 'gst_api_chunk_queue',
};
exports.ALL_QUEUES = Object.values(exports.QUEUES);
const getRabbitMQClientConfig = (configService, queueName) => {
    const url = configService.get('RABBITMQ_URL', 'amqp://localhost:5672');
    return {
        transport: microservices_1.Transport.RMQ,
        options: {
            urls: [url],
            queue: queueName,
            queueOptions: {
                durable: true,
            },
        },
    };
};
exports.getRabbitMQClientConfig = getRabbitMQClientConfig;
function sanitizeAmqpUrl(url) {
    try {
        const parsed = new URL(url);
        if (parsed.password) {
            parsed.password = '****';
        }
        return parsed.toString();
    }
    catch {
        return url.replace(/:([^@/]+)@/, ':****@');
    }
}
async function pingRabbitMQ(url) {
    const connection = await amqp.connect(url);
    await connection.close();
}
async function verifyRabbitMQJobQueues(url, queueNames = exports.ALL_QUEUES) {
    const logger = new common_1.Logger('RabbitMQ');
    const safeUrl = sanitizeAmqpUrl(url);
    logger.log(`Verifying job queue connection → ${safeUrl}`);
    const connection = await amqp.connect(url);
    const channel = await connection.createChannel();
    const stats = {};
    try {
        for (const queue of queueNames) {
            await channel.assertQueue(queue, { durable: true });
            const { messageCount, consumerCount } = await channel.checkQueue(queue);
            stats[queue] = { messageCount, consumerCount };
            logger.log(`  ✓ Queue "${queue}" ready (messages=${messageCount}, consumers=${consumerCount})`);
        }
        logger.log('Job queue setup verified successfully.');
        return stats;
    }
    finally {
        await channel.close();
        await connection.close();
    }
}
//# sourceMappingURL=rabbitmq.config.js.map