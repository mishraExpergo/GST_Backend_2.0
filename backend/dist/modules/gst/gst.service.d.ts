import { DataSource, Repository } from 'typeorm';
import { ClientProxy } from '@nestjs/microservices';
import { Job, JobStatus, JobType } from '../../entities/job.entity';
import { JobTask } from '../../entities/job-task.entity';
import { FileStorageService } from '../shared/services/file-storage.service';
export declare class GstService {
    private readonly dataSource;
    private readonly jobRepo;
    private readonly taskRepo;
    private readonly fileStorageService;
    private readonly apiChunkClient?;
    private readonly logger;
    constructor(dataSource: DataSource, jobRepo: Repository<Job>, taskRepo: Repository<JobTask>, fileStorageService: FileStorageService, apiChunkClient?: ClientProxy | undefined);
    createJob(type: JobType, metadata: Record<string, any>): Promise<Job>;
    getJobStatus(jobId: string): Promise<Job | null>;
    updateJobStatus(jobId: string, status: JobStatus, errorMessage?: string): Promise<void>;
    processExcel(filePath: string, rawTableName: string, jobId: string): Promise<void>;
    processApiParent(jobId: string, endpoint: string, totalRecords: number, rawTableName: string): Promise<void>;
    processApiChunk(taskId: string, jobId: string, endpoint: string, page: number, limit: number, tableName: string): Promise<void>;
    private getMockSampleRecord;
    private fetchMockApiPage;
    private sanitizeIdentifier;
    private inferColumnType;
    private coerceValue;
    private buildCreateTableSql;
}
