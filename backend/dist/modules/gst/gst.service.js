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
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var GstService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GstService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const microservices_1 = require("@nestjs/microservices");
const XLSX = __importStar(require("xlsx"));
const fs = __importStar(require("fs"));
const job_entity_1 = require("../../entities/job.entity");
const job_task_entity_1 = require("../../entities/job-task.entity");
const file_storage_service_1 = require("../shared/services/file-storage.service");
let GstService = GstService_1 = class GstService {
    dataSource;
    jobRepo;
    taskRepo;
    fileStorageService;
    apiChunkClient;
    logger = new common_1.Logger(GstService_1.name);
    constructor(dataSource, jobRepo, taskRepo, fileStorageService, apiChunkClient) {
        this.dataSource = dataSource;
        this.jobRepo = jobRepo;
        this.taskRepo = taskRepo;
        this.fileStorageService = fileStorageService;
        this.apiChunkClient = apiChunkClient;
    }
    async createJob(type, metadata) {
        const job = this.jobRepo.create({
            type,
            status: 'PENDING',
            metadata,
        });
        return this.jobRepo.save(job);
    }
    async getJobStatus(jobId) {
        return this.jobRepo.findOne({
            where: { id: jobId },
            relations: { tasks: true },
        });
    }
    async updateJobStatus(jobId, status, errorMessage) {
        await this.jobRepo.update(jobId, { status, errorMessage });
        this.logger.log(`Job ${jobId} status updated to ${status}`);
    }
    async processExcel(filePath, rawTableName, jobId) {
        await this.jobRepo.update(jobId, { status: 'PROCESSING' });
        const tableName = this.sanitizeIdentifier(rawTableName);
        try {
            if (!fs.existsSync(filePath)) {
                throw new Error(`Cached excel file not found at path: ${filePath}`);
            }
            const workbook = XLSX.readFile(filePath, { cellDates: true });
            const sheetName = workbook.SheetNames[0];
            if (!sheetName) {
                throw new common_1.BadRequestException('Excel file contains no sheets.');
            }
            const sheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(sheet, {
                defval: null,
                raw: true,
            });
            if (rows.length === 0) {
                throw new common_1.BadRequestException('Excel sheet is empty.');
            }
            const headerSet = new Set();
            for (const row of rows) {
                Object.keys(row).forEach((k) => headerSet.add(k));
            }
            const rawHeaders = Array.from(headerSet);
            const columns = rawHeaders.map((header) => ({
                raw: header,
                name: this.sanitizeIdentifier(header),
                type: this.inferColumnType(rows, header),
            }));
            const seen = new Set();
            for (const col of columns) {
                if (seen.has(col.name)) {
                    throw new common_1.BadRequestException(`Duplicate column name "${col.name}" after sanitization.`);
                }
                seen.add(col.name);
            }
            await this.jobRepo.update(jobId, { totalChunks: 1 });
            const queryRunner = this.dataSource.createQueryRunner();
            await queryRunner.connect();
            await queryRunner.startTransaction();
            try {
                await queryRunner.query(`DROP TABLE IF EXISTS "${tableName}"`);
                const createSql = this.buildCreateTableSql(tableName, columns);
                await queryRunner.query(createSql);
                const colList = columns.map((c) => `"${c.name}"`).join(', ');
                const batchSize = 500;
                for (let i = 0; i < rows.length; i += batchSize) {
                    const batch = rows.slice(i, i + batchSize);
                    const params = [];
                    const valueRows = [];
                    for (const row of batch) {
                        const rowPlaceholders = [];
                        for (const col of columns) {
                            rowPlaceholders.push(`$${params.length + 1}`);
                            params.push(this.coerceValue(row[col.raw], col.type));
                        }
                        valueRows.push(`(${rowPlaceholders.join(', ')})`);
                    }
                    const insertSql = `INSERT INTO "${tableName}" (${colList}) VALUES ${valueRows.join(', ')}`;
                    await queryRunner.query(insertSql, params);
                }
                await queryRunner.commitTransaction();
            }
            catch (err) {
                await queryRunner.rollbackTransaction();
                throw err;
            }
            finally {
                await queryRunner.release();
            }
            await this.jobRepo.update(jobId, {
                status: 'COMPLETED',
                completedChunks: 1,
            });
        }
        catch (err) {
            await this.updateJobStatus(jobId, 'FAILED', err.message);
            throw err;
        }
        finally {
            await this.fileStorageService.deleteFile(filePath);
        }
    }
    async processApiParent(jobId, endpoint, totalRecords, rawTableName) {
        try {
            await this.jobRepo.update(jobId, { status: 'PROCESSING' });
            const tableName = this.sanitizeIdentifier(rawTableName);
            const sample = this.getMockSampleRecord();
            const headers = Object.keys(sample);
            const columns = headers.map((header) => ({
                raw: header,
                name: this.sanitizeIdentifier(header),
                type: this.inferColumnType([sample], header),
            }));
            const queryRunner = this.dataSource.createQueryRunner();
            await queryRunner.connect();
            try {
                await queryRunner.query(`DROP TABLE IF EXISTS "${tableName}"`);
                const createSql = this.buildCreateTableSql(tableName, columns);
                this.logger.log(`Parent Orchestrator created table: ${tableName}`);
                await queryRunner.query(createSql);
            }
            finally {
                await queryRunner.release();
            }
            const limit = 1000;
            const totalChunks = Math.ceil(totalRecords / limit);
            await this.jobRepo.update(jobId, { totalChunks });
            for (let page = 1; page <= totalChunks; page++) {
                const task = this.taskRepo.create({
                    jobId,
                    status: 'PENDING',
                    payload: { page, limit, endpoint, tableName },
                });
                const savedTask = await this.taskRepo.save(task);
                if (this.apiChunkClient) {
                    this.apiChunkClient.emit('api_chunk', {
                        taskId: savedTask.id,
                        jobId,
                        endpoint,
                        page,
                        limit,
                        tableName,
                    });
                }
                else {
                    void this.processApiChunk(savedTask.id, jobId, endpoint, page, limit, tableName);
                }
            }
            this.logger.log(`Orchestrated ${totalChunks} chunks for Job ${jobId}`);
        }
        catch (err) {
            await this.updateJobStatus(jobId, 'FAILED', err.message);
            throw err;
        }
    }
    async processApiChunk(taskId, jobId, endpoint, page, limit, tableName) {
        await this.taskRepo.update(taskId, { status: 'PROCESSING', attempts: 1 });
        try {
            const records = this.fetchMockApiPage(page, limit);
            const sample = this.getMockSampleRecord();
            const headers = Object.keys(sample);
            const columns = headers.map((header) => ({
                raw: header,
                name: this.sanitizeIdentifier(header),
                type: this.inferColumnType([sample], header),
            }));
            const queryRunner = this.dataSource.createQueryRunner();
            await queryRunner.connect();
            await queryRunner.startTransaction();
            try {
                const colList = columns.map((c) => `"${c.name}"`).join(', ');
                const params = [];
                const valueRows = [];
                for (const row of records) {
                    const rowPlaceholders = [];
                    for (const col of columns) {
                        rowPlaceholders.push(`$${params.length + 1}`);
                        params.push(this.coerceValue(row[col.raw], col.type));
                    }
                    valueRows.push(`(${rowPlaceholders.join(', ')})`);
                }
                const insertSql = `INSERT INTO "${tableName}" (${colList}) VALUES ${valueRows.join(', ')}`;
                await queryRunner.query(insertSql, params);
                await queryRunner.commitTransaction();
            }
            catch (err) {
                await queryRunner.rollbackTransaction();
                throw err;
            }
            finally {
                await queryRunner.release();
            }
            await this.taskRepo.update(taskId, { status: 'COMPLETED' });
            const job = await this.jobRepo.findOne({ where: { id: jobId } });
            if (job) {
                const newCompleted = job.completedChunks + 1;
                const newStatus = newCompleted >= job.totalChunks ? 'COMPLETED' : 'PROCESSING';
                await this.jobRepo.update(jobId, {
                    completedChunks: newCompleted,
                    status: newStatus,
                });
            }
        }
        catch (err) {
            await this.taskRepo.update(taskId, { status: 'FAILED', errorMessage: err.message });
            throw err;
        }
    }
    getMockSampleRecord() {
        return {
            gstin: 'string',
            legal_name: 'string',
            trade_name: 'string',
            filing_date: new Date(),
            taxable_value: 12.34,
            tax_amount: 56.78,
            is_active: true,
            total_invoices: 100,
        };
    }
    fetchMockApiPage(page, limit) {
        const records = [];
        const offset = (page - 1) * limit;
        for (let i = 0; i < limit; i++) {
            records.push({
                gstin: `27AAACS${1000 + i}A1Z${i % 9}`,
                legal_name: `Taxpayer Enterprise Co ${offset + i}`,
                trade_name: `Filing Trade Group ${offset + i}`,
                filing_date: new Date(Date.now() - (i % 30) * 24 * 3600 * 1000),
                taxable_value: parseFloat((100.50 * (i + 1) + 250).toFixed(2)),
                tax_amount: parseFloat((18.09 * (i + 1) + 45).toFixed(2)),
                is_active: i % 15 !== 0,
                total_invoices: 10 + i,
            });
        }
        return records;
    }
    sanitizeIdentifier(name) {
        const cleaned = String(name ?? '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_]+/g, '_')
            .replace(/^_+|_+$/g, '');
        if (!cleaned) {
            throw new common_1.BadRequestException(`Invalid identifier: "${name}"`);
        }
        const safe = /^\d/.test(cleaned) ? `_${cleaned}` : cleaned;
        return safe.slice(0, 63);
    }
    inferColumnType(rows, header) {
        let allInt = true;
        let allNumber = true;
        let allDate = true;
        let allBool = true;
        let hasValue = false;
        for (const row of rows) {
            const v = row[header];
            if (v === null || v === undefined || v === '')
                continue;
            hasValue = true;
            if (typeof v !== 'boolean')
                allBool = false;
            if (typeof v === 'number' && Number.isFinite(v)) {
                if (!Number.isInteger(v))
                    allInt = false;
            }
            else {
                allInt = false;
                allNumber = false;
            }
            if (!(v instanceof Date)) {
                allDate = false;
            }
        }
        if (!hasValue)
            return 'TEXT';
        if (allBool)
            return 'BOOLEAN';
        if (allInt)
            return 'INTEGER';
        if (allNumber)
            return 'NUMERIC';
        if (allDate)
            return 'TIMESTAMP';
        return 'TEXT';
    }
    coerceValue(value, type) {
        if (value === null || value === undefined || value === '')
            return null;
        switch (type) {
            case 'INTEGER':
            case 'NUMERIC': {
                const n = typeof value === 'number' ? value : Number(value);
                return Number.isFinite(n) ? n : null;
            }
            case 'TIMESTAMP': {
                if (value instanceof Date)
                    return value.toISOString();
                const d = new Date(String(value));
                return Number.isNaN(d.getTime()) ? null : d.toISOString();
            }
            case 'BOOLEAN':
                return Boolean(value);
            case 'TEXT':
            default:
                return String(value);
        }
    }
    buildCreateTableSql(tableName, columns) {
        const cols = columns.map((c) => `"${c.name}" ${c.type} NULL`).join(', ');
        return `CREATE TABLE "${tableName}" (id SERIAL PRIMARY KEY, ${cols})`;
    }
};
exports.GstService = GstService;
exports.GstService = GstService = GstService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectDataSource)()),
    __param(1, (0, typeorm_1.InjectRepository)(job_entity_1.Job)),
    __param(2, (0, typeorm_1.InjectRepository)(job_task_entity_1.JobTask)),
    __param(4, (0, common_1.Optional)()),
    __param(4, (0, common_1.Inject)('API_CHUNK_SERVICE')),
    __metadata("design:paramtypes", [typeorm_2.DataSource,
        typeorm_2.Repository,
        typeorm_2.Repository,
        file_storage_service_1.FileStorageService,
        microservices_1.ClientProxy])
], GstService);
//# sourceMappingURL=gst.service.js.map