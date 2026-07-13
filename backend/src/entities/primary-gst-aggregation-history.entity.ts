import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type AggregationChangeType = 'INSERT' | 'UPDATE' | 'DELETE';

@Entity('primary_gst_aggregation_history')
export class PrimaryGstAggregationHistory {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'aggregation_id', type: 'int', nullable: true })
  aggregationId: number | null;

  @Column({ name: 'customer_id', type: 'text', nullable: true })
  customerId: string | null;

  @Column({ name: 'associated_loan_id', type: 'text', nullable: true })
  associatedLoanId: string | null;

  @Column({ name: 'aggregation_variable', type: 'text', nullable: true })
  aggregationVariable: string | null;

  @Column({ name: 'previous_aggregation_variable', type: 'text', nullable: true })
  previousAggregationVariable: string | null;

  @Column({ name: 'change_type', type: 'varchar', length: 16 })
  changeType: AggregationChangeType;

  @Column({ name: 'change_source', type: 'text', nullable: true })
  changeSource: string | null;

  @CreateDateColumn({ name: 'recorded_at', type: 'timestamptz' })
  recordedAt: Date;
}
