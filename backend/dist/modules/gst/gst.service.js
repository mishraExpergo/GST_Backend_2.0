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
const XLSX = __importStar(require("xlsx"));
let GstService = GstService_1 = class GstService {
    dataSource;
    logger = new common_1.Logger(GstService_1.name);
    constructor(dataSource) {
        this.dataSource = dataSource;
    }
    async processExcel(buffer, rawTableName) {
        const tableName = this.sanitizeIdentifier(rawTableName);
        const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
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
            throw new common_1.BadRequestException('Excel sheet is empty. Need at least one data row.');
        }
        const headerSet = new Set();
        for (const row of rows) {
            Object.keys(row).forEach((k) => headerSet.add(k));
        }
        const rawHeaders = Array.from(headerSet);
        if (rawHeaders.length === 0) {
            throw new common_1.BadRequestException('No columns detected in the Excel sheet.');
        }
        const columns = rawHeaders.map((header) => ({
            raw: header,
            name: this.sanitizeIdentifier(header),
            type: this.inferColumnType(rows, header),
        }));
        const seen = new Set();
        for (const col of columns) {
            if (seen.has(col.name)) {
                throw new common_1.BadRequestException(`Duplicate column name "${col.name}" after sanitization. Rename headers in Excel.`);
            }
            seen.add(col.name);
        }
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
            await queryRunner.query(`DROP TABLE IF EXISTS "${tableName}"`);
            const createSql = this.buildCreateTableSql(tableName, columns);
            this.logger.log(`Creating table: ${createSql}`);
            await queryRunner.query(createSql);
            const colList = columns.map((c) => `"${c.name}"`).join(', ');
            const batchSize = 500;
            let inserted = 0;
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
                inserted += batch.length;
            }
            await queryRunner.commitTransaction();
            return {
                message: 'Excel uploaded and table created successfully.',
                table: tableName,
                sheet: sheetName,
                columns: columns.map(({ raw, name, type }) => ({ raw, name, type })),
                rowsInserted: inserted,
            };
        }
        catch (err) {
            await queryRunner.rollbackTransaction();
            this.logger.error('Failed to process Excel', err);
            throw new common_1.InternalServerErrorException(`Failed to process Excel: ${err.message}`);
        }
        finally {
            await queryRunner.release();
        }
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
        const cols = columns
            .map((c) => `"${c.name}" ${c.type} NULL`)
            .join(', ');
        return `CREATE TABLE "${tableName}" (id SERIAL PRIMARY KEY, ${cols})`;
    }
};
exports.GstService = GstService;
exports.GstService = GstService = GstService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectDataSource)()),
    __metadata("design:paramtypes", [typeorm_2.DataSource])
], GstService);
//# sourceMappingURL=gst.service.js.map