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
const gst_service_js_1 = require("./gst.service.js");
let GstController = class GstController {
    gstService;
    constructor(gstService) {
        this.gstService = gstService;
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
        return this.gstService.processExcel(file.buffer, tableName);
    }
};
exports.GstController = GstController;
__decorate([
    (0, common_1.Post)('upload'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', {
        limits: { fileSize: 25 * 1024 * 1024 },
    })),
    __param(0, (0, common_1.UploadedFile)()),
    __param(1, (0, common_1.Body)('tableName')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], GstController.prototype, "uploadExcel", null);
exports.GstController = GstController = __decorate([
    (0, common_1.Controller)('gst'),
    __metadata("design:paramtypes", [gst_service_js_1.GstService])
], GstController);
//# sourceMappingURL=gst.controller.js.map