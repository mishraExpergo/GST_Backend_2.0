import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class FileStorageService implements OnModuleInit {
  private readonly logger = new Logger(FileStorageService.name);
  private readonly tempDir = path.join(process.cwd(), 'temp-uploads');

  onModuleInit() {
    this.ensureDirectoryExists(this.tempDir);
  }

  /**
   * Writes file buffer to temporary directory and returns absolute path.
   */
  async saveBuffer(buffer: Buffer, originalName: string): Promise<string> {
    const ext = path.extname(originalName) || '.xlsx';
    const filename = `${uuidv4()}${ext}`;
    const fullPath = path.join(this.tempDir, filename);

    this.ensureDirectoryExists(this.tempDir);
    await fs.promises.writeFile(fullPath, buffer);
    this.logger.log(`Temporary file saved at: ${fullPath}`);
    return fullPath;
  }

  /**
   * Safely deletes file if it exists.
   */
  async deleteFile(filePath: string): Promise<void> {
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        this.logger.log(`Temporary file deleted: ${filePath}`);
      }
    } catch (err) {
      this.logger.error(
        `Failed to delete temporary file ${filePath}: ${(err as Error).message}`,
      );
    }
  }

  private ensureDirectoryExists(dir: string) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      this.logger.log(`Created directory: ${dir}`);
    }
  }
}
