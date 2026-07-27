-- Manual Postgres bootstrap when POSTGRES_SYNC=false (Postgres 13+).
-- App also runs SchemaBootstrapService on startup for jobs/aggregation.

DO $$ BEGIN
  CREATE TYPE jobs_type_enum AS ENUM ('EXCEL', 'API');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE jobs_status_enum AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE job_tasks_status_enum AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

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
);

CREATE TABLE IF NOT EXISTS job_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  status job_tasks_status_enum NOT NULL DEFAULT 'PENDING',
  payload jsonb NULL,
  attempts int NOT NULL DEFAULT 0,
  "errorMessage" text NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS primary_gst_aggregation (
  id SERIAL PRIMARY KEY,
  customer_id text NULL,
  associated_loan_id text NULL,
  aggregation_variable text NULL
);

CREATE TABLE IF NOT EXISTS secondary_gst_aggregation (
  id SERIAL PRIMARY KEY,
  customer_id text NULL,
  associated_loan_id text NULL,
  aggregation_variable text NULL
);

CREATE TABLE IF NOT EXISTS gst_uploaded_file_data (
  id SERIAL PRIMARY KEY,
  customer_id text NULL,
  associated_loan_id text NULL,
  primary_pan text NULL,
  primary_gst_no text NULL,
  considered_entity_gst_no text NULL,
  username text NULL,
  status text NULL,
  last_data_pull_date timestamptz NULL
);
