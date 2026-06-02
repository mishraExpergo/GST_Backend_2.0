"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const microservices_1 = require("@nestjs/microservices");
const os_1 = require("os");
const app_module_1 = require("./app.module");
const rabbitmq_config_1 = require("./config/rabbitmq.config");
async function resolveRabbitMQMode(logger) {
    if (process.env.ENABLE_RABBITMQ !== 'true') {
        return false;
    }
    const rmqUrl = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
    try {
        await (0, rabbitmq_config_1.pingRabbitMQ)(rmqUrl);
        return true;
    }
    catch (err) {
        logger.warn('=================================================');
        logger.warn(`RabbitMQ unreachable at ${(0, rabbitmq_config_1.sanitizeAmqpUrl)(rmqUrl)}`);
        logger.warn(`Reason: ${err instanceof Error ? err.message : String(err)}`);
        logger.warn('Falling back to INLINE job processing for this session.');
        logger.warn('Start RabbitMQ and set ENABLE_RABBITMQ=true to use queue mode.');
        logger.warn('=================================================');
        process.env.ENABLE_RABBITMQ = 'false';
        return false;
    }
}
function getLocalIPs() {
    const nets = (0, os_1.networkInterfaces)();
    const ips = [];
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
    const logger = new common_1.Logger('Bootstrap');
    const enableRabbitMQ = await resolveRabbitMQMode(logger);
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    if (enableRabbitMQ) {
        const rmqUrl = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
        logger.log('=================================================');
        logger.log('Job queue: RabbitMQ ENABLED');
        logger.log(`Broker:    ${(0, rabbitmq_config_1.sanitizeAmqpUrl)(rmqUrl)}`);
        logger.log('Queues:');
        logger.log(`  - ${rabbitmq_config_1.QUEUES.EXCEL_IMPORT}  (excel_import)`);
        logger.log(`  - ${rabbitmq_config_1.QUEUES.API_PARENT}     (api_parent)`);
        logger.log(`  - ${rabbitmq_config_1.QUEUES.API_CHUNK}      (api_chunk)`);
        logger.log('Connecting microservice consumers...');
        app.connectMicroservice({
            transport: microservices_1.Transport.RMQ,
            options: {
                urls: [rmqUrl],
                queue: 'gst_excel_import_queue',
                queueOptions: { durable: true },
                noAck: false,
            },
        });
        app.connectMicroservice({
            transport: microservices_1.Transport.RMQ,
            options: {
                urls: [rmqUrl],
                queue: 'gst_api_parent_queue',
                queueOptions: { durable: true },
                noAck: false,
            },
        });
        app.connectMicroservice({
            transport: microservices_1.Transport.RMQ,
            options: {
                urls: [rmqUrl],
                queue: 'gst_api_chunk_queue',
                queueOptions: { durable: true },
                noAck: false,
            },
        });
        await app.startAllMicroservices();
        logger.log('Microservice consumers connected.');
        await (0, rabbitmq_config_1.verifyRabbitMQJobQueues)(rmqUrl, rabbitmq_config_1.ALL_QUEUES);
        logger.log('=================================================');
    }
    else {
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
//# sourceMappingURL=main.js.map