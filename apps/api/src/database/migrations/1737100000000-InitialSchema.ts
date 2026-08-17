import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The whole schema, in one migration, exactly as specified in ProjectDesc/02-data-model.md.
 *
 * Written as SQL rather than generated from entities on purpose: the constraints and partial
 * indexes below are the application's correctness guarantees, not incidental details. In
 * particular `ux_nodes_sibling_name` is the *only* authority on name conflicts, and
 * `ix_nodes_path` must carry `text_pattern_ops` or every subtree query silently degrades to a
 * sequential scan under a non-C collation.
 *
 * Entities are typed views over this. `synchronize` is false everywhere, including locally.
 */
export class InitialSchema1737100000000 implements MigrationInterface {
  name = 'InitialSchema1737100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS citext`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

    // ── users ────────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE users (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        google_sub  text   NOT NULL UNIQUE,
        email       citext NOT NULL UNIQUE,
        name        text   NOT NULL,
        avatar_url  text,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now()
      )
    `);

    // ── data rooms ───────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE data_rooms (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id     uuid NOT NULL REFERENCES users(id),
        name         text NOT NULL,
        root_node_id uuid,
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now(),
        deleted_at   timestamptz
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_rooms_owner ON data_rooms (owner_id) WHERE deleted_at IS NULL`,
    );

    // ── nodes ────────────────────────────────────────────────────────────────
    await queryRunner.query(`CREATE TYPE node_type AS ENUM ('folder', 'file')`);
    await queryRunner.query(`
      CREATE TABLE nodes (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        data_room_id       uuid NOT NULL REFERENCES data_rooms(id) ON DELETE CASCADE,
        parent_id          uuid REFERENCES nodes(id) ON DELETE CASCADE,
        type               node_type NOT NULL,
        name               text NOT NULL,
        path               text NOT NULL,
        depth              int  NOT NULL,
        created_by         uuid NOT NULL REFERENCES users(id),
        current_version_id uuid,
        size_bytes         bigint,
        mime_type          text,
        subtree_size_bytes bigint NOT NULL DEFAULT 0,
        subtree_file_count int    NOT NULL DEFAULT 0,
        created_at         timestamptz NOT NULL DEFAULT now(),
        updated_at         timestamptz NOT NULL DEFAULT now(),
        deleted_at         timestamptz,

        CONSTRAINT ck_name_nonempty  CHECK (length(btrim(name)) BETWEEN 1 AND 255),
        CONSTRAINT ck_name_no_slash  CHECK (name !~ '[/\\\\]'),
        CONSTRAINT ck_folder_columns CHECK (
          type = 'file' OR (current_version_id IS NULL AND size_bytes IS NULL AND mime_type IS NULL)
        ),
        CONSTRAINT ck_root_is_folder CHECK (parent_id IS NOT NULL OR type = 'folder')
      )
    `);

    // The circular reference: a room points at its root node, the node points back at the room.
    await queryRunner.query(`
      ALTER TABLE data_rooms
        ADD CONSTRAINT fk_rooms_root_node FOREIGN KEY (root_node_id) REFERENCES nodes(id)
    `);

    // exactly one live root per data room
    await queryRunner.query(`
      CREATE UNIQUE INDEX ux_nodes_one_root
        ON nodes (data_room_id) WHERE parent_id IS NULL AND deleted_at IS NULL
    `);
    // sibling name uniqueness, case-insensitive, ignoring soft-deleted rows
    await queryRunner.query(`
      CREATE UNIQUE INDEX ux_nodes_sibling_name
        ON nodes (parent_id, lower(name)) WHERE deleted_at IS NULL AND parent_id IS NOT NULL
    `);
    // THE listing query: children of a folder, folders first, then by name, keyset-paginated
    await queryRunner.query(`
      CREATE INDEX ix_nodes_listing
        ON nodes (parent_id, type, lower(name), id) WHERE deleted_at IS NULL
    `);
    // subtree scans: delete cascade, rollups, search scoping.
    // text_pattern_ops is REQUIRED for LIKE 'prefix%' to use the index on a non-C collation.
    await queryRunner.query(`
      CREATE INDEX ix_nodes_path
        ON nodes (data_room_id, path text_pattern_ops) WHERE deleted_at IS NULL
    `);
    await queryRunner.query(
      `CREATE INDEX ix_nodes_room ON nodes (data_room_id) WHERE deleted_at IS NULL`,
    );

    // ── file versions ────────────────────────────────────────────────────────
    await queryRunner.query(`CREATE TYPE version_status AS ENUM ('pending', 'ready')`);
    await queryRunner.query(`
      CREATE TABLE file_versions (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        node_id         uuid NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        version         int  NOT NULL,
        storage_key     text NOT NULL UNIQUE,
        size_bytes      bigint NOT NULL,
        mime_type       text NOT NULL,
        checksum_sha256 text,
        status          version_status NOT NULL DEFAULT 'pending',
        uploaded_by     uuid NOT NULL REFERENCES users(id),
        created_at      timestamptz NOT NULL DEFAULT now(),
        UNIQUE (node_id, version)
      )
    `);
    // the sweeper's query
    await queryRunner.query(
      `CREATE INDEX ix_versions_pending ON file_versions (created_at) WHERE status = 'pending'`,
    );
    await queryRunner.query(`
      ALTER TABLE nodes ADD CONSTRAINT fk_nodes_current_version
        FOREIGN KEY (current_version_id) REFERENCES file_versions(id)
    `);

    // ── sharing ──────────────────────────────────────────────────────────────
    await queryRunner.query(`CREATE TYPE share_type AS ENUM ('public_link', 'permissioned')`);
    await queryRunner.query(`CREATE TYPE share_role AS ENUM ('viewer')`);
    await queryRunner.query(`
      CREATE TABLE shares (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        node_id      uuid NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        data_room_id uuid NOT NULL REFERENCES data_rooms(id) ON DELETE CASCADE,
        type         share_type NOT NULL,
        role         share_role NOT NULL DEFAULT 'viewer',
        token        text UNIQUE,
        expires_at   timestamptz,
        revoked_at   timestamptz,
        created_by   uuid NOT NULL REFERENCES users(id),
        created_at   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_token_iff_link CHECK ((type = 'public_link') = (token IS NOT NULL))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_shares_node ON shares (node_id) WHERE revoked_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_shares_active ON shares (data_room_id) WHERE revoked_at IS NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE share_recipients (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        share_id    uuid NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
        email       citext NOT NULL,
        user_id     uuid REFERENCES users(id),
        invited_at  timestamptz NOT NULL DEFAULT now(),
        accepted_at timestamptz,
        revoked_at  timestamptz,
        UNIQUE (share_id, email)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_recipients_user ON share_recipients (user_id) WHERE revoked_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_recipients_email ON share_recipients (email) WHERE revoked_at IS NULL`,
    );

    // ── refresh tokens (SPEC-02 rotation; see ProjectPlan/ccp/CCP-3) ──────────
    await queryRunner.query(`
      CREATE TABLE refresh_tokens (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        family_id  uuid NOT NULL,
        token_hash text NOT NULL UNIQUE,
        expires_at timestamptz NOT NULL,
        used_at    timestamptz,
        revoked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_refresh_family ON refresh_tokens (family_id) WHERE revoked_at IS NULL`,
    );
    await queryRunner.query(`CREATE INDEX ix_refresh_user ON refresh_tokens (user_id)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS refresh_tokens`);
    await queryRunner.query(`DROP TABLE IF EXISTS share_recipients`);
    await queryRunner.query(`DROP TABLE IF EXISTS shares`);
    await queryRunner.query(`ALTER TABLE nodes DROP CONSTRAINT IF EXISTS fk_nodes_current_version`);
    await queryRunner.query(`DROP TABLE IF EXISTS file_versions`);
    await queryRunner.query(`ALTER TABLE data_rooms DROP CONSTRAINT IF EXISTS fk_rooms_root_node`);
    await queryRunner.query(`DROP TABLE IF EXISTS nodes`);
    await queryRunner.query(`DROP TABLE IF EXISTS data_rooms`);
    await queryRunner.query(`DROP TABLE IF EXISTS users`);
    await queryRunner.query(`DROP TYPE IF EXISTS share_role`);
    await queryRunner.query(`DROP TYPE IF EXISTS share_type`);
    await queryRunner.query(`DROP TYPE IF EXISTS version_status`);
    await queryRunner.query(`DROP TYPE IF EXISTS node_type`);
  }
}
