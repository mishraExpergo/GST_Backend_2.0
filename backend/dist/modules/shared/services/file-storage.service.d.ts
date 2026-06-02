import { OnModuleInit } from '@nestjs/common';
export declare class FileStorageService implements OnModuleInit {
    private readonly logger;
    private readonly tempDir;
    onModuleInit(): void;
    saveBuffer(buffer: Buffer, originalName: string): Promise<string>;
    deleteFile(filePath: string): Promise<void>;
    private ensureDirectoryExists;
}
