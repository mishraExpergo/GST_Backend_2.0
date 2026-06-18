import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('primary_gst_aggregation')
export class PrimaryGstAggregation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'customer_id', type: 'text', nullable: true })
  customerId: string | null;

  @Column({ name: 'associated_loan_id', type: 'text', nullable: true })
  associatedLoanId: string | null;

  @Column({ name: 'primary_gst_no', type: 'text', nullable: true })
  primaryGstNo: string | null;

  @Column({ name: 'aggregation_variable', type: 'text', nullable: true })
  aggregationVariable: string | null;
}
