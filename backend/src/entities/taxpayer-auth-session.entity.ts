import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type TaxpayerAuthState =
  | 'OTP_REQUIRED'
  | 'OTP_SUBMITTED'
  | 'AUTHENTICATED'
  | 'FAILED';

@Entity('taxpayer_auth_sessions')
@Index(['username', 'gstin'], { unique: true })
export class TaxpayerAuthSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  username: string;

  @Column({ type: 'text' })
  gstin: string;

  @Column({ type: 'varchar', length: 32, default: 'OTP_REQUIRED' })
  state: TaxpayerAuthState;

  @Column({ name: 'otp_value', type: 'text', nullable: true })
  otpValue: string | null;

  @Column({ name: 'otp_submitted_at', type: 'timestamptz', nullable: true })
  otpSubmittedAt: Date | null;

  @Column({ name: 'otp_expires_at', type: 'timestamptz', nullable: true })
  otpExpiresAt: Date | null;

  @Column({ name: 'access_token', type: 'text', nullable: true })
  accessToken: string | null;

  @Column({ name: 'token_expires_at', type: 'timestamptz', nullable: true })
  tokenExpiresAt: Date | null;

  @Column({ name: 'last_verified_at', type: 'timestamptz', nullable: true })
  lastVerifiedAt: Date | null;

  @Column({ name: 'last_refreshed_at', type: 'timestamptz', nullable: true })
  lastRefreshedAt: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
