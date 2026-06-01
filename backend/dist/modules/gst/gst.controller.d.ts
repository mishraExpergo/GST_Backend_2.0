import { GstService } from './gst.service.js';
export declare class GstController {
    private readonly gstService;
    constructor(gstService: GstService);
    uploadExcel(file: Express.Multer.File, tableName: string): Promise<{
        message: string;
        table: string;
        sheet: string;
        tableCreated: boolean;
        columnsInserted: {
            raw: string;
            name: string;
            type: "INTEGER" | "NUMERIC" | "TIMESTAMP" | "BOOLEAN" | "TEXT";
        }[];
        addedColumns: {
            raw: string;
            name: string;
            type: "INTEGER" | "NUMERIC" | "TIMESTAMP" | "BOOLEAN" | "TEXT";
        }[];
        widenedColumns: {
            name: string;
            from: "INTEGER" | "NUMERIC" | "TIMESTAMP" | "BOOLEAN" | "TEXT";
            to: "INTEGER" | "NUMERIC" | "TIMESTAMP" | "BOOLEAN" | "TEXT";
        }[];
        rowsInserted: number;
    }>;
}
