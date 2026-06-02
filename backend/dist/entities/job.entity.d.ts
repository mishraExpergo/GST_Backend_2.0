import { JobTask } from './job-task.entity';
export type JobType = 'EXCEL' | 'API';
export type JobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export declare class Job {
    id: string;
    type: JobType;
    status: JobStatus;
    metadata: Record<string, any>;
    totalChunks: number;
    completedChunks: number;
    errorMessage: string;
    createdAt: Date;
    updatedAt: Date;
    tasks: JobTask[];
}
