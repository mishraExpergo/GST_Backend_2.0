import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type DbQueryEngine = 'postgres' | 'mongo';
export type DbQuerySource =
  | 'http'
  | 'job'
  | 'scheduler'
  | 'startup'
  | 'unknown';

@Entity('db_query_logs')
@Index('idx_db_query_logs_created_at', ['createdAt'])
@Index('idx_db_query_logs_request_id', ['requestId'])
@Index('idx_db_query_logs_job_id', ['jobId'])
@Index('idx_db_query_logs_gstin', ['gstin'])
export class DbQueryLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'db_engine', type: 'varchar', length: 16 })
  dbEngine: DbQueryEngine;

  @Column({ type: 'varchar', length: 64, nullable: true })
  operation: string | null;

  @Column({ type: 'text' })
  statement: string;

  @Column({
    name: 'collection_or_table',
    type: 'varchar',
    length: 256,
    nullable: true,
  })
  collectionOrTable: string | null;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs: number | null;

  @Column({ type: 'boolean', default: true })
  success: boolean;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ name: 'request_id', type: 'varchar', length: 64, nullable: true })
  requestId: string | null;

  @Column({ name: 'job_id', type: 'varchar', length: 64, nullable: true })
  jobId: string | null;

  @Column({ name: 'trace_id', type: 'varchar', length: 64, nullable: true })
  traceId: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  source: DbQuerySource | string | null;

  @Column({ name: 'user_id', type: 'text', nullable: true })
  userId: string | null;

  @Column({ name: 'customer_id', type: 'text', nullable: true })
  customerId: string | null;

  @Column({ name: 'loan_id', type: 'text', nullable: true })
  loanId: string | null;

  @Column({ type: 'text', nullable: true })
  gstin: string | null;

  @Column({ type: 'jsonb', nullable: true })
  parameters: Record<string, unknown> | unknown[] | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
