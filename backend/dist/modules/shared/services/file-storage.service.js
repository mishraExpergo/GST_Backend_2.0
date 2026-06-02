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
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
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
var FileStorageService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileStorageService = void 0;
const common_1 = require("@nestjs/common");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const uuid_1 = require("uuid");
let FileStorageService = FileStorageService_1 = class FileStorageService {
    logger = new common_1.Logger(FileStorageService_1.name);
    tempDir = path.join(process.cwd(), 'temp-uploads');
    onModuleInit() {
        this.ensureDirectoryExists(this.tempDir);
    }
    async saveBuffer(buffer, originalName) {
        const ext = path.extname(originalName) || '.xlsx';
        const filename = `${(0, uuid_1.v4)()}${ext}`;
        const fullPath = path.join(this.tempDir, filename);
        this.ensureDirectoryExists(this.tempDir);
        await fs.promises.writeFile(fullPath, buffer);
        this.logger.log(`Temporary file saved at: ${fullPath}`);
        return fullPath;
    }
    async deleteFile(filePath) {
        try {
            if (fs.existsSync(filePath)) {
                await fs.promises.unlink(filePath);
                this.logger.log(`Temporary file deleted: ${filePath}`);
            }
        }
        catch (err) {
            this.logger.error(`Failed to delete temporary file ${filePath}: ${err.message}`);
        }
    }
    ensureDirectoryExists(dir) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            this.logger.log(`Created directory: ${dir}`);
        }
    }
};
exports.FileStorageService = FileStorageService;
exports.FileStorageService = FileStorageService = FileStorageService_1 = __decorate([
    (0, common_1.Injectable)()
], FileStorageService);
//# sourceMappingURL=file-storage.service.js.map