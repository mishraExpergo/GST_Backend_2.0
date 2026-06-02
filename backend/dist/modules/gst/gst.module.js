"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GstModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const microservices_1 = require("@nestjs/microservices");
const config_1 = require("@nestjs/config");
const gst_controller_1 = require("./gst.controller");
const gst_service_1 = require("./gst.service");
const job_entity_1 = require("../../entities/job.entity");
const job_task_entity_1 = require("../../entities/job-task.entity");
const file_storage_service_1 = require("../shared/services/file-storage.service");
const rabbitmq_config_1 = require("../../config/rabbitmq.config");
const gst_consumer_1 = require("./gst.consumer");
const enableRabbitMQ = process.env.ENABLE_RABBITMQ === 'true';
let GstModule = class GstModule {
};
exports.GstModule = GstModule;
exports.GstModule = GstModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([job_entity_1.Job, job_task_entity_1.JobTask]),
            ...(enableRabbitMQ
                ? [
                    microservices_1.ClientsModule.registerAsync([
                        {
                            name: 'EXCEL_SERVICE',
                            imports: [config_1.ConfigModule],
                            inject: [config_1.ConfigService],
                            useFactory: (configService) => (0, rabbitmq_config_1.getRabbitMQClientConfig)(configService, rabbitmq_config_1.QUEUES.EXCEL_IMPORT),
                        },
                        {
                            name: 'API_PARENT_SERVICE',
                            imports: [config_1.ConfigModule],
                            inject: [config_1.ConfigService],
                            useFactory: (configService) => (0, rabbitmq_config_1.getRabbitMQClientConfig)(configService, rabbitmq_config_1.QUEUES.API_PARENT),
                        },
                        {
                            name: 'API_CHUNK_SERVICE',
                            imports: [config_1.ConfigModule],
                            inject: [config_1.ConfigService],
                            useFactory: (configService) => (0, rabbitmq_config_1.getRabbitMQClientConfig)(configService, rabbitmq_config_1.QUEUES.API_CHUNK),
                        },
                    ]),
                ]
                : []),
        ],
        controllers: enableRabbitMQ ? [gst_controller_1.GstController, gst_consumer_1.GstConsumer] : [gst_controller_1.GstController],
        providers: [gst_service_1.GstService, file_storage_service_1.FileStorageService],
        exports: [gst_service_1.GstService],
    })
], GstModule);
//# sourceMappingURL=gst.module.js.map