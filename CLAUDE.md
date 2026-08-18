# Data Room — working agreement

A virtual data room: an owner uploads and organises documents, and shares them read-only with
counterparties doing due diligence. React + NestJS + TypeORM + Postgres, blobs in Supabase Storage,
Google sign-in.

**Read `../ProjectPlan/STATUS.md` first.** It is maintained as the resume-from-cold document: what
is verified, what is half-done and exactly where, what is blocked on credentials.

## The layout is not the usual one

```
DataRoom/                  NOT a git repo — just a folder
├─ ProjectDesc/            design rationale        (untracked, read-only to agents)
├─ ProjectPlan/            the plan + STATUS.md    (untracked, read-only except PM)
└─ dataroom/               THE REPO — your working directory
```

The plan lives **outside** the repo, at `../ProjectPlan/`. This is deliberate: the repo contains
code only. It also means **git worktrees are unusable** — a worktree contains only tracked files, so
a worktree'd agent loses its own instructions. Everyone shares this one checkout.

## Ownership — enforced per commit, not by convention

| Path | Owner |
|---|---|
| `apps/api/**` | backend |
| `apps/web/**` | frontend |
| `e2e/**` | qa |
| `packages/contracts/**` | **frozen** — CCP only |
| root config, `.github/**`, `scripts/**` | W0 — frozen after Wave 0 |
| `README.md`, `CLAUDE.md`, `.claude/**` | PM |

Every commit declares its track in a trailer, and CI validates the commit's files against that
track's globs:

```
git commit -m "BE-12: upload lifecycle" -m "Track: backend"
```

Tracks: `backend` · `frontend` · `qa` · `pm` · `w0`. A commit with no trailer fails. Check locally
with `node scripts/check-ownership.mjs main..HEAD`.

> **Never run `git add -A` or `git add .`.** Several agents work in this checkout simultaneously;
> `-A` stages someone else's half-finished work into your commit. Always `git add apps/api` (or
> your own path). On `index.lock` contention, wait and retry — then check `git log` rather than
> assuming your commit landed.

## The contract is the spec

`packages/contracts` defines every request and response shape in Zod. It was written once, in
Wave 0, and is **frozen**. Both apps import it constantly and write to it never.

To change it: stop, write `../ProjectPlan/ccp/CCP-<n>-<slug>.md` from `TEMPLATE.md`, apply the
change in a single commit touching only that package, and tell the other track *why*, not just
what. Six such notes exist; read them before assuming a divergence from the plan is an accident.

Responses the contract leaves implied are recorded in `apps/api/RESPONSE-SHAPES.md`, including two
behaviours a schema cannot express (share-root projection, breadcrumb truncation).

## Commands

```
pnpm install
pnpm --filter @dataroom/contracts build   # required before typechecking the apps from cold

pnpm db:up                                 # Postgres 15 in Docker
pnpm db:migrate                            # TypeORM CLI, explicit migration list
pnpm db:seed                               # the canonical fixture tree; idempotent
pnpm dev:api                               # localhost:3000, /api/v1/health
VITE_USE_MSW=true pnpm dev:web             # localhost:5173, no backend needed

pnpm test                                  # what CI runs: contracts + api + web, gates enforced
pnpm test:fast                             # the inner loop — no coverage, no gates
pnpm lint && pnpm typecheck
```

> **`pnpm test` is the gate.** It is defined as literally the three commands CI runs, in order —
> contracts, then `@dataroom/api test:coverage`, then `@dataroom/web test:coverage` — so a green
> local run and a green CI run mean the same thing. That was not true until CI-1: root `test` ran
> the ungated suites while CI ran the gated ones, and the 90% service threshold quietly stopped
> being a threshold. `test:fast` exists for the inner loop and is named so it cannot be mistaken
> for the gate. Gates: 90% statements on `*.service.ts` and on `permissions/**`, 80% everywhere
> else. Currently ~692 tests, all green.

## Non-negotiables

1. **Access is decided in exactly one place.** `PermissionService`, behind `ReadAccessGuard` /
   `OwnerGuard`. No controller or service writes `if (node.ownerId === user.id)` — grep for
   `ownerId ===` and you should find nothing outside `permissions/`.
2. **Nothing about permissions is cached.** Revocation must take effect on the very next request.
3. **The unique index is the only authority on name conflicts.** Never pre-check with a `SELECT`;
   attempt the write and map `23505`. A check-then-insert is a TOCTOU race under concurrent uploads.
4. **Every response is Zod-parsed on both sides.** The backend's contract tests parse with
   `.strict()`; the frontend parses every response it receives. A shape that drifts fails loudly.
5. **Bytes never pass through the API.** Uploads `PUT` straight to a signed URL; reads 302 to one,
   and the URL is minted **only after** the guard has granted — a 403 returned after minting still
   handed out a working link for sixty seconds. Denial tests assert on the mint record, not on the
   status code.
6. **No `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, `TODO`, or `FIXME`.** CI greps for all of
   them. If a lint rule is wrong, change the rule and say why.
7. **Ask rather than assume when a spec is ambiguous.** A wrong assumption baked into one track
   surfaces at integration, which is the most expensive moment to find it.

## Definition of done

Its spec's acceptance criteria are covered by passing tests · `typecheck` and `lint` clean ·
`test:coverage` passes · only your track's files touched · every backend endpoint has an
integration test against real Postgres and a contract test · every frontend component has loading,
empty, error and success tests · no stub presented as finished · committed with a `Track:` trailer.

## Traps that have already cost time

- **`localhost` resolves to `::1` first.** When a published sandbox port "can't be reached", try
  `http://127.0.0.1:<port>` before debugging anything else.
- **MSW's worker is generated, not committed.** `pnpm --filter @dataroom/web exec msw init public/`
  once, or the mocked app boots to a blank page.
- **`pkill -f vite` matches its own shell** and kills your background server with it. Use the
  harness's background runner, or a pattern that cannot self-match.
- Per-track traps live in `apps/api/CLAUDE.md` and `apps/web/CLAUDE.md`. Read the one for your
  track before writing code; both are short and every entry cost somebody an hour.
