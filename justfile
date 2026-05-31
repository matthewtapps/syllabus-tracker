[private]
default:
    @just help

# ---- help -----------------------------------------------------------------

# Show a curated, categorized command summary. For the full list use `just --list`.
help:
    @echo ""
    @echo "  Verify a change"
    @echo "    just check-fast      Inner loop: lint + test (no DB needed)"
    @echo "    just verify          Full gate: lint + test + sqlx-check + unused-deps"
    @echo ""
    @echo "  Lint / test / format"
    @echo "    just lint            Backend clippy + frontend eslint (with typecheck)"
    @echo "    just test            Backend cargo test + frontend stub"
    @echo "    just typecheck       Frontend tsc -b (silent on success)"
    @echo "    just fmt             cargo fmt --all"
    @echo "    just unused-deps     Scan Cargo.toml for unused crates"
    @echo ""
    @echo "  Sqlx offline cache"
    @echo "    just sqlx-prepare    Regenerate .sqlx/ from current queries (needs DB)"
    @echo "    just sqlx-check      Verify .sqlx/ is in sync (used by 'verify')"
    @echo ""
    @echo "  Run the app"
    @echo "    just dev             Boot full stack via docker compose"
    @echo "    just stop            docker compose stop"
    @echo "    just down            docker compose down"
    @echo "    just fe-dev          Frontend dev server only"
    @echo ""
    @echo "  Database"
    @echo "    just seed            Insert demo data (idempotent)"
    @echo "    just reseed-attempts Wipe attempts and reseed"
    @echo "    just clean           Delete local sqlite files"
    @echo ""
    @echo "  Hooks"
    @echo "    just install-hooks   Install lefthook pre-commit hook (run once per clone)"
    @echo ""
    @echo "For the full recipe list with all variants, run 'just --list'."

# ---- verification ---------------------------------------------------------

# Lint + test + sqlx-check + unused-deps. Post-change gate.
[group('verify')]
verify: lint test sqlx-check unused-deps

# Lint + test only. No live DB required.
[group('verify')]
check-fast: lint test

# Backend clippy + frontend eslint (with typecheck).
[group('verify')]
lint: lint-backend lint-frontend

# Backend clippy with warnings as errors.
[group('verify')]
lint-backend:
    SQLX_OFFLINE=true cargo clippy --all-targets -- -D warnings

# Runs typecheck first so type errors surface alongside ESLint findings.
[group('verify')]
lint-frontend: typecheck
    cd frontend && pnpm lint

# Frontend tsc -b. Rust typechecks implicitly via build/test.
[group('verify')]
typecheck:
    cd frontend && pnpm exec tsc -b

# All tests across backend and frontend.
[group('verify')]
test: test-backend test-frontend

# Backend tests. Uses cached sqlx query metadata so no live DB is needed.
[group('verify')]
test-backend:
    SQLX_OFFLINE=true cargo test --all-features

# Frontend tests. No suite exists yet; stub for when one does.
[group('verify')]
test-frontend:
    @echo "No frontend tests yet."

# Format Rust code with cargo fmt.
[group('verify')]
fmt:
    cargo fmt --all

# Scan Cargo.toml for unused dependencies (cargo-machete from the dev flake).
[group('verify')]
unused-deps:
    cargo machete

# Regenerate .sqlx/ offline query metadata, including queries in test code.
[group('verify')]
sqlx-prepare:
    DATABASE_URL=sqlite://sqlite.db cargo sqlx prepare -- --tests

# Fail if the .sqlx/ cache is stale. Used by `just verify`.
[group('verify')]
sqlx-check:
    DATABASE_URL=sqlite://sqlite.db cargo sqlx prepare --check -- --tests

# ---- app / docker ---------------------------------------------------------

# Build production docker images for backend and frontend.
[group('run')]
build:
    docker build --target production -t syllabus-tracker:latest .
    docker build --target production -t syllabus-tracker-frontend:latest ./frontend

# Start the full stack via docker compose in detached mode.
[group('run')]
up:
    docker compose up -d --build

# Boot the full stack with output attached, creating sqlite.db if missing.
[group('run')]
dev:
    @test -f sqlite.db || (echo "sqlite.db not found, creating empty file for app to migrate into" && touch sqlite.db)
    docker compose up --build

# Stop the docker compose stack.
[group('run')]
stop:
    docker compose stop

# Tear down the docker compose stack.
[group('run')]
down:
    docker compose down

# ---- frontend -------------------------------------------------------------

# Frontend dev server (vite).
[group('frontend')]
fe-dev:
    cd frontend && pnpm dev

# Build the frontend for production.
[group('frontend')]
fe-build:
    cd frontend && pnpm build

# Install frontend dependencies via pnpm.
[group('frontend')]
fe-install:
    cd frontend && pnpm install

# ---- database -------------------------------------------------------------

# Idempotent demo seed (users, techniques, collections, assignments, attempts).
[group('db')]
seed:
    DATABASE_URL=sqlite://sqlite.db SCHEMA_PATH=./config/schema.sql \
        cargo test --bin syllabus-tracker -- --ignored --nocapture seed_demo_data

# Wipe just the attempts table then reseed (keeps users/techniques).
[group('db')]
reseed-attempts:
    sqlite3 sqlite.db "DELETE FROM attempts;"
    just seed

# Delete the local sqlite files. Next `just dev` will recreate and migrate.
[group('db')]
clean:
    rm -f sqlite.db sqlite.db-shm sqlite.db-wal

# ---- hooks ----------------------------------------------------------------

# Install lefthook git hooks into this clone. Run once after cloning.
[group('hooks')]
install-hooks:
    lefthook install
    @echo "Hooks installed. See lefthook.yml for what runs on each commit."
