import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { InjectDataSource } from '@nestjs/typeorm';
import { Connection } from 'mongoose';
import { DataSource } from 'typeorm';
import * as XLSX from 'xlsx';

type PgType = 'INTEGER' | 'NUMERIC' | 'TIMESTAMP' | 'BOOLEAN' | 'TEXT';

interface ColumnDef {
  raw: string;
  name: string;
  type: PgType;
}

export const GST_UPLOAD_TABLE = 'gst_uploaded_file_data';

export interface AggregationRow {
  outputField: string;
  output: string;
}

export interface GstrStatusCounts {
  updated: number;
  pending: number;
  failed: number;
}

export interface CustomerGstrStatusSummary {
  GSTR1: GstrStatusCounts;
  GSTR2B: GstrStatusCounts;
  GSTR3B: GstrStatusCounts;
}

@Injectable()
export class GstService {
  private readonly logger = new Logger(GstService.name);

  private readonly mongoConnection?: Connection;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Optional() @InjectConnection() mongoConnection?: Connection,
  ) {
    this.mongoConnection = mongoConnection;
  }

 

async getPublicComplianceData(loanId: string) {
  if (!this.mongoConnection) {
    throw new ServiceUnavailableException('MongoDB not configured.');
  }

  try {
    // Perform an aggregation to join history data
    const data = await this.mongoConnection
      .collection('gst_compliance_data') // Your primary collection
      .aggregate([
        { $match: { loanId } }, // Filter by loanId
        {
          // Normalize gstin (trim + uppercase) before joining. A plain $lookup does
          // an exact string match, and mismatched casing/whitespace between the two
          // collections causes filingHistory to silently come back empty for every row.
          $addFields: {
            _normalizedGstin: {
              $toUpper: {
                $trim: {
                  input: {
                    $ifNull: ['$gstin', ''],
                  },
                },
              },
            },
          },
        },
        {
          $lookup: {
            from: 'gst_return_filing_track', // The history collection
            let: { gstin: '$_normalizedGstin' },
            pipeline: [
              {
                $addFields: {
                  _normalizedGstin: {
                    $toUpper: {
                      $trim: {
                        input: { $ifNull: ['$gstin', ''] },
                      },
                    },
                  },
                },
              },
              {
                $match: {
                  $expr: { $eq: ['$_normalizedGstin', '$$gstin'] },
                },
              },
              { $project: { _normalizedGstin: 0 } },
            ],
            as: 'filingHistory', // Attached as a new field
          },
        },
        { $project: { _normalizedGstin: 0 } },
      ])
      .toArray();

    return {
      loanId,
      count: data.length,
      data,
    };
  } catch (err) {
    this.logger.error('Error fetching compliance data', err);
    throw new InternalServerErrorException('Error fetching data');
  }
}

async getPrimaryAggregation(loanId: string) {
  // Queries the primary_gst_aggregation table as required[cite: 2]
  const query = 'SELECT * FROM public.primary_gst_aggregation WHERE associated_loan_id = $1';
  const result = await this.dataSource.query(query, [loanId]);
  return result;
};

async getSecondaryAggregation(loanId: string) {
  // Queries the secondary_gst_aggregation table as required[cite: 2]
  const query = 'SELECT * FROM public.secondary_gst_aggregation WHERE associated_loan_id = $1';
  const result = await this.dataSource.query(query, [loanId]);
  // NOTE: dataSource.query() (TypeORM) already resolves to the row array
  // itself, not a `{ rows }` wrapper (that's the pg driver's shape). The
  // previous `return result.rows;` always returned undefined.
  return result;
};

/**
 * Backs GET /gst/api-request-logs?loanId=...
 *
 * Reads public.api_request_logs for the given loanId. Used to fill in the
 * "pending" fields on Operational Status (API Name, Data Source, Retry
 * Count, API Status) and to surface a "Last Updated" timestamp for the
 * Company Summary / Company Details views.
 *
 * The timestamp column is detected dynamically (falls back gracefully if
 * the table only has one of created_at/updated_at, or neither).
 */
async getApiRequestLogs(params: { loanId?: string; gstin?: string }) {
  const loanId = params.loanId?.trim();
  const gstin = params.gstin?.trim();

  if (!loanId && !gstin) {
    throw new BadRequestException('loanId or gstin is required.');
  }

  // Match on loanId OR gstin. Some api_request_logs rows have unreliable/
  // placeholder associated_loan_id values, but a correctly populated
  // gst_number — so filtering on loanId alone can silently miss real rows.
  const conditions: string[] = [];
  const values: string[] = [];

  if (loanId) {
    values.push(loanId);
    conditions.push(`TRIM(associated_loan_id) = TRIM($${values.length})`);
  }

  if (gstin) {
    values.push(gstin);
    conditions.push(`UPPER(TRIM(gst_number)) = UPPER(TRIM($${values.length}))`);
  }

  const timestampColumns = await this.dataSource.query<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'api_request_logs'
       AND column_name IN ('updated_at', 'created_at')`,
  );

  const availableColumns = new Set((timestampColumns ?? []).map((c) => c.column_name));
  const timestampColumn = availableColumns.has('updated_at')
    ? 'updated_at'
    : availableColumns.has('created_at')
    ? 'created_at'
    : null;

  const rows = await this.dataSource.query(
    `SELECT * FROM public.api_request_logs
     WHERE ${conditions.join(' OR ')}
     ${timestampColumn ? `ORDER BY "${timestampColumn}" DESC` : 'ORDER BY id DESC'}`,
    values,
  );

  const lastUpdatedAt =
    timestampColumn && rows?.length ? rows[0][timestampColumn] : null;

  return {
    loanId: loanId ?? null,
    gstin: gstin ?? null,
    count: rows?.length ?? 0,
    lastUpdatedAt,
    data: rows ?? [],
  };
}

/**
 * Backs GET /gst/customer-gstr-status-counts
 *
 * Aggregates api_request_logs per customer_id for GSTR-1, GSTR-2B, and GSTR-3B.
 * SUCCESS -> updated, FAILED -> failed, missing GSTIN row for a GSTR type -> pending.
 */
async getCustomerGstrStatusCounts(): Promise<Record<string, CustomerGstrStatusSummary>> {
  const timestampColumns = await this.dataSource.query<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'api_request_logs'
       AND column_name IN ('updated_at', 'created_at')`,
  );

  const availableColumns = new Set((timestampColumns ?? []).map((c) => c.column_name));
  const timestampColumn = availableColumns.has('updated_at')
    ? 'updated_at'
    : availableColumns.has('created_at')
    ? 'created_at'
    : 'id';

  const customerGstins = await this.dataSource.query<
    { customer_id: string; gst_number: string }[]
  >(
    `SELECT DISTINCT
       TRIM(customer_id) AS customer_id,
       UPPER(TRIM(gst_number)) AS gst_number
     FROM public.api_request_logs
     WHERE customer_id IS NOT NULL
       AND TRIM(customer_id) <> ''
       AND gst_number IS NOT NULL
       AND TRIM(gst_number) <> ''`,
  );

  const latestLogs = await this.dataSource.query<
    { customer_id: string; gst_number: string; gstr_type: string; status: string }[]
  >(
    `SELECT DISTINCT ON (
       TRIM(customer_id),
       UPPER(TRIM(gst_number)),
       gstr_type
     )
       TRIM(customer_id) AS customer_id,
       UPPER(TRIM(gst_number)) AS gst_number,
       gstr_type,
       UPPER(TRIM(status)) AS status
     FROM public.api_request_logs
     WHERE customer_id IS NOT NULL
       AND TRIM(customer_id) <> ''
       AND gst_number IS NOT NULL
       AND TRIM(gst_number) <> ''
       AND gstr_type IN ('GSTR-1', 'GSTR-2B', 'GSTR-3B')
     ORDER BY
       TRIM(customer_id),
       UPPER(TRIM(gst_number)),
       gstr_type,
       "${timestampColumn}" DESC NULLS LAST`,
  );

  const gstrTypeMap: Record<string, keyof CustomerGstrStatusSummary> = {
    'GSTR-1': 'GSTR1',
    'GSTR-2B': 'GSTR2B',
    'GSTR-3B': 'GSTR3B',
  };

  const createEmptyCounts = (): GstrStatusCounts => ({
    updated: 0,
    pending: 0,
    failed: 0,
  });

  const createEmptySummary = (): CustomerGstrStatusSummary => ({
    GSTR1: createEmptyCounts(),
    GSTR2B: createEmptyCounts(),
    GSTR3B: createEmptyCounts(),
  });

  const gstinsByCustomer = new Map<string, Set<string>>();
  for (const row of customerGstins ?? []) {
    if (!gstinsByCustomer.has(row.customer_id)) {
      gstinsByCustomer.set(row.customer_id, new Set());
    }
    gstinsByCustomer.get(row.customer_id)!.add(row.gst_number);
  }

  const statusByCustomerGstinType = new Map<string, string>();
  for (const row of latestLogs ?? []) {
    const summaryKey = gstrTypeMap[row.gstr_type];
    if (!summaryKey) continue;
    statusByCustomerGstinType.set(
      `${row.customer_id}|${row.gst_number}|${summaryKey}`,
      row.status,
    );
  }

  const result: Record<string, CustomerGstrStatusSummary> = {};

  for (const [customerId, gstins] of gstinsByCustomer) {
    const summary = createEmptySummary();

    for (const gstrKey of ['GSTR1', 'GSTR2B', 'GSTR3B'] as const) {
      for (const gstNumber of gstins) {
        const status = statusByCustomerGstinType.get(
          `${customerId}|${gstNumber}|${gstrKey}`,
        );

        if (!status) {
          summary[gstrKey].pending += 1;
        } else if (status === 'SUCCESS') {
          summary[gstrKey].updated += 1;
        } else if (status === 'FAILED') {
          summary[gstrKey].failed += 1;
        } else {
          summary[gstrKey].pending += 1;
        }
      }
    }

    result[customerId] = summary;
  }

  return result;
}

/**  
 * Builds the "Aggregation Table" shown when a user clicks the info (i)
 * icon next to a loan's Associated Loan ID. Combines the primary
 * company's aggregation row with every considered/secondary entity's
 * aggregation row for that loan, and flattens each into
 * { outputField, output } pairs for a simple two-column table.
 */
async getAggregationTable(
  loanId: string, 
  type: 'primary' | 'secondary' = 'primary'
): Promise<{ rows: AggregationRow[]; debug: Record<string, unknown> }> {
  const trimmedLoanId = loanId?.trim();
  
  if (!trimmedLoanId) {
    throw new BadRequestException('loanId is required.');
  } 

  const debug: Record<string, unknown> = {
    receivedLoanId: trimmedLoanId,
    requestedType: type,
  };

  let rows: any[] = [];

  // 1. Query the explicit table requested by the frontend
  if (type === 'primary') {
    rows = await this.dataSource.query(
      'SELECT * FROM public.primary_gst_aggregation WHERE TRIM(associated_loan_id) = TRIM($1)',
      [trimmedLoanId],
    );
    debug.source = 'primary_gst_aggregation';
  } else {
    rows = await this.dataSource.query(
      'SELECT * FROM public.secondary_gst_aggregation WHERE TRIM(associated_loan_id) = TRIM($1)',
      [trimmedLoanId],
    );
    debug.source = 'secondary_gst_aggregation';
  }

  debug.rowCount = rows?.length ?? 0;

  const result: AggregationRow[] = [];
  const hasMultipleRows = (rows ?? []).length > 1;

  // 2. Parse and format the data using your existing helper methods
  for (const row of (rows ?? [])) {
    // Uses your existing parseAggregationVariable method
    const parsed = this.parseAggregationVariable(row.aggregation_variable); 
    
    for (const [key, value] of Object.entries(parsed)) {
      // Keep your logic to disambiguate multiple secondary entities using customer_id
      const outputField = (type === 'secondary' && hasMultipleRows && row.customer_id) 
        ? `${key} (${row.customer_id})` 
        : key;
        
      result.push({ 
        outputField, 
        output: this.formatOutputValue(value) // Uses your existing formatOutputValue method
      });
    }
  }

  debug.parsedEntryCount = result.length;
  
  return { rows: result, debug };
}

private formatOutputValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * The `aggregation_variable` column stores a Python-dict-style string, e.g.
 * "{'PRIMARY_TOTAL_GST_COUNT':0,'PRIMARY_ADDRESS_CHANGE':false}" — single
 * quotes instead of double quotes, which makes it invalid JSON as-is.
 * Convert it to valid JSON and parse properly (handles nested
 * objects/arrays correctly, unlike a naive regex would).
 */
private parseAggregationVariable(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};

  if (typeof raw === 'object') {
    // Already parsed (e.g. if the column type is json/jsonb instead of text).
    return raw as Record<string, unknown>;
  }

  const str = String(raw).trim();
  if (!str || str === '{}') return {};

  // Convert Python-dict-literal syntax to valid JSON:
  // single quotes -> double quotes, None/True/False -> null/true/false.
  // This is a best-effort textual conversion (it does not attempt to
  // preserve apostrophes inside string values); it works for this
  // pipeline's generated data, which never contains embedded quotes.
  const jsonLike = str
    .replace(/'/g, '"')
    .replace(/\bNone\b/g, 'null')
    .replace(/\bTrue\b/g, 'true')
    .replace(/\bFalse\b/g, 'false');

  try {
    const parsed = JSON.parse(jsonLike);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch (err) {
    this.logger.warn(
      `Failed to parse aggregation_variable as JSON. Raw (first 200 chars): ${str.slice(0, 200)}`,
    );
    return {};
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

  // TEMP DEBUG — remove once the empty-result issue is resolved.
  getDebugConnectionInfo() {
    const opts = this.dataSource.options as any;
    return {
      type: opts.type,
      database: opts.database,
      host: opts.host,
      port: opts.port,
      schema: opts.schema ?? 'public',
    };
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