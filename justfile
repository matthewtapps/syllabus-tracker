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

# Backend clippy with warnings as errors. `--all-features` turns on the
# `test-support` feature so the bin's tests can see helpers gated behind it.
[group('verify')]
lint-backend:
    SQLX_OFFLINE=true cargo clippy --all-targets --all-features -- -D warnings

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
    SQLX_OFFLINE=true cargo nextest run --all-features

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
    DATABASE_URL=sqlite://sqlite.db cargo sqlx prepare -- --tests --all-features

# Fail if the .sqlx/ cache is stale. Used by `just verify`.
[group('verify')]
sqlx-check:
    DATABASE_URL=sqlite://sqlite.db cargo sqlx prepare --check -- --tests --all-features

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

# Native dev loop. Brings up only the supporting infra in docker (minio,
# minio-init, otel-collector) and runs the backend + frontend on the host so
# we reuse the warm `target/` cache instead of recompiling inside a container.
# `just up` still runs the full dockerised stack if you need to test the image.
[group('run')]
dev: migrate
    #!/usr/bin/env bash
    set -uo pipefail
    docker compose up -d minio minio-init otel-collector

    set -a
    source config/common.env
    source config/dev.env
    [ -f .secrets.env ] && source .secrets.env
    set +a
    # The env files target the docker network; rewrite to localhost for native.
    export S3_ENDPOINT=http://localhost:9000
    export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317

    cleanup() {
        trap - INT TERM EXIT
        kill 0
    }
    trap cleanup INT TERM EXIT

    (cd frontend && pnpm install && pnpm dev --host) &
    cargo watch -x run &
    wait -n

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

# Apply config/schema.sql to the local sqlite.db. Creates the DB file if
# missing. Refuses destructive changes (drops); use `migrate-destructive` for
# those.
[group('db')]
migrate:
    SQLX_OFFLINE=true DATABASE_URL=sqlite://sqlite.db SCHEMA_PATH=./config/schema.sql \
        cargo run --bin migrate

# As `migrate`, but permits dropping tables, columns, and indices. Use after
# a destructive schema change so the app boot doesn't panic on the diff.
[group('db')]
migrate-destructive:
    SQLX_OFFLINE=true ALLOW_DESTRUCTIVE_MIGRATIONS=true \
        DATABASE_URL=sqlite://sqlite.db SCHEMA_PATH=./config/schema.sql \
        cargo run --bin migrate

# Idempotent demo seed (users, techniques, collections, assignments, attempts).
# Runs `migrate` first so a freshly-cleaned DB bootstraps cleanly.
[group('db')]
seed: migrate
    SQLX_OFFLINE=true DATABASE_URL=sqlite://sqlite.db SCHEMA_PATH=./config/schema.sql \
        cargo run --bin seed

# Wipe just the attempts table then reseed (keeps users/techniques).
[group('db')]
reseed-attempts:
    sqlite3 sqlite.db "DELETE FROM attempts;"
    just seed

# Delete the local sqlite files. Next `just migrate` or `just dev` will
# recreate and migrate.
[group('db')]
clean:
    rm -f sqlite.db sqlite.db-shm sqlite.db-wal

# ---- hooks ----------------------------------------------------------------

# Install lefthook git hooks into this clone. Run once after cloning.
[group('hooks')]
install-hooks:
    lefthook install
    @echo "Hooks installed. See lefthook.yml for what runs on each commit."
