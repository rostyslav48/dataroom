import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Keyed on email rather than user id, because you must be able to share with someone who has not
 * signed up yet. `userId` is backfilled the first time a matching Google identity signs in — that
 * backfill is what makes inviting a stranger actually work.
 */
@Entity('share_recipients')
export class ShareRecipientEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'share_id', type: 'uuid' })
  shareId: string;

  /** `citext` in the database. */
  @Column({ type: 'text' })
  email: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @CreateDateColumn({ name: 'invited_at', type: 'timestamptz' })
  invitedAt: Date;

  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;
}
