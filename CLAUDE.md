# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An AI coding-tool **token usage tracker**. Developers run a local collector (the `skill/`
package) that scans Claude Code / Codex CLI logs (and prompts for Cursor), aggregates token
usage by `(date, tool, model, project)`, and uploads it to this Next.js server via a Bearer
token. The server stores usage in Postgres and renders dashboards with self / team / admin
scopes.

## Commands

This is a **pnpm workspace** (`pnpm` only — never `npm`). Root is the Next.js app; `skill/`
is a second workspace package with its own scripts and test config.

```bash
pnpm install                 # installs root + skill deps
docker compose up -d db      # local Postgres on host port 5432

pnpm dev                     # Next dev server (localhost:3000)
pnpm build                   # next build
pnpm lint                    # next lint

pnpm prisma:migrate          # prisma migrate dev (create/apply migration locally)
pnpm prisma:deploy           # prisma migrate deploy (apply existing migrations)
pnpm prisma:generate         # regenerate client after schema.prisma changes
pnpm db:seed                 # seed admin user from ADMIN_* env vars

# Tests (root app) — require a running Postgres; see Testing below
pnpm test                    # vitest run
pnpm test:watch
pnpm exec vitest run tests/integration/usage.test.ts          # single file
pnpm exec vitest run -t "name of test"                        # single test by name

# Tests (skill package) — pure unit, no DB
pnpm --filter @dev-efficiency/skill test
```

## Architecture

### Three-layer server code (`src/lib/`)
Keep this separation when adding features:

- **`services/`** — pure business logic. Every function takes `prisma: PrismaClient` as its
  first arg (not the global) so it can be unit/integration tested with a real DB. This is
  where authorization and data-shaping live.
- **`actions/`** — `"use server"` server actions. Thin wrappers: call
  `requireApprovedUser()`, delegate to a service, `revalidatePath`, and return
  `{ ok, error }` bags. Don't put business logic here.
- **API routes** (`src/app/api/`) — for machine clients. `/api/v1/usage` (POST) and
  `/api/v1/me` authenticate with `resolveBearerUser()` against `AuthToken.tokenHash`.

### Auth — two distinct mechanisms
- **Browser**: iron-session sealed cookie (`de_session`). `src/middleware.ts` gates
  `/dashboard`, `/admin`, `/teams`, `/invite` (redirects to `/login`, and non-admins off
  `/admin`). Inside server code, `requireApprovedUser()` re-checks the user is `approved`.
- **Collector / API**: `Authorization: Bearer <token>`; tokens are stored hashed
  (`hashToken`), checked for `revokedAt` and `user.status === "approved"`.

Both the middleware and `session.ts` read `SESSION_SECRET` and fall back to the same
dev-only default — they must stay in sync.

### Routing (App Router)
Route groups: `(app)/` = authenticated pages (dashboard, teams, admin), `(auth)/` =
login/register. Charts live in `src/components/charts/`; shadcn/ui primitives in
`src/components/ui/` (configured via `components.json`, Tailwind v4).

### Tool enum mapping
DB/code uses `claude_code` etc.; the API/wire format uses `claude-code`. Always convert at
the boundary with `toolFromApi` / `toolToApi` in `src/lib/tool.ts` — never hardcode either form.

## Critical invariants

- **Privacy (collector)**: the upload schema (`skill/src/types.ts`, zod `.strict()`) is the
  closed allow-list of fields that may leave a developer's machine. Parsers must **never**
  read message content / text / input fields — only token counts and metadata. Don't widen
  this schema casually.
- **Privacy (metrics)**: in `services/metrics.ts`, `effectiveScope` *silently clamps* a
  member's queries to their own `userId` (a forged `userId` is ignored, not rejected). Team
  scope, by contrast, validates membership and overrides `opts.userId`. See the comments
  there before touching scope logic.
- **Idempotent ingest**: usage is upserted on the unique key
  `(userId, date, tool, model, project, source)`. Re-running the collector must not
  double-count. `totalTokens` is derived (input + output + cacheCreation + cacheRead) — keep
  it consistent on every write.
- **BigInt token columns**: token counts are `BigInt` in Prisma. Convert with `BigInt(...)`
  on write and be deliberate about serialization on read.

## Testing notes

- Root tests use Vitest in `node` env with `fileParallelism: false`. `tests/setup/global.ts`
  loads `.env.test` and runs `prisma migrate deploy` once against the **test database** —
  point `.env.test`'s `DATABASE_URL` at a separate DB (e.g. `dev_efficiency_test`).
  Integration tests hit a real Postgres; have `docker compose up -d db` running first.
- The root `vitest.config.ts` and `tsconfig.json` both **exclude `skill/`** — the skill
  package is compiled and tested in isolation with its own configs.

## Collector (`skill/`)

`bin/dev-efficiency-collect.ts` → `src/cli.ts`. `--init` writes
`~/.config/dev-efficiency/config.json` (0600) with server URL + token. No flags = scan
`backfillDays`, aggregate, upload. `--dry-run` prints without uploading. Parsers in
`src/parsers/` stream JSONL line-by-line. Codex: take only the **last** `token_count` event
per session to avoid cumulative double-counting. See `skill/README.md` for details.

## Specs & plans

Design specs and implementation plans live in `docs/superpowers/` (`specs/`, `plans/`). The
four build phases (server core, dashboard, teams, skill collector) are all merged to master.
