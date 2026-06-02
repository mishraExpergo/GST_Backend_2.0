import { RmqContext } from '@nestjs/microservices';
import { GstService } from './gst.service';
export declare class GstConsumer {
    private readonly gstService;
    private readonly logger;
    constructor(gstService: GstService);
    handleExcelImport(data: {
        jobId: string;
        filePath: string;
        tableName: string;
    }, context: RmqContext): Promise<void>;
    handleApiParent(data: {
        jobId: string;
        endpoint: string;
        totalRecords: number;
        tableName: string;
    }, context: RmqContext): Promise<void>;
    handleApiChunk(data: {
        taskId: string;
        jobId: string;
        endpoint: string;
        page: number;
        limit: number;
        tableName: string;
    }, context: RmqContext): Promise<void>;
}
