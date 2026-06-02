"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var GstConsumer_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GstConsumer = void 0;
const common_1 = require("@nestjs/common");
const microservices_1 = require("@nestjs/microservices");
const gst_service_1 = require("./gst.service");
let GstConsumer = GstConsumer_1 = class GstConsumer {
    gstService;
    logger = new common_1.Logger(GstConsumer_1.name);
    constructor(gstService) {
        this.gstService = gstService;
    }
    async handleExcelImport(data, context) {
        const channel = context.getChannelRef();
        const originalMsg = context.getMessage();
        this.logger.log(`Received excel_import event for Job: ${data.jobId}`);
        try {
            await this.gstService.processExcel(data.filePath, data.tableName, data.jobId);
            channel.ack(originalMsg);
            this.logger.log(`Successfully completed Excel Import Job: ${data.jobId}`);
        }
        catch (err) {
            this.logger.error(`Error processing Excel Import Job ${data.jobId}: ${err.message}`);
            channel.nack(originalMsg, false, false);
        }
    }
    async handleApiParent(data, context) {
        const channel = context.getChannelRef();
        const originalMsg = context.getMessage();
        this.logger.log(`Received api_parent event for Job: ${data.jobId}`);
        try {
            await this.gstService.processApiParent(data.jobId, data.endpoint, data.totalRecords, data.tableName);
            channel.ack(originalMsg);
            this.logger.log(`Successfully orchestrated API parent Job: ${data.jobId}`);
        }
        catch (err) {
            this.logger.error(`Error orchestrating API parent Job ${data.jobId}: ${err.message}`);
            channel.nack(originalMsg, false, false);
        }
    }
    async handleApiChunk(data, context) {
        const channel = context.getChannelRef();
        const originalMsg = context.getMessage();
        this.logger.log(`Received api_chunk event for Task: ${data.taskId} (Job: ${data.jobId}, Page: ${data.page})`);
        try {
            await this.gstService.processApiChunk(data.taskId, data.jobId, data.endpoint, data.page, data.limit, data.tableName);
            channel.ack(originalMsg);
            this.logger.log(`Successfully finished API Ingestion chunk: ${data.taskId}`);
        }
        catch (err) {
            this.logger.error(`Error processing API Ingestion chunk ${data.taskId}: ${err.message}`);
            channel.nack(originalMsg, false, false);
        }
    }
};
exports.GstConsumer = GstConsumer;
__decorate([
    (0, microservices_1.EventPattern)('excel_import'),
    __param(0, (0, microservices_1.Payload)()),
    __param(1, (0, microservices_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, microservices_1.RmqContext]),
    __metadata("design:returntype", Promise)
], GstConsumer.prototype, "handleExcelImport", null);
__decorate([
    (0, microservices_1.EventPattern)('api_parent'),
    __param(0, (0, microservices_1.Payload)()),
    __param(1, (0, microservices_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, microservices_1.RmqContext]),
    __metadata("design:returntype", Promise)
], GstConsumer.prototype, "handleApiParent", null);
__decorate([
    (0, microservices_1.EventPattern)('api_chunk'),
    __param(0, (0, microservices_1.Payload)()),
    __param(1, (0, microservices_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, microservices_1.RmqContext]),
    __metadata("design:returntype", Promise)
], GstConsumer.prototype, "handleApiChunk", null);
exports.GstConsumer = GstConsumer = GstConsumer_1 = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [gst_service_1.GstService])
], GstConsumer);
//# sourceMappingURL=gst.consumer.js.map