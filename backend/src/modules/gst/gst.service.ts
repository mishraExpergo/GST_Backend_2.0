import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as XLSX from 'xlsx';

type PgType = 'INTEGER' | 'NUMERIC' | 'TIMESTAMP' | 'BOOLEAN' | 'TEXT';

interface ColumnDef {
  raw: string;
  name: string;
  type: PgType;
}

@Injectable()
export class GstService {
  private readonly logger = new Logger(GstService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async processExcel(buffer: Buffer, rawTableName: string) {
    const tableName = this.sanitizeIdentifier(rawTableName);

    // 1. Parse the Excel file
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

    // 2. Collect headers from union of all row keys (handles sparse rows)
    const headerSet = new Set<string>();
    for (const row of rows) {
      Object.keys(row).forEach((k) => headerSet.add(k));
    }
    const rawHeaders = Array.from(headerSet);
    if (rawHeaders.length === 0) {
      throw new BadRequestException('No columns detected in the Excel sheet.');
    }

    // 3. Build column defs with sanitized names + inferred types
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

    // 4. Create table + insert rows in a single transaction
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
        message: 'Excel uploaded and table created successfully.',
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

  // ----------------------- helpers -----------------------

  private sanitizeIdentifier(name: string): string {
    const cleaned = String(name ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '');

    if (!cleaned) {
      throw new BadRequestException(`Invalid identifier: "${name}"`);
    }
    // Postgres identifiers can't start with a digit (unquoted), but we quote
    // everything anyway. Still, prefix with underscore for safety.
    const safe = /^\d/.test(cleaned) ? `_${cleaned}` : cleaned;
    // Postgres identifier limit is 63 chars
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

      // boolean check
      if (typeof v !== 'boolean') allBool = false;

      // number check
      if (typeof v === 'number' && Number.isFinite(v)) {
        if (!Number.isInteger(v)) allInt = false;
      } else {
        allInt = false;
        allNumber = false;
      }

      // date check
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
