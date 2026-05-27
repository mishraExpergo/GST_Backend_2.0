import { GstService } from './gst.service.js';
export declare class GstController {
    private readonly gstService;
    constructor(gstService: GstService);
    uploadExcel(file: Express.Multer.File, tableName: string): Promise<{
        message: string;
        table: string;
        sheet: string;
        columns: {
            raw: string;
            name: string;
            type: "INTEGER" | "NUMERIC" | "TIMESTAMP" | "BOOLEAN" | "TEXT";
        }[];
        rowsInserted: number;
    }>;
}
