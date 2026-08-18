# apps/web — frontend doctrine

React 18 + Vite + TanStack Query + Tailwind + Radix. You own `apps/web/**` and nothing else. Read
the root `CLAUDE.md`, your task row in `../../ProjectPlan/02-task-board.md`, and the one `SPEC-*.md`
it names. **Do not read `apps/api/**`** — if the answer isn't in the contract or the spec, that's a
spec gap worth raising, not something to reverse-engineer. The single exception is
`apps/api/RESPONSE-SHAPES.md`, which exists for you.

## Shape of the code

```
src/
  lib/         api.ts (fetch + Zod + single-flight refresh), queryKeys, errorMap, queryClient
  mocks/       MSW handlers + a mutable in-memory tree, built from @dataroom/contracts fixtures
  components/  ui/ (primitives), layout/ (AppShell, TopBar, Sidebar)
  features/    auth · rooms · browser · uploads · viewer · shares
  routes/      route table; layout is chosen from the response, never from the URL
```

## Rules with teeth

**Parse every response with its contract schema.** A backend that returns the wrong shape must fail
loudly in `lib/api.ts`, not produce `undefined` three components deep. This is the frontend half of
the drift defence; the backend's contract tests are the other half.

**The access token lives in memory only.** Never `localStorage`, never `sessionStorage` — an XSS
should cost one session, not a persistent credential. There is a test asserting this; keep it.

**Layout comes from `NodeDetailResponse.access`, never from the route.** A permissioned viewer
browses the ordinary `/rooms/...` URLs, so keying layout off the URL would hand them owner chrome
full of buttons that 403 on click. `SharedLayout` omits mutation controls **entirely** rather than
rendering them disabled: read-only is enforced server-side, and the layout exists so the UI never
offers an action that would be refused.

**A shared room is projected onto the caller's share root.** `sharedWithMe[].name`, `.rootNodeId`,
`.fileCount`, `.sizeBytes` and `NodeDetailResponse.dataRoomName` are all the *share root's*, not the
room's — a viewer must not learn the room's name, because it is the root folder's name and their
breadcrumbs are truncated precisely to withhold it. **The mocks must apply the same projection.**
They once didn't, and because both shapes satisfy the same `.strict()` schema, contract tests passed
on both sides while the meanings differed. That is the "two correct halves don't fit" failure the
shared fixtures exist to prevent.

**`errorMap` is exhaustive** over `ErrorCode` via a `never` check, so adding a code to the contract
without designing its state is a compile error. Every code has a designed screen or inline state.

**Errors that belong to a form stay in that form.** Toasts are for background successes only — a
`NAME_CONFLICT` on rename keeps the input open with the user's typing intact, because a toast would
lose it.

**Pagination ends only when `nextCursor === null`.** Never infer the end from a short page.

## Traps, every one of which has already bitten

- **MSW's worker is generated, not committed**: `pnpm exec msw init public/` once, or the mocked app
  boots blank. It is gitignored deliberately — Vite copies `public/` into `dist`, and CI greps
  `dist` to prove MSW never reaches production.
- **The MSW import must stay inside `import.meta.env.DEV`.** Vite replaces that literal with `false`
  in a production build and Rollup drops the branch. Move it out and MSW ships to users.
- **Radix's toast needs pointer-capture APIs jsdom lacks** and makes the suite exit non-zero. The
  toast here is hand-rolled for that reason; `@radix-ui/react-toast` is currently an unused
  dependency. Dialogs, menus, tabs and tooltips do use Radix and work fine.
- **`pdfjs-dist` is pinned to the exact version `react-pdf` depends on** (4.8.69) and declared
  directly, because pnpm's strict layout makes a transitive dependency unimportable — and two copies
  of pdf.js fail at runtime with an API/Worker version mismatch. The worker is a **pinned local
  asset**, never a CDN.
- **`localhost` resolves to `::1` first.** When a published port "can't be reached", try
  `http://127.0.0.1:5173`.
- TypeScript here is strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`: index
  access yields `T | undefined`, and `{ foo: undefined }` is not assignable to `{ foo?: string }`.
  Build the object conditionally rather than passing `undefined`.

## Tests

Vitest + React Testing Library + MSW. **Every component gets loading, empty, error and success** —
this is not thoroughness for its own sake: the brief ranks edge cases and error states first, so an
untested error state is an untested primary requirement.

Leaf components take data as props and are testable with no router and no query provider; only
pages and dialogs touch TanStack Query. Coverage gate is **80% statements** and CI enforces it.

Two things the suite structurally cannot check, so verify them by hand or leave them to e2e: styles
in `index.css` (vitest runs with `css: false`, so focus rings and `prefers-reduced-motion` are
inspection-only), and real viewport width (jsdom has none, so the tablet collapse is asserted on
layout classes plus "no value is dropped").
