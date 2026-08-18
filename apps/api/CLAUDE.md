# apps/api — backend doctrine

NestJS 10 + TypeORM 0.3 + Postgres 15. You own `apps/api/**` and nothing else. Read the root
`CLAUDE.md` first, then your task's row in `../../ProjectPlan/02-task-board.md`, the one `SPEC-*.md`
it names, and the contracts that spec references. That is the whole input — the specs deliberately
do not restate the contracts.

## Shape of the code

```
src/
  config/       env.schema.ts (Zod, parsed once at boot) + AppConfig (typed accessors)
  common/       DomainError + errors.*, HttpExceptionFilter, ZodValidationPipe, cursor codec
  database/     entities (typed views over the migration), migrations/index.ts, sql.ts, seed-fixtures
  auth/         Google strategy, two OAuth guards, JwtAuthGuard (global), TokensService
  permissions/  PermissionService, ReadAccessGuard, OwnerGuard, @Resource()   ← the security boundary
  nodes/        path.util, name-conflict.util, NodesService, controller
  data-rooms/   service + controller
  storage/      StorageService interface + Supabase implementation
  uploads/      (in progress — see ../../ProjectPlan/STATUS.md)
```

## Rules with teeth

**Errors.** Services throw `DomainError` only — never `HttpException`. `HttpExceptionFilter` maps
code → status through the contract's `ERROR_STATUS`, so there is exactly one mapping. Use the named
constructors in `common/domain-error.ts` (`errors.nameConflict()`, `errors.itemGone()`, …) so a call
site reads as the thing that went wrong.

**Validation** happens once, at the controller boundary, against the contract schema:
`@Body(validate(CreateFolderBody))`. There are no `class-validator` DTOs anywhere and there must
not be — two validation systems means two definitions of "valid", and the frontend knows only one.

**Config.** Nothing outside `config/` reads `process.env` (there is a lint rule). Inject `AppConfig`.

**Routes come from the contract**, not from string literals: `@Get(endpoints.nodes.children.path)`.
A path typo is then a compile error rather than a 404 found at integration.

**Access.** Put `@Resource(kind, param?, source?)` + `@UseGuards(ReadAccessGuard | OwnerGuard)` on
every endpoint. `kind` is `node` | `dataRoom` | `share` | `version`; `source` is `'body'` for
endpoints that name their target in the body (`POST /folders`, `POST /uploads/init`). Read the
resolved answer with `@CurrentAccess()`. A room is **not** resolved through its root node — a
recipient holding one nested folder has access to the room but not its root.

**Raw SQL is fine and often better** than the query builder for the interesting queries (keyset
pagination, subtree rewrites, rollup deltas). Rules: parameterise everything; build path prefixes
only from `likePrefix()`, which escapes `%`, `_` and `\`; alias columns to camelCase in the
projection; keep the `NODE_COLUMNS` fragment as the single source of the node projection.

## Traps, every one of which has already bitten

- **`query()` returns `[rows, affected]` for `UPDATE`/`DELETE`**, and plain rows for everything
  else. The pair is truthy, so `rows[0]` is an *array* rather than undefined and the code sails past
  its not-found branch with nonsense. Use `selectRows` / `updateReturning` / `updateCount` from
  `database/sql.ts`; never call `query()` with `UPDATE … RETURNING` directly.
- **A guard subclass with no constructor of its own emits no `design:paramtypes`**, so Nest injects
  nothing and *every* guarded route 500s at once — which looks nothing like a DI problem. Re-declare
  the constructor and call `super()` (see `permissions/access.guard.ts`).
- **Migrations are listed explicitly** in `database/migrations/index.ts`. A glob resolves
  differently under ts-node, the compiled `dist`, and Vitest, and its failure mode is a silent empty
  list that looks exactly like "nothing to run".
- **`citext = $1::text` is case-*sensitive*.** The explicit `::text` cast defeats the column type.
  Compare with `$1::citext`, or pass the parameter untyped.
- **Cursor sort values must come from Postgres as text.** `timestamptz` has microsecond resolution
  and a JS `Date` has milliseconds, so a cursor built from `updatedAt.toISOString()` truncates and
  every row inside the truncated microsecond is skipped. The listing query selects
  `${sort.expression}::text AS "sortKey"` for exactly this reason.
- **Express routes non-strictly and case-insensitively by default.** Never discriminate on
  `request.path` inside a guard: `…/callback/` and `…/CALLBACK` reach the same handler. This was a
  real login-CSRF, twice. Let the route declaration choose the guard.
- **Vitest needs SWC** (`unplugin-swc`) because esbuild does not emit `emitDecoratorMetadata`, which
  Nest's DI depends on.

## Tests

`test/unit/**` pure logic · `test/integration/**` real HTTP against real Postgres · `src/**/*.test.ts`
for pure modules that live next to their code.

```ts
const harness = await createTestHarness();     // real AppModule, real DB, real middleware stack
await resetDatabase(harness.dataSource);
const seeded = await seedFixtures(harness.dataSource);   // the canonical tree from @dataroom/contracts
await request(httpServer(harness)).get(url).set(await harness.authHeader(owner)).expect(200);
```

One Postgres container per run (`test/global-setup.ts`), migrations applied from empty — which means
the migrations are under test too, unlike a long-lived dev database.

**Only one thing is substituted**: the Google code-for-profile exchange, because Google will not
authenticate a test runner. The real guards' `returnTo` validation and `state`/nonce verification
still run. There is **no test-only login endpoint and no env-flagged backdoor** — a backdoor in the
auth system of a product whose entire premise is access control is not a trade worth making.

Seed from `@dataroom/contracts` fixtures, never invented data: the frontend's mocks serve the same
fixtures, which is what makes a green frontend suite mean anything about the real API.

The permission matrix (`test/integration/permission-matrix.test.ts`) is the highest-value test here.
It asserts **exact** `Access` values with `toEqual`, not `toMatchObject` — a subset match lets a
stray field ride along, which is the class of bug it exists to catch. Extend it whenever you touch
`permissions/`.
