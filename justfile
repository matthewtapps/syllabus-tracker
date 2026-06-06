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
    SQLX_OFFLINE=true cargo clippy --workspace --all-targets --all-features -- -D warnings

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
    SQLX_OFFLINE=true cargo nextest run --workspace --all-features

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
# `--workspace` puts the cache at the workspace root and limits cargo-check
# to the macro-bearing crate via `-p syllabus-tracker`.
[group('verify')]
sqlx-prepare:
    DATABASE_URL=sqlite://data/sqlite.db cargo sqlx prepare --workspace -- -p syllabus-tracker --tests --all-features

# Fail if the .sqlx/ cache is stale. Used by `just verify`.
[group('verify')]
sqlx-check:
    DATABASE_URL=sqlite://data/sqlite.db cargo sqlx prepare --check --workspace -- -p syllabus-tracker --tests --all-features

# ---- app / docker ---------------------------------------------------------

# Build production docker images for backend and frontend.
[group('run')]
build:
    docker build --target production -t syllabus-tracker:latest .
    docker build --target production -t syllabus-tracker-frontend:latest ./frontend

# Production-like stack: builds the `production` Dockerfile targets for app
# and frontend, fronts them with nginx on http://localhost:8080, and points
# S3 at the local MinIO container. The host's sqlite.db is bind-mounted so
# this sees the same data as `just dev`. Depends on `migrate` to ensure the
# host db file exists before docker tries to bind-mount it.
[group('run')]
up: migrate
    docker compose up -d --build

# Native dev loop. Brings up only the supporting infra in docker (minio,
# minio-init, otel-collector) and runs the backend + frontend on the host so
# we reuse the warm `target/` cache instead of recompiling inside a container.
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

    (cd frontend && pnpm install && pnpm dev --host) &
    FRONTEND_PID=$!
    cargo watch -x run &
    WATCHER_PID=$!

    cleanup() {
        trap - INT TERM EXIT
        # cargo-watch spawns its run target in its own process group, so a plain
        # `kill 0` on the script's group dies before reaching the rust binary
        # and we orphan a backend on :8000. Signal the tracked PIDs, then sweep
        # any leftover backend by its known dev-build path.
        kill -TERM $FRONTEND_PID $WATCHER_PID 2>/dev/null
        pkill -TERM -f target/debug/syllabus-tracker 2>/dev/null
        wait 2>/dev/null
        docker compose stop minio minio-init otel-collector 2>/dev/null
    }
    trap cleanup INT TERM EXIT

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

# Apply config/schema.sql to the local data/sqlite.db. Creates the DB file
# (and the data/ parent dir) if missing. Refuses destructive changes (drops);
# use `migrate-destructive` for those.
[group('db')]
migrate:
    mkdir -p data
    SQLX_OFFLINE=true DATABASE_URL=sqlite://data/sqlite.db SCHEMA_PATH=./config/schema.sql \
        cargo run -p migration-engine --bin migrate

# As `migrate`, but permits dropping tables, columns, and indices. Use after
# a destructive schema change so the app boot doesn't panic on the diff.
[group('db')]
migrate-destructive:
    mkdir -p data
    SQLX_OFFLINE=true ALLOW_DESTRUCTIVE_MIGRATIONS=true \
        DATABASE_URL=sqlite://data/sqlite.db SCHEMA_PATH=./config/schema.sql \
        cargo run -p migration-engine --bin migrate

# Idempotent demo seed (users, techniques, collections, assignments, attempts).
# Runs `migrate` first so a freshly-cleaned DB bootstraps cleanly.
[group('db')]
seed: migrate
    SQLX_OFFLINE=true DATABASE_URL=sqlite://data/sqlite.db SCHEMA_PATH=./config/schema.sql \
        cargo run -p syllabus-tracker --bin seed

# Wipe just the attempts table then reseed (keeps users/techniques).
[group('db')]
reseed-attempts:
    sqlite3 data/sqlite.db "DELETE FROM attempts;"
    just seed

# ---- infra ----------------------------------------------------------------

# Run OpenTofu in infra/tofu/ with CLOUDFLARE_API_TOKEN and GITHUB_TOKEN
# sourced from .secrets.env. Default action is `plan`; pass anything else,
# e.g. `just tf init`, `just tf apply`, `just tf output`.
[group('infra')]
tf *cmd="plan":
    #!/usr/bin/env bash
    set -euo pipefail
    if [ ! -f .secrets.env ]; then
        echo "missing .secrets.env (need CLOUDFLARE_API_TOKEN, GITHUB_TOKEN); see .secrets.template.env" >&2
        exit 1
    fi
    set -a
    source .secrets.env
    set +a
    if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
        echo "CLOUDFLARE_API_TOKEN not set in .secrets.env" >&2
        exit 1
    fi
    if [ -z "${GITHUB_TOKEN:-}" ]; then
        echo "GITHUB_TOKEN not set in .secrets.env (need a fine-scoped PAT with Actions: Read and write)" >&2
        exit 1
    fi
    cd infra/tofu
    tofu {{cmd}}

# Open infra/tofu/secrets.enc.yaml in $EDITOR via sops, transparently
# decrypting on open and re-encrypting on save. Requires an age key at
# ~/.config/sops/age/keys.txt; see infra/tofu/README.md.
[group('infra')]
sops:
    sops infra/tofu/secrets.enc.yaml

# ---- housekeeping ---------------------------------------------------------

# Delete local sqlite files and build artifacts (cargo target/, frontend
# dist/). Leaves node_modules and frontend/node_modules/.vite alone; if those
# get into a bad state, remove them by hand. Next `just dev` recreates
# everything.
[group('housekeeping')]
clean:
    rm -rf data
    rm -rf target frontend/dist

# ---- hooks ----------------------------------------------------------------

# Install lefthook git hooks into this clone. Run once after cloning.
[group('hooks')]
install-hooks:
    lefthook install
    @echo "Hooks installed. See lefthook.yml for what runs on each commit."
