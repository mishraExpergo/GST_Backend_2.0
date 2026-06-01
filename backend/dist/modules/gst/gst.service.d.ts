import { DataSource } from 'typeorm';
type PgType = 'INTEGER' | 'NUMERIC' | 'TIMESTAMP' | 'BOOLEAN' | 'TEXT';
export declare class GstService {
    private readonly dataSource;
    private readonly logger;
    constructor(dataSource: DataSource);
    processUpload(buffer: Buffer, originalName: string | undefined, mimetype: string | undefined, rawTableName: string): Promise<{
        message: string;
        table: string;
        sheet: string;
        tableCreated: boolean;
        columnsInserted: {
            raw: string;
            name: string;
            type: PgType;
        }[];
        addedColumns: {
            raw: string;
            name: string;
            type: PgType;
        }[];
        widenedColumns: {
            name: string;
            from: PgType;
            to: PgType;
        }[];
        rowsInserted: number;
    }>;
    private tableExists;
    private getExistingColumnTypes;
    private mapPgDataType;
    private mergeType;
    private pgCastTarget;
    private sanitizeIdentifier;
    private inferColumnType;
    private isCsvFile;
    private coerceValue;
    private buildCreateTableSql;
}
export {};
