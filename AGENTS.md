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

| Task | Command |
| --- | --- |
| Local dev (docker) | `just dev` |
| Stop | `just stop` |
| Seed demo data | `just seed` |
| Wipe local sqlite | `just clean` |

`just dev` boots the full stack via docker compose. `just clean` then `just dev` then `just seed` is the full reset cycle.

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
- Migrations: `config/schema.sql` is the canonical schema. The app migrates the local sqlite file on boot.
