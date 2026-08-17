import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { bigintTransformer } from '../transformers';

export type VersionStatus = 'pending' | 'ready';

/**
 * A version row is created *before* the signed upload URL is handed out and only promoted to
 * `ready` once the object is confirmed in storage. That ordering is what makes a closed browser tab
 * a non-event: the leftovers are a `pending` row and an orphan blob, both swept after 24 hours,
 * and the node they belong to was never visible in a listing.
 */
@Entity('file_versions')
export class FileVersionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'node_id', type: 'uuid' })
  nodeId: string;

  @Column({ type: 'int' })
  version: number;

  /** `${dataRoomId}/${nodeId}/${versionId}` — no user-controlled segment ever reaches storage. */
  @Column({ name: 'storage_key', type: 'text', unique: true })
  storageKey: string;

  @Column({ name: 'size_bytes', type: 'bigint', transformer: bigintTransformer })
  sizeBytes: number;

  @Column({ name: 'mime_type', type: 'text' })
  mimeType: string;

  @Column({ name: 'checksum_sha256', type: 'text', nullable: true })
  checksumSha256: string | null;

  @Column({ type: 'enum', enum: ['pending', 'ready'], enumName: 'version_status', default: 'pending' })
  status: VersionStatus;

  @Column({ name: 'uploaded_by', type: 'uuid' })
  uploadedBy: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
