# Data Room

A virtual data room for due-diligence workflows. Owners organize documents into nested folders,
upload files directly to private object storage, and grant read-only access through public links or
email-addressed invitations. Shared users see only the subtree they were granted, and revocation is
effective on the next request.

The workspace contains a React 18/Vite client, a NestJS 10 API, PostgreSQL 15 via TypeORM, a shared
Zod contract package, and Playwright end-to-end tests. Supabase Storage is the production object
store; file bytes never pass through the API.

## Current status

The application code, database migrations, fixture seed, unit/integration/contract/component tests,
and local MSW experience are implemented. No public deployment URL is published from this checkout.
Live Google OAuth, the cross-origin production cookie, and raw browser upload progress still require
the external Google, Supabase, Render, and Vercel credentials described below.

One security-design decision is also still open: refresh-token reuse currently has a 15-second grace
window for simultaneous browser-tab refreshes. See the deviations register for the exact trade-off.

## What is implemented

- Google OAuth with short-lived access JWTs and rotating, hashed refresh tokens in an `httpOnly`
  cookie.
- Multiple owner data rooms, nested folders, breadcrumbs, keyset-paginated listings, rename, move,
  subtree deletion, exact delete previews, and cached rollups with a nightly drift audit.
- Direct-to-storage multi-file uploads with real XHR progress, concurrency limiting, retry on the
  same reservation, abandoned-upload cleanup, and zero-byte file support.
- In-app PDF viewing and signed 60-second preview/download redirects; other allowed file types remain
  downloadable.
- Public-link and permissioned sharing at room, folder, or file level; immediate revocation and six
  designed access-failure states.
- Row virtualization, keyboard navigation, responsive layouts, reduced-motion support, and rollback
  for optimistic browser mutations.

Filename search and user-editable version history are intentionally not exposed. The schema already
supports file versions; subtree search is designed for a later indexed implementation.

## Architecture

```text
React SPA  ── JSON + credentials ──>  NestJS API  ──>  PostgreSQL
    │                                      │
    └── signed PUT/GET, file bytes ────────┴────>  private Supabase Storage
```

The important boundaries are:

- `packages/contracts` is the API source of truth. Backend contract tests parse every JSON response
  with strict Zod schemas, and the frontend parses responses against those same schemas.
- `PermissionService`, reached through `ReadAccessGuard` and `OwnerGuard`, is the only place that
  decides access. Permission results are never cached, so revocation cannot leave a stale grant.
- Storage is private. The API grants one short-lived signed URL only after its access guard succeeds;
  it never proxies bytes or exposes the Supabase service-role key to the browser.
- PostgreSQL migrations are authoritative and `synchronize` is always disabled. Multi-row tree,
  upload, share, and rollup changes are transactional.

### Principal design decisions

1. **Adjacency list plus materialized path.** Each node stores `parent_id` and a UUID-only `path`
   such as `/root/folder/node/`. Breadcrumbs, subtree scans, and permission ancestry checks avoid
   recursive queries. Moving a subtree costs one transactional prefix rewrite.
2. **Folders and files share one node table.** Rename, move, delete, breadcrumb, and sharing behavior
   has one implementation. File metadata is nullable on folders; cached rollups are meaningful on
   folders.
3. **Uploads reserve before bytes move.** `init` creates an invisible placeholder and pending version,
   then returns a signed write URL. `complete` verifies the object and atomically promotes it. Retry
   reuses the reservation, while abort and the 24-hour sweeper remove abandoned reservations.
4. **Shares target nodes.** Sharing a whole room means sharing its root node. Public links and named
   recipients therefore use the same subtree authorization path, and breadcrumbs are truncated at
   the granting node.
5. **Keyset pagination and virtualized rows from the start.** Folder cost stays stable as it grows,
   inserts cannot create `OFFSET` skips, and the browser does not render an unbounded DOM list.
6. **Database constraints decide name conflicts.** Writes attempt the insert/update and map PostgreSQL
   `23505`; there is no check-then-write race.

## Repository layout

```text
apps/api/             NestJS API, migrations, seed, and backend tests
apps/web/             React client, MSW handlers, and component tests
packages/contracts/   shared Zod request/response contracts and canonical fixtures
e2e/                  Playwright flows and session harness
scripts/              commit ownership validation
```

## Local setup

### Prerequisites

- Node.js 22 recommended (20 or newer is supported)
- pnpm 9.15.9 through Corepack
- Docker with Compose for local PostgreSQL and for backend integration tests
- For the real full stack: a Google OAuth client and a Supabase project with a private Storage bucket

Enable the repository's pinned package manager and install exactly the lockfile:

```bash
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm --filter @dataroom/contracts build
```

If `corepack enable` is unavailable in a locked-down shell, prefix commands with `corepack`, for
example `corepack pnpm install --frozen-lockfile`.

### Option A: run the frontend with MSW, no accounts or backend

This is the fastest way to inspect the complete UI and its mutable fixture tree:

```bash
pnpm --filter @dataroom/web exec msw init public/ --no-save
VITE_USE_MSW=true pnpm dev:web
```

Open `http://127.0.0.1:5173`. The generated service-worker file is intentionally untracked and must
be created once per clean clone. MSW is development-only and the production build is checked to make
sure it contains neither the worker nor the mock handlers.

### Option B: run the real local stack

Copy the complete environment template:

```bash
cp .env.example .env
```

Replace every empty or placeholder value in `.env`:

- Create a Google OAuth consent screen using `openid`, `email`, and `profile`, then register
  `http://localhost:3000/api/v1/auth/google/callback`.
- Create a **private** Supabase Storage bucket matching `SUPABASE_BUCKET`. Put the Supabase URL and
  service-role key only in the API environment; never expose the key through a `VITE_` variable.
- Generate distinct access and refresh secrets, for example with `openssl rand -base64 48` twice.
- Keep local cookies at `COOKIE_SAMESITE=lax` and `COOKIE_SECURE=false`.

The API reads the repo-root `.env` and exits before listening if a required value is missing or
invalid. Start and prepare PostgreSQL:

```bash
pnpm db:up
pnpm db:migrate
pnpm db:seed
```

The seed is repeatable: it rebuilds only the canonical fixture room and preserves unrelated rooms.
Then run the two applications in separate terminals:

```bash
pnpm dev:api
```

```bash
VITE_API_URL=http://localhost:3000 VITE_USE_MSW=false pnpm dev:web
```

Useful checks:

- Web: `http://127.0.0.1:5173`
- API health: `http://127.0.0.1:3000/api/v1/health`
- Google sign-in starts at `http://127.0.0.1:3000/api/v1/auth/google`

The real-browser raw `PUT` path to a Supabase signed upload URL remains an external verification item.
Before relying on uploads in a deployment, confirm the bucket's CORS behavior and that
`xhr.upload.onprogress` fires for a representative file. If Supabase does not support this exact path,
the fallback is resumable/TUS or presigned S3 and requires an API-contract change.

## Verification

The authoritative local/CI gate is:

```bash
pnpm test
```

It runs the contracts fixture tests, API coverage suite, and web coverage suite with the configured
thresholds. `pnpm test:fast` is an ungated inner loop, not a completion check.

Run the complete static and build checks with:

```bash
pnpm lint
pnpm --filter @dataroom/contracts build
pnpm typecheck
pnpm build
```

Backend integration and contract tests start a PostgreSQL Testcontainer and migrate it from empty;
they do not use the developer database. The Playwright suite expects a separately running stack and
the canonical seed:

```bash
E2E_WEB_URL=http://localhost:5173 \
E2E_API_URL=http://localhost:3000 \
DATABASE_URL=postgres://dataroom:dataroom@localhost:5432/dataroom \
JWT_ACCESS_SECRET='<the value from .env>' \
pnpm test:e2e
```

Playwright injects sessions from its own harness rather than adding a production login backdoor.
The actual Google round trip is intentionally a manual deployment check.

## Data model

```mermaid
erDiagram
    USERS ||--o{ DATA_ROOMS : owns
    USERS ||--o{ NODES : creates
    USERS ||--o{ FILE_VERSIONS : uploads
    USERS ||--o{ SHARES : creates
    USERS o|--o{ SHARE_RECIPIENTS : accepts
    USERS ||--o{ REFRESH_TOKENS : authenticates

    DATA_ROOMS ||--|{ NODES : contains
    DATA_ROOMS o|--|| NODES : root_node
    DATA_ROOMS ||--o{ SHARES : scopes
    NODES o|--o{ NODES : parent
    NODES ||--o{ FILE_VERSIONS : versions
    NODES o|--o| FILE_VERSIONS : current_version
    NODES ||--o{ SHARES : targets
    SHARES ||--o{ SHARE_RECIPIENTS : grants

    USERS {
        uuid id PK
        text google_sub UK
        citext email
        text name
    }
    DATA_ROOMS {
        uuid id PK
        uuid owner_id FK
        uuid root_node_id FK
        text name
        timestamptz deleted_at
    }
    NODES {
        uuid id PK
        uuid data_room_id FK
        uuid parent_id FK
        node_type type
        text name
        text path
        int depth
        uuid current_version_id FK
        bigint size_bytes
        bigint subtree_size_bytes
        int subtree_file_count
        timestamptz deleted_at
    }
    FILE_VERSIONS {
        uuid id PK
        uuid node_id FK
        int version
        text storage_key UK
        bigint size_bytes
        text mime_type
        version_status status
        uuid uploaded_by FK
    }
    SHARES {
        uuid id PK
        uuid node_id FK
        uuid data_room_id FK
        share_type type
        share_role role
        text token UK
        timestamptz expires_at
        timestamptz revoked_at
        uuid created_by FK
    }
    SHARE_RECIPIENTS {
        uuid id PK
        uuid share_id FK
        citext email
        uuid user_id FK
        timestamptz accepted_at
        timestamptz revoked_at
    }
    REFRESH_TOKENS {
        uuid id PK
        uuid user_id FK
        uuid family_id
        text token_hash UK
        timestamptz expires_at
        timestamptz used_at
        timestamptz revoked_at
    }
```

`data_rooms.root_node_id` is nullable only to allow the circular room/root creation transaction; a
committed room always has a root. Nodes and rooms are soft-deleted, while share revocation is retained
as history. Pending upload placeholders have no `current_version_id` and are excluded from listings and
rollups.

## How it scales

### 1. Total folder size and item count

Exact stats and delete previews use the materialized path as an indexed prefix range, not a recursive
walk. The `text_pattern_ops` path index matters because it lets PostgreSQL use a btree for
`LIKE 'prefix%'` outside the C collation.

Listings read `subtree_size_bytes` and `subtree_file_count` cached on each folder. Upload, delete, and
move transactions update the already-known ancestor IDs in O(depth). A nightly job recomputes every
live folder from completed file nodes and logs drift. It does not auto-repair mismatches because the
mismatch is evidence of a broken transactional mutation path.

If concurrent writes make the room root a hot row, the next tier is an append-only delta ledger:
writers append without contending, a worker compacts deltas, and reads use cached values plus pending
deltas.

### 2. A room with 100,000 files

The model stays the same. Listings use a `(type, sort value, id)` keyset cursor and a partial sibling
index, so later pages do not scan and discard earlier rows. The client fetches bounded pages and
virtualizes rows. Cached header counts avoid repeated full aggregates, while destructive previews remain
exact and run only when opened.

Subtree operations continue to use the materialized-path index. Search would add a normalized-name
column and a room-scoped `pg_trgm` GIN index rather than `LIKE '%term%'`; at multi-million-file scale or
for content search it moves to a dedicated search service. Moves/deletes above a measured threshold
become queued `202` jobs with progress, using the same SQL in a safer execution context. UUID-only flat
storage keys need no directory redesign.

### 3. Per-user viewer/editor roles

The grant already owns its `role`, guards already consume a role rather than a boolean, and overlapping
grants resolve most-permissive-first. Adding `editor` therefore means extending the database/contract
enum, adding permission-matrix cells, and replacing owner-only mutation guards with a role requirement.
It does not remodel the tree or share-recipient tables. The same separation can later absorb group
recipients, deny rules, download restrictions, expiry, or network constraints inside the permission
boundary.

## Deployment notes

The intended topology is a long-running Nest service on Render/Railway, a Vite build on Vercel,
Supabase PostgreSQL/Storage, and Google OAuth. Production must use:

- the exact deployed `WEB_ORIGIN` for credentialed CORS;
- `COOKIE_SAMESITE=none` with `COOKIE_SECURE=true`;
- the deployed `/api/v1/auth/google/callback` registered with Google;
- `VITE_API_URL` set to the API origin and no secret under any `VITE_` name;
- a private bucket and a backend-only Supabase service-role key;
- migrations and the seed run deliberately against the selected database.

Before calling a deployment verified, test the refresh cookie in Safari and Chrome incognito, perform a
real multi-file upload with visible progress, open and download a file, and confirm a revoked share fails
on the very next request.

## Deviations register

The implementation plan records deliberate changes as Contract Change Protocol notes:

| Note  | Status                     | Decision and rationale                                                                                                                                                                                                                                      |
| ----- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CCP-1 | Applied                    | Added Nest peer dependencies, SWC decorator transforms, coverage/RTL tooling, a pinned pdf.js worker dependency, and contract-package test tooling required by the chosen stack.                                                                            |
| CCP-2 | Applied                    | Replaced the ineffective global `nestjs-zod` approach with a small per-parameter `ZodValidationPipe`, keeping the exact contract schema visible at each controller boundary and mapping validation details consistently.                                    |
| CCP-3 | Applied                    | Added server-side `refresh_tokens`; hashed rotating tokens and family revocation cannot be implemented statelessly.                                                                                                                                         |
| CCP-5 | Applied                    | Widened upload size validation from positive to nonnegative, because empty files are legitimate; completion still requires exact equality with object-storage size.                                                                                         |
| CCP-6 | **Pending owner decision** | The code allows a 15-second refresh replay grace window so two tabs do not log each other out. The spec still promises unconditional family revocation. The recommended successor-token design removes the theft window without breaking multi-tab refresh. |
| CCP-7 | Applied                    | Abort deletes the pending version and placeholder node instead of inventing an unread `abandoned` state; this immediately frees the reserved filename and matches sweeper cleanup.                                                                          |

## AI usage

AI coding agents were used to turn the written brief into contracts and specs, implement both
applications, generate and review tests, investigate failures, and maintain the decision/deviation
record. The workflow was contract → specification → failing test → implementation, with separate
adversarial QA passes and coverage gates. AI output was treated as untrusted engineering work: behavior
is accepted only when it is represented in the shared contract or a written deviation and exercised by
the automated suite. External credentials, deployment ownership, and the remaining refresh-token policy
decision stay with the project owner.
