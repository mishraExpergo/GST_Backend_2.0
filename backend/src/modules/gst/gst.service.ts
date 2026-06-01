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

  async processUpload(
    buffer: Buffer,
    originalName: string | undefined,
    mimetype: string | undefined,
    rawTableName: string,
  ) {
    const tableName = this.sanitizeIdentifier(rawTableName);
    const isCsv = this.isCsvFile(originalName, mimetype);

    // 1. Parse the Excel / CSV file
    const workbook = isCsv
      ? XLSX.read(buffer.toString('utf8'), { type: 'string', cellDates: true })
      : XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new BadRequestException('Uploaded file contains no sheets.');
    }
    const sheet = workbook.Sheets[sheetName];

    // For CSV, every cell is a string by default; use raw:false so xlsx
    // coerces numbers/dates. For Excel, raw:true preserves native cell types.
    const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, {
      defval: null,
      raw: !isCsv,
    });

    if (rows.length === 0) {
      throw new BadRequestException(
        'Uploaded sheet is empty. Need at least one data row.',
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

    // 4. Create table if missing, then insert (always append) inside a transaction
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let tableCreated = false;
    const addedColumns: ColumnDef[] = [];
    const widenedColumns: Array<{
      name: string;
      from: PgType;
      to: PgType;
    }> = [];
    // Final type each column should be coerced into for the INSERT.
    const insertColumns: ColumnDef[] = columns.map((c) => ({ ...c }));

    try {
      const tableExists = await this.tableExists(queryRunner, tableName);

      if (!tableExists) {
        const createSql = this.buildCreateTableSql(tableName, columns);
        this.logger.log(`Creating table: ${createSql}`);
        await queryRunner.query(createSql);
        tableCreated = true;
      } else {
        const existingCols = await this.getExistingColumnTypes(
          queryRunner,
          tableName,
        );

        for (const col of insertColumns) {
          const existingType = existingCols.get(col.name);

          if (existingType === undefined) {
            const alterSql = `ALTER TABLE "${tableName}" ADD COLUMN "${col.name}" ${col.type} NULL`;
            this.logger.log(`Adding column: ${alterSql}`);
            await queryRunner.query(alterSql);
            addedColumns.push({ ...col });
            continue;
          }

          const mergedType = this.mergeType(existingType, col.type);
          if (mergedType !== existingType) {
            const alterSql = `ALTER TABLE "${tableName}" ALTER COLUMN "${col.name}" TYPE ${mergedType} USING "${col.name}"::${this.pgCastTarget(mergedType)}`;
            this.logger.log(`Widening column: ${alterSql}`);
            await queryRunner.query(alterSql);
            widenedColumns.push({
              name: col.name,
              from: existingType,
              to: mergedType,
            });
          }
          col.type = mergedType;
        }
      }

      const colList = insertColumns.map((c) => `"${c.name}"`).join(', ');
      const batchSize = 500;
      let inserted = 0;

      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const params: unknown[] = [];
        const valueRows: string[] = [];

        for (const row of batch) {
          const rowPlaceholders: string[] = [];
          for (const col of insertColumns) {
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
        message: tableCreated
          ? 'Table created and rows inserted successfully.'
          : addedColumns.length > 0 || widenedColumns.length > 0
            ? 'Schema updated and rows appended successfully.'
            : 'Rows appended to existing table successfully.',
        table: tableName,
        sheet: sheetName,
        tableCreated,
        columnsInserted: insertColumns.map(({ raw, name, type }) => ({
          raw,
          name,
          type,
        })),
        addedColumns: addedColumns.map(({ raw, name, type }) => ({
          raw,
          name,
          type,
        })),
        widenedColumns,
        rowsInserted: inserted,
      };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Failed to process Excel', err as Error);
      if (err instanceof BadRequestException) throw err;
      throw new InternalServerErrorException(
        `Failed to process Excel: ${(err as Error).message}`,
      );
    } finally {
      await queryRunner.release();
    }
  }

  private async tableExists(
    queryRunner: import('typeorm').QueryRunner,
    tableName: string,
  ): Promise<boolean> {
    const result: Array<{ exists: boolean }> = await queryRunner.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = current_schema() AND table_name = $1
       ) AS "exists"`,
      [tableName],
    );
    return Boolean(result?.[0]?.exists);
  }

  private async getExistingColumnTypes(
    queryRunner: import('typeorm').QueryRunner,
    tableName: string,
  ): Promise<Map<string, PgType>> {
    const rows: Array<{ column_name: string; data_type: string }> =
      await queryRunner.query(
        `SELECT column_name, data_type FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = $1`,
        [tableName],
      );
    const map = new Map<string, PgType>();
    for (const r of rows) {
      map.set(r.column_name, this.mapPgDataType(r.data_type));
    }
    return map;
  }

  private mapPgDataType(dataType: string): PgType {
    const t = dataType.toLowerCase();
    if (
      t === 'integer' ||
      t === 'smallint' ||
      t === 'bigint' ||
      t === 'serial' ||
      t === 'bigserial'
    )
      return 'INTEGER';
    if (
      t === 'numeric' ||
      t === 'decimal' ||
      t === 'real' ||
      t === 'double precision'
    )
      return 'NUMERIC';
    if (t.startsWith('timestamp') || t === 'date') return 'TIMESTAMP';
    if (t === 'boolean') return 'BOOLEAN';
    return 'TEXT';
  }

  /**
   * Decide the narrowest Postgres type that can hold values of BOTH `a` and `b`.
   * Only INTEGER -> NUMERIC widens within numerics; everything else falls back to TEXT.
   */
  private mergeType(a: PgType, b: PgType): PgType {
    if (a === b) return a;
    if (
      (a === 'INTEGER' && b === 'NUMERIC') ||
      (a === 'NUMERIC' && b === 'INTEGER')
    )
      return 'NUMERIC';
    return 'TEXT';
  }

  private pgCastTarget(type: PgType): string {
    switch (type) {
      case 'INTEGER':
        return 'integer';
      case 'NUMERIC':
        return 'numeric';
      case 'TIMESTAMP':
        return 'timestamp';
      case 'BOOLEAN':
        return 'boolean';
      case 'TEXT':
      default:
        return 'text';
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

      // boolean check (handle real booleans and "true"/"false" strings from CSV)
      const boolStr =
        typeof v === 'string' && ['true', 'false'].includes(v.toLowerCase());
      if (typeof v !== 'boolean' && !boolStr) allBool = false;

      // number check (native number or numeric-looking string from CSV)
      let asNumber: number | null = null;
      if (typeof v === 'number' && Number.isFinite(v)) {
        asNumber = v;
      } else if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v);
        if (Number.isFinite(n)) asNumber = n;
      }
      if (asNumber === null) {
        allInt = false;
        allNumber = false;
      } else if (!Number.isInteger(asNumber)) {
        allInt = false;
      }

      // date check (Date instance or parseable date string from CSV)
      if (v instanceof Date) {
        // ok
      } else if (typeof v === 'string') {
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) allDate = false;
      } else {
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

  private isCsvFile(
    originalName: string | undefined,
    mimetype: string | undefined,
  ): boolean {
    const ext = (originalName || '').toLowerCase().split('.').pop();
    if (ext === 'csv') return true;
    const csvMimes = ['text/csv', 'application/csv'];
    return !!mimetype && csvMimes.includes(mimetype);
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
      case 'BOOLEAN': {
        if (typeof value === 'boolean') return value;
        const s = String(value).trim().toLowerCase();
        if (['true', '1', 'yes', 'y'].includes(s)) return true;
        if (['false', '0', 'no', 'n'].includes(s)) return false;
        return Boolean(value);
      }
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
