import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type ApiRequestStatus = 'PROCESSING' | 'SUCCESS' | 'FAILED';

@Entity('api_request_logs')
export class ApiRequestLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'gstr_family', type: 'text' })
  gstrFamily: string;

  @Column({ name: 'gstr_type', type: 'text' })
  gstrType: string;

  @Column({ name: 'api_name', type: 'text' })
  apiName: string;

  @Column({ name: 'retry_count', type: 'int', default: 0 })
  retryCount: number;

  @Column({ type: 'varchar', length: 32, default: 'PROCESSING' })
  status: ApiRequestStatus;

  @Column({ name: 'associated_loan_id', type: 'text', nullable: true })
  associatedLoanId: string | null;

  @Column({ name: 'customer_id', type: 'text', nullable: true })
  customerId: string | null;

  @Column({ name: 'gst_number', type: 'text', nullable: true })
  gstNumber: string | null;

  @Column({ name: 'data_source', type: 'text', nullable: true })
  dataSource: string | null;

  @Column({ name: 'response_status_code', type: 'int', nullable: true })
  responseStatusCode: number | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
