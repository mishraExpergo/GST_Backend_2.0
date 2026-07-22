import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Ensures jobs / job_tasks / aggregation tables exist when POSTGRES_SYNC=false.
 */
@Injectable()
export class SchemaBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(SchemaBootstrapService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureCoreTables();
      this.logger.log(
        'Postgres core schema verified (jobs, aggregation, api_request_logs).',
      );
    } catch (err) {
      this.logger.error(
        `Schema bootstrap failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }
  }

  private async ensureCoreTables(): Promise<void> {
    await this.dataSource.query(`
      DO $$ BEGIN
        CREATE TYPE jobs_type_enum AS ENUM ('EXCEL', 'API');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await this.dataSource.query(`
      DO $$ BEGIN
        CREATE TYPE jobs_status_enum AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await this.dataSource.query(`
      DO $$ BEGIN
        CREATE TYPE job_tasks_status_enum AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        type jobs_type_enum NOT NULL,
        status jobs_status_enum NOT NULL DEFAULT 'PENDING',
        metadata jsonb NULL,
        "totalChunks" int NOT NULL DEFAULT 0,
        "completedChunks" int NOT NULL DEFAULT 0,
        "errorMessage" text NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS job_tasks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        status job_tasks_status_enum NOT NULL DEFAULT 'PENDING',
        payload jsonb NULL,
        attempts int NOT NULL DEFAULT 0,
        "errorMessage" text NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS primary_gst_aggregation (
        id SERIAL PRIMARY KEY,
        customer_id text NULL,
        associated_loan_id text NULL,
        aggregation_variable text NULL
      )
    `);

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS secondary_gst_aggregation (
        id SERIAL PRIMARY KEY,
        customer_id text NULL,
        associated_loan_id text NULL,
        aggregation_variable text NULL
      )
    `);

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS api_request_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        gstr_family text NOT NULL,
        gstr_type text NOT NULL,
        api_name text NOT NULL,
        retry_count int NOT NULL DEFAULT 0,
        status character varying(32) NOT NULL DEFAULT 'PENDING',
        associated_loan_id text NULL,
        customer_id text NULL,
        gst_number text NULL,
        data_source text NULL,
        response_status_code int NULL,
        error_message text NULL,
        metadata jsonb NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  }
}
