import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { InjectConnection } from '@nestjs/mongoose';
import { DataSource } from 'typeorm';
import { Connection } from 'mongoose';
import * as XLSX from 'xlsx';  

type PgType = 'INTEGER' | 'NUMERIC' | 'TIMESTAMP' | 'BOOLEAN' | 'TEXT';

interface ColumnDef {
  raw: string;
  name: string;
  type: PgType;
}

export const GST_UPLOAD_TABLE = 'gst_uploaded_file_data';

@Injectable()
export class GstService {
  private readonly logger = new Logger(GstService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Optional()
    @InjectConnection()
    private readonly mongoConnection?: Connection,
  ) {}

  async getPublicComplianceData(
    page = 1,
    limit = 50,
    companyId?: string,
    gstin?: string,
  ) {
    if (!this.mongoConnection || this.mongoConnection.readyState !== 1) {
      throw new ServiceUnavailableException(
        'MongoDB connection is not available. Set ENABLE_MONGO=true and configure MONGO_URI.',
      );
    }

    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), 200);
    const skip = (safePage - 1) * safeLimit;
    const collection = this.mongoConnection.collection('gst_compliance_data');

    // Treat records as public by default when visibility flags are missing.
    // This avoids returning blank data for legacy records that don't store these flags.
    const visibilityFilter = {
      $or: [
        { isPublic: true },
        { public: true },
        { visibility: /^public$/i },
        { access: /^public$/i },
        {
          $and: [
            { isPublic: { $exists: false } },
            { public: { $exists: false } },
            { visibility: { $exists: false } },
            { access: { $exists: false } },
          ],
        },
      ],
    };

    const scopedFilters: Record<string, unknown>[] = [];
    const trimmedCompanyId = companyId?.trim();
    const trimmedGstin = gstin?.trim();

    if (trimmedCompanyId) {
      scopedFilters.push(
        { companyId: trimmedCompanyId },
        { company_id: trimmedCompanyId },
        { company: trimmedCompanyId },
      );
    }

    if (trimmedGstin) {
      const normalizedGstin = trimmedGstin.toUpperCase();
      const escapedNormalizedGstin = normalizedGstin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      scopedFilters.push(
        { gstin: normalizedGstin },
        { gstin: trimmedGstin },
        { gstin: normalizedGstin.toLowerCase() },
        { gstin: { $regex: `^${escapedNormalizedGstin}$`, $options: 'i' } },
        { gstinNo: normalizedGstin },
        { gstinNo: { $regex: `^${escapedNormalizedGstin}$`, $options: 'i' } },
        { gstin_no: normalizedGstin },
        { gstin_no: { $regex: `^${escapedNormalizedGstin}$`, $options: 'i' } },
        { gstinNumber: normalizedGstin },
        { gstinNumber: { $regex: `^${escapedNormalizedGstin}$`, $options: 'i' } },
        { GSTIN: normalizedGstin },
        { GSTIN: { $regex: `^${escapedNormalizedGstin}$`, $options: 'i' } },
        { 'verifyresponse.data.data.gstin': normalizedGstin },
        {
          'verifyresponse.data.data.gstin': {
            $regex: `^${escapedNormalizedGstin}$`,
            $options: 'i',
          },
        },
      );
    }

    const filter =
      scopedFilters.length > 0
        ? {
            $and: [visibilityFilter, { $or: scopedFilters }],
          }
        : visibilityFilter;

    const projection = {
      __v: 0,
      password: 0,
      token: 0,
      refreshToken: 0,
      accessToken: 0,
      apiKey: 0,
      secret: 0,
    };

    try {
      const [total, docs] = await Promise.all([
        collection.countDocuments(filter),
        collection
          .find(filter, { projection })
          .sort({ updatedAt: -1, _id: -1 })
          .skip(skip)
          .limit(safeLimit)
          .toArray(),
      ]);

      const data = docs.map((doc) => {
        const { _id, ...rest } = doc as Record<string, unknown> & { _id?: unknown };
        return {
          id: _id ? String(_id) : undefined,
          ...rest,
        };
      });

      return {
        collection: 'gst_compliance_data',
        total,
        page: safePage,
        limit: safeLimit,
        data,
      };
    } catch (err) {
      this.logger.error(
        'Failed to fetch public data from "gst_compliance_data"',
        err as Error,
      );
      throw new InternalServerErrorException(
        `Failed to fetch MongoDB data: ${(err as Error).message}`,
      );
    }
  }

  async getTableData(rawTableName: string, page = 1, limit = 50) {
    const tableName = this.sanitizeIdentifier(rawTableName);
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), 500);
    const offset = (safePage - 1) * safeLimit;

    const exists = await this.dataSource.query<{ exists: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = $1
       ) AS "exists"`,
      [tableName],
    );

    if (!exists[0]?.exists) {
      return {
        table: tableName,
        total: 0,
        page: safePage,
        limit: safeLimit,
        data: [],
      };
    }

    try {
      const countResult = await this.dataSource.query<{ total: number }[]>(
        `SELECT COUNT(*)::int AS total FROM "${tableName}"`,
      );
      const total = countResult[0]?.total ?? 0;

      const rows = await this.dataSource.query(
        `SELECT * FROM "${tableName}" ORDER BY id ASC LIMIT $1 OFFSET $2`,
        [safeLimit, offset],
      );

      return {
        table: tableName,
        total,
        page: safePage,
        limit: safeLimit,
        data: rows,
      };
    } catch (err) {
      this.logger.error(`Failed to fetch data from "${tableName}"`, err as Error);
      throw new InternalServerErrorException(
        `Failed to fetch data: ${(err as Error).message}`,
      );
    }
  }

  async processExcel(buffer: Buffer, rawTableName: string) {
    const tableName = this.sanitizeIdentifier(rawTableName);

    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new BadRequestException('Excel file contains no sheets.');
    }
    const sheet = workbook.Sheets[sheetName];

    const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, {
      defval: null,
      raw: true,
    });

    if (rows.length === 0) {
      throw new BadRequestException(
        'Excel sheet is empty. Need at least one data row.',
      );
    }

    const headerSet = new Set<string>();
    for (const row of rows) {
      Object.keys(row).forEach((k) => headerSet.add(k));
    }
    const rawHeaders = Array.from(headerSet);
    if (rawHeaders.length === 0) {
      throw new BadRequestException('No columns detected in the Excel sheet.');
    }

    const columns: ColumnDef[] = rawHeaders.map((header) => ({
      raw: header,
      name: this.sanitizeIdentifier(header),
      type: this.inferColumnType(rows, header),
    }));

    const seen = new Set<string>();
    for (const col of columns) {
      if (seen.has(col.name)) {
        throw new BadRequestException(
          `Duplicate column name "${col.name}" after sanitization. Rename headers in Excel.`,
        );
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
        const params: unknown[] = [];
        const valueRows: string[] = [];

        for (const row of batch) {
          const rowPlaceholders: string[] = [];
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
        message: 'Excel uploaded successfully. Dashboard data has been updated.',
        table: tableName,
        sheet: sheetName,
        columns: columns.map(({ raw, name, type }) => ({ raw, name, type })),
        rowsInserted: inserted,
      };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Failed to process Excel', err as Error);
      throw new InternalServerErrorException(
        `Failed to process Excel: ${(err as Error).message}`,
      );
    } finally {
      await queryRunner.release();
    }
  }

  private sanitizeIdentifier(name: string): string {
    const cleaned = String(name ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '');

    if (!cleaned) {
      throw new BadRequestException(`Invalid identifier: "${name}"`);
    }
    const safe = /^\d/.test(cleaned) ? `_${cleaned}` : cleaned;
    return safe.slice(0, 63);
  }

  private inferColumnType(
    rows: Record<string, unknown>[],
    header: string,
  ): PgType {
    let allInt = true;
    let allNumber = true;
    let allDate = true;
    let allBool = true;
    let hasValue = false;

    for (const row of rows) {
      const v = row[header];
      if (v === null || v === undefined || v === '') continue;
      hasValue = true;

      if (typeof v !== 'boolean') allBool = false;

      if (typeof v === 'number' && Number.isFinite(v)) {
        if (!Number.isInteger(v)) allInt = false;
      } else {
        allInt = false;
        allNumber = false;
      }

      if (!(v instanceof Date)) {
        allDate = false;
      }
    }

    if (!hasValue) return 'TEXT';
    if (allBool) return 'BOOLEAN';
    if (allInt) return 'INTEGER';
    if (allNumber) return 'NUMERIC';
    if (allDate) return 'TIMESTAMP';
    return 'TEXT';
  }

  private coerceValue(value: unknown, type: PgType): unknown {
    if (value === null || value === undefined || value === '') return null;

    switch (type) {
      case 'INTEGER':
      case 'NUMERIC': {
        const n = typeof value === 'number' ? value : Number(value);
        return Number.isFinite(n) ? n : null;
      }
      case 'TIMESTAMP': {
        if (value instanceof Date) return value.toISOString();
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

  private buildCreateTableSql(
    tableName: string,
    columns: ColumnDef[],
  ): string {
    const cols = columns
      .map((c) => `"${c.name}" ${c.type} NULL`)
      .join(', ');
    return `CREATE TABLE "${tableName}" (id SERIAL PRIMARY KEY, ${cols})`;
  }
}
