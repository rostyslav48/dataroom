import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Refresh tokens, stored as SHA-256 hashes so a database leak is not a session leak.
 *
 * Rotation is per use: the presented token is marked used and a fresh one issued in the same
 * family. Presenting an already-used token is the classic replay signature, and the response is to
 * revoke the whole family rather than just that row — the attacker and the victim are by then
 * holding tokens from the same chain and there is no way to tell which is which.
 *
 * (This table is not in ProjectDesc/02-data-model.md, which specifies rotation in SPEC-02 without
 * saying where the tokens live. See ProjectPlan/ccp/CCP-3.)
 */
@Entity('refresh_tokens')
export class RefreshTokenEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  /** All tokens descended from one login share a family id. */
  @Column({ name: 'family_id', type: 'uuid' })
  familyId: string;

  @Column({ name: 'token_hash', type: 'text', unique: true })
  tokenHash: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  /** Set when the token is exchanged. A second exchange of the same row is a replay. */
  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
