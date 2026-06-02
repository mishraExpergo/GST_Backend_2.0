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
Object.defineProperty(exports, "__esModule", { value: true });
exports.GstController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const microservices_1 = require("@nestjs/microservices");
const gst_service_1 = require("./gst.service");
const file_storage_service_1 = require("../shared/services/file-storage.service");
let GstController = class GstController {
    gstService;
    fileStorageService;
    excelClient;
    apiParentClient;
    constructor(gstService, fileStorageService, excelClient, apiParentClient) {
        this.gstService = gstService;
        this.fileStorageService = fileStorageService;
        this.excelClient = excelClient;
        this.apiParentClient = apiParentClient;
    }
    async uploadExcel(file, tableName) {
        if (!file) {
            throw new common_1.BadRequestException('No file uploaded. Send the file under form field "file".');
        }
        if (!tableName || !tableName.trim()) {
            throw new common_1.BadRequestException('"tableName" is required in form-data body.');
        }
        const allowed = [
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel',
            'application/octet-stream',
        ];
        if (file.mimetype && !allowed.includes(file.mimetype)) {
            throw new common_1.BadRequestException(`Unsupported file type: ${file.mimetype}. Upload an .xlsx or .xls file.`);
        }
        const tempPath = await this.fileStorageService.saveBuffer(file.buffer, file.originalname);
        const job = await this.gstService.createJob('EXCEL', {
            originalName: file.originalname,
            tableName,
            tempPath,
        });
        if (this.excelClient) {
            this.excelClient.emit('excel_import', {
                jobId: job.id,
                filePath: tempPath,
                tableName,
            });
        }
        else {
            void this.gstService.processExcel(tempPath, tableName, job.id);
        }
        return {
            message: 'Excel upload accepted for asynchronous processing.',
            jobId: job.id,
            status: job.status,
            checkStatusUrl: `/gst/status/${job.id}`,
        };
    }
    async triggerApiIngest(endpoint, totalRecords, tableName) {
        if (!endpoint || !endpoint.trim()) {
            throw new common_1.BadRequestException('"endpoint" is required.');
        }
        if (!tableName || !tableName.trim()) {
            throw new common_1.BadRequestException('"tableName" is required.');
        }
        const count = Number(totalRecords) || 10000;
        const job = await this.gstService.createJob('API', {
            endpoint,
            totalRecords: count,
            tableName,
        });
        if (this.apiParentClient) {
            this.apiParentClient.emit('api_parent', {
                jobId: job.id,
                endpoint,
                totalRecords: count,
                tableName,
            });
        }
        else {
            void this.gstService.processApiParent(job.id, endpoint, count, tableName);
        }
        return {
            message: 'Bulk API data ingestion job initialized successfully.',
            jobId: job.id,
            status: job.status,
            checkStatusUrl: `/gst/status/${job.id}`,
        };
    }
    async getStatus(jobId) {
        const job = await this.gstService.getJobStatus(jobId);
        if (!job) {
            throw new common_1.BadRequestException(`Job with ID "${jobId}" not found.`);
        }
        const progress = job.totalChunks > 0
            ? Math.round((job.completedChunks / job.totalChunks) * 100)
            : 0;
        return {
            id: job.id,
            type: job.type,
            status: job.status,
            totalChunks: job.totalChunks,
            completedChunks: job.completedChunks,
            progressPercentage: `${progress}%`,
            errorMessage: job.errorMessage,
            metadata: job.metadata,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
        };
    }
};
exports.GstController = GstController;
__decorate([
    (0, common_1.Post)('upload'),
    (0, common_1.HttpCode)(common_1.HttpStatus.ACCEPTED),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', {
        limits: { fileSize: 25 * 1024 * 1024 },
    })),
    __param(0, (0, common_1.UploadedFile)()),
    __param(1, (0, common_1.Body)('tableName')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], GstController.prototype, "uploadExcel", null);
__decorate([
    (0, common_1.Post)('api-ingest'),
    (0, common_1.HttpCode)(common_1.HttpStatus.ACCEPTED),
    __param(0, (0, common_1.Body)('endpoint')),
    __param(1, (0, common_1.Body)('totalRecords')),
    __param(2, (0, common_1.Body)('tableName')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Number, String]),
    __metadata("design:returntype", Promise)
], GstController.prototype, "triggerApiIngest", null);
__decorate([
    (0, common_1.Get)('status/:jobId'),
    __param(0, (0, common_1.Param)('jobId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], GstController.prototype, "getStatus", null);
exports.GstController = GstController = __decorate([
    (0, common_1.Controller)('gst'),
    __param(2, (0, common_1.Optional)()),
    __param(2, (0, common_1.Inject)('EXCEL_SERVICE')),
    __param(3, (0, common_1.Optional)()),
    __param(3, (0, common_1.Inject)('API_PARENT_SERVICE')),
    __metadata("design:paramtypes", [gst_service_1.GstService,
        file_storage_service_1.FileStorageService,
        microservices_1.ClientProxy,
        microservices_1.ClientProxy])
], GstController);
//# sourceMappingURL=gst.controller.js.map