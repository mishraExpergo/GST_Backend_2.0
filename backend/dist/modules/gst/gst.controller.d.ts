import { ClientProxy } from '@nestjs/microservices';
import { GstService } from './gst.service';
import { FileStorageService } from '../shared/services/file-storage.service';
export declare class GstController {
    private readonly gstService;
    private readonly fileStorageService;
    private readonly excelClient?;
    private readonly apiParentClient?;
    constructor(gstService: GstService, fileStorageService: FileStorageService, excelClient?: ClientProxy | undefined, apiParentClient?: ClientProxy | undefined);
    uploadExcel(file: Express.Multer.File, tableName: string): Promise<{
        message: string;
        jobId: string;
        status: import("../../entities/job.entity").JobStatus;
        checkStatusUrl: string;
    }>;
    triggerApiIngest(endpoint: string, totalRecords: number, tableName: string): Promise<{
        message: string;
        jobId: string;
        status: import("../../entities/job.entity").JobStatus;
        checkStatusUrl: string;
    }>;
    getStatus(jobId: string): Promise<{
        id: string;
        type: import("../../entities/job.entity").JobType;
        status: import("../../entities/job.entity").JobStatus;
        totalChunks: number;
        completedChunks: number;
        progressPercentage: string;
        errorMessage: string;
        metadata: Record<string, any>;
        createdAt: Date;
        updatedAt: Date;
    }>;
}
