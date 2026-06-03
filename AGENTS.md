# Agent guide

Common commands for working on this repo. Run from the repo root unless noted.

## Verification gate (run after every change)

| Step | Command |
| --- | --- |
| Inner loop (no DB needed) | `just check-fast` |
| Full gate | `just verify` |
| Lint (backend clippy + frontend eslint, with typecheck) | `just lint` |
| Tests (backend cargo test + frontend stub) | `just test` |
| Sqlx offline cache fresh? | `just sqlx-check` |
| Sqlx offline cache rebuild | `just sqlx-prepare` |
| Unused dependency scan | `just unused-deps` |

`just check-fast` is `lint + test` only, no live DB required. `just verify` adds `sqlx-check` and `unused-deps` on top. If `sqlx-check` fails, you changed a query and need to run `just sqlx-prepare` (requires a live `sqlite.db` with the migrated schema, e.g. after `just dev` has run once).

Both sqlx recipes pass `-- --tests` so queries inside `#[cfg(test)]` modules are included in the cache.

## Git hooks (lefthook)

Hooks are managed by [lefthook](https://github.com/evilmartians/lefthook). Lefthook itself is provided by `nix develop` (the dev flake), so there is nothing to install separately.

After cloning, run once:

```
just install-hooks
```

This writes stubs into `.git/hooks/` that delegate to `lefthook.yml`. The current pre-commit config:

- `*.rs` staged: runs `just lint-backend` and `just test-backend` in parallel.
- `frontend/**/*.{ts,tsx,js,jsx,cjs,mjs}` staged: runs `just lint-frontend`.
- Nothing matching: skipped entirely.

Bypass everything with `git commit --no-verify`. Edit `lefthook.yml` to change what runs.

## Cross-cutting

| Task | Command |
| --- | --- |
| Run all tests | `just test` |
| Lint everything | `just lint` |
| Typecheck (frontend) | `just typecheck` |
| Format Rust code | `just fmt` |

Rust typechecks implicitly on build/test, so `just typecheck` only covers the frontend. `just lint-frontend` runs typecheck first, so eslint findings sit alongside type errors.

## Frontend (`frontend/`)

| Task | Command |
| --- | --- |
| Typecheck | `just typecheck` |
| Lint (includes typecheck) | `just lint-frontend` |
| Test | `just test-frontend` |
| Build | `just fe-build` |
| Dev server | `just fe-dev` |
| Install deps | `just fe-install` |

Notes:
- `just typecheck` wraps `tsc -b`, which prints nothing on success and exits 0. Trust the exit code; no output means types are clean.
- No frontend test suite exists yet; `just test-frontend` is a stub.

## Backend (Rust)

| Task | Command |
| --- | --- |
| Lint | `just lint-backend` |
| Test | `just test-backend` |
| Build | `SQLX_OFFLINE=true cargo build --release` (or `just build` for docker images) |
| Format | `just fmt` |
| Sqlx prepare | `just sqlx-prepare` |

Notes:
- All cargo invocations in justfile recipes set `SQLX_OFFLINE=true` so they use the cached query metadata in `.sqlx/` and do not need a live database.
- After changing any `sqlx::query!` SQL, run `just sqlx-prepare` to refresh `.sqlx/`. `just sqlx-check` (part of `just verify`) will fail loudly if you forget.

## Running the app
AI agents are not expected to run these commands, ever. They are documented here for agents to understand as context, to be able to inform users about.

| Task | Command |
| --- | --- |
| Local dev (docker) | `just dev` |
| Stop | `just stop` |
| Apply schema to local data/sqlite.db | `just migrate` |
| Apply schema, allow destructive changes | `just migrate-destructive` |
| Seed demo data | `just seed` |
| Wipe local data/ and build artifacts | `just clean` |

`just dev` boots the full stack via docker compose. It chains through `migrate` first so the host's `data/sqlite.db` is created and in sync before docker starts the app. `just clean && just dev` (or `just clean && just seed`) is the full reset cycle.

The local SQLite DB lives under `./data/` (parent dir, not a single file) so the WAL sidecars (`sqlite.db-wal`, `sqlite.db-shm`) stay co-located with the main DB. WAL mode is on by default, set via `PRAGMA journal_mode=WAL` in both the app and the migrate binary's pool.

`migrate` and `seed` are implemented as dedicated bins under `src/bin/`. The `migrate` bin also ships in the production image and is invoked by the deploy pipeline's dedicated `migrate_database` job, which dry-runs against a copy of the prod DB then applies against the real one. The main `syllabus-tracker` binary does **not** self-heal or migrate on boot: it panics if the live DB schema does not match `config/schema.sql`. Migration is the migrate binary's job, exclusively.

## Disaster recovery

Production SQLite is replicated continuously to Cloudflare R2 via a Litestream sidecar (`docker-compose.nixos.yml`). See [`docs/BACKUPS.md`](docs/BACKUPS.md) for the architecture, restore procedure, and quarterly drill checklist.

## Feature flags

`VIDEOS_ENABLED` is a runtime env var read at startup, not a cargo feature, so all video code is always compiled and linted regardless of the flag's state.

Both branches are exercised by the test suite on every `cargo test`:

- **Enabled branch**: `setup_test_client(test_db)` in `src/test/utils.rs` builds Rocket with a mocked `VideoStack`. All existing tests in `src/test/videos.rs` run against this path.
- **Disabled branch**: `setup_test_client_with(test_db, false)` builds Rocket with `stack = None`. `src/test/feature_flags.rs` asserts that `/api/capabilities` reports `videos: false` and that representative video routes return 404 (i.e. genuinely unmounted).

When adding a new runtime feature flag, follow the same pattern: parameterize the test setup, then write a small `feature_flags.rs`-style test pair that locks in both the working surface and the hidden surface.

## Conventions

- No em-dashes in copy. Use commas, periods, or parentheses.
- Prefer editing existing files over creating new ones.
- UI work belongs under `frontend/src/` and follows the shadcn/ui + Tailwind v4 + RHF/Zod pattern (see the `shadcn-ui-design` skill).
- Migrations: `config/schema.sql` is the canonical schema. The dedicated `migrate` binary is the only thing that applies it; the app panics on boot if the live schema doesn't match.

## Frontend / TypeScript

### Types

- **Never use `any`.** If `tsc` or eslint demands a type, write the real one.
- **Never use `unknown`.** If a value has no compile-time shape, give the producer a real type rather than punting to the consumer.
- **Never use `as Type` typecasts.** Use type guards, discriminated unions, or fix the source's type so the cast isn't needed. `as const` is fine, it narrows literals without weakening safety.
- **Optional vs nullable: pick a side.** Don't mark a field `field?: T` just to dodge "the backend might not send it". If the field is sometimes absent, write `field: T | null` so call sites are forced to handle the null branch.
- **Use `T[]` over `Array<T>`.** Matches the existing convention.
- **API response shapes belong in `frontend/src/lib/api.ts`** and are imported by consumers. Don't redeclare a local `interface` that mirrors a backend response.

### File and component layout

- **One file per concern for hot reload**: a `.tsx` file should export only components. Move hooks, contexts, constants, and `cva` variant configs to a sibling `*-context.ts` / `*-variants.ts` file. (eslint's `react-refresh/only-export-components` enforces this.)
- **One top-level component per file**, unless a sibling is a small private helper used only in the same file. Keeps imports clean and hot reload working.
- **Props types stay co-located** with their component (declared just above it). Don't move them to a shared types file just because they're "shared looking".
- **`function Foo()` over `const Foo = () =>`** for top-level components, matching the shadcn-ui convention used throughout the codebase.
- **No barrel re-exports** (`index.ts` files that re-export a folder's contents). They break tree-shaking and confuse react-refresh.

### API helpers and error handling

- **`catch` clauses that don't use the error should be bare**: `} catch { ... }`, not `} catch (e) { ... }` with `e` unused.
- **Pick fire-and-forget or throw for each `lib/api.ts` helper, and stick to it.** Best-effort calls (e.g. analytics pings, `markStudentTechniqueSeen`) catch internally and return `void`. Calls the user must know about either throw or return `Response`/`null` so callers can react. Don't mix the two in one function.
