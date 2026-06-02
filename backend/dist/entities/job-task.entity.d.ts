import { Job } from './job.entity';
export type TaskStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export declare class JobTask {
    id: string;
    jobId: string;
    job: Job;
    status: TaskStatus;
    payload: Record<string, any>;
    attempts: number;
    errorMessage: string;
    createdAt: Date;
    updatedAt: Date;
}
