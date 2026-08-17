import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { bigintTransformer } from '../transformers';

export type NodeTypeValue = 'folder' | 'file';

/**
 * Folders and files in one table.
 *
 * `path` is the materialized list of ancestor ids including self — `/root/a/self/`. It is what
 * makes breadcrumbs, subtree reads and the permission check indexed lookups instead of recursive
 * walks, and it is maintained inside the same transaction as every mutation that can change it.
 */
@Entity('nodes')
export class NodeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'data_room_id', type: 'uuid' })
  dataRoomId: string;

  /** Null only for a data room's root node. */
  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId: string | null;

  @Column({ type: 'enum', enum: ['folder', 'file'], enumName: 'node_type' })
  type: NodeTypeValue;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text' })
  path: string;

  @Column({ type: 'int' })
  depth: number;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  // ── file only ──────────────────────────────────────────────────────────────
  /** Null while an upload is in flight, which is exactly what keeps the row out of listings. */
  @Column({ name: 'current_version_id', type: 'uuid', nullable: true })
  currentVersionId: string | null;

  @Column({ name: 'size_bytes', type: 'bigint', nullable: true, transformer: bigintTransformer })
  sizeBytes: number | null;

  @Column({ name: 'mime_type', type: 'text', nullable: true })
  mimeType: string | null;

  // ── folder rollups ─────────────────────────────────────────────────────────
  @Column({
    name: 'subtree_size_bytes',
    type: 'bigint',
    default: 0,
    transformer: bigintTransformer,
  })
  subtreeSizeBytes: number;

  @Column({ name: 'subtree_file_count', type: 'int', default: 0 })
  subtreeFileCount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
