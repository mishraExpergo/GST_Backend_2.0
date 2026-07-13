import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('secondary_gst_aggregation')
export class SecondaryGstAggregation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'customer_id', type: 'text', nullable: true })
  customerId: string | null;

  @Column({ name: 'associated_loan_id', type: 'text', nullable: true })
  associatedLoanId: string | null;

  @Column({ name: 'aggregation_variable', type: 'text', nullable: true })
  aggregationVariable: string | null;
}
