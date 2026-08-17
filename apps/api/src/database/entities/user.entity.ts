import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Identity is the Google `sub`, never the email: an email can change hands, a `sub` cannot. The
 * email is stored and refreshed on each login because permissioned sharing invites by email.
 */
@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'google_sub', type: 'text', unique: true })
  googleSub: string;

  /** `citext` in the database — comparison is case-insensitive everywhere. */
  @Column({ type: 'text' })
  email: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ name: 'avatar_url', type: 'text', nullable: true })
  avatarUrl: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
