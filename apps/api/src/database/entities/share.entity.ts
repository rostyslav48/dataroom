import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type ShareTypeValue = 'public_link' | 'permissioned';
export type ShareRoleValue = 'viewer';

/**
 * A share targets exactly one thing: a node. "Share the whole data room" is "share its root node",
 * which is why there is no polymorphic target pair and no three-way branch in the permission check.
 *
 * `role` has a single legal value today. It exists so that adding `editor` is an enum change plus a
 * permission matrix rather than a remodel — every consumer already treats it as a value.
 */
@Entity('shares')
export class ShareEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'node_id', type: 'uuid' })
  nodeId: string;

  @Column({ name: 'data_room_id', type: 'uuid' })
  dataRoomId: string;

  @Column({ type: 'enum', enum: ['public_link', 'permissioned'], enumName: 'share_type' })
  type: ShareTypeValue;

  @Column({ type: 'enum', enum: ['viewer'], enumName: 'share_role', default: 'viewer' })
  role: ShareRoleValue;

  /** 256 bits from `crypto.randomBytes`, base64url. Null for permissioned shares. */
  @Column({ type: 'text', nullable: true, unique: true })
  token: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  /** Revocation sets a timestamp; rows are never deleted, so the owner's console keeps its history. */
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
