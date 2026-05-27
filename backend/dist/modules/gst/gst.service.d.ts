import { DataSource } from 'typeorm';
type PgType = 'INTEGER' | 'NUMERIC' | 'TIMESTAMP' | 'BOOLEAN' | 'TEXT';
export declare class GstService {
    private readonly dataSource;
    private readonly logger;
    constructor(dataSource: DataSource);
    processExcel(buffer: Buffer, rawTableName: string): Promise<{
        message: string;
        table: string;
        sheet: string;
        columns: {
            raw: string;
            name: string;
            type: PgType;
        }[];
        rowsInserted: number;
    }>;
    private sanitizeIdentifier;
    private inferColumnType;
    private coerceValue;
    private buildCreateTableSql;
}
export {};
