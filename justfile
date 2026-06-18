# ---- verification ---------------------------------------------------------

# Lint + test + unused-deps. Post-change gate. Does NOT run sqlx-check: SQLite
# expression-column type inference isn't reproducible across hosts, so the
# offline build (test, with SQLX_OFFLINE) is the real cache gate. Regenerate
# the cache with `just sqlx-prepare` when you change a query.
[group('verify')]
verify: lint test unused-deps

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

# Build an ephemeral, schema-only DB and run `sqlx prepare {{mode}}` against it.
# An EMPTY (migrated, unseeded) DB is the deterministic prepare state: with no
# rows, SQLite type inference falls back to each column's declared affinity
# instead of the storage class of whatever row happened to be present. A seeded
# DB makes expression columns (MAX/COALESCE/CASE) data-dependent, e.g. an
# all-NULL aggregate infers `Null` instead of the schema's `Text`. The temp DB
# is created under mktemp and deleted on exit, so the dev DB is never touched.
_sqlx mode:
    #!/usr/bin/env bash
    set -euo pipefail
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    db="$tmp/prepare.db"
    SQLX_OFFLINE=true DATABASE_URL="sqlite://$db" SCHEMA_PATH=./config/schema.sql \
        cargo run -q -p migration-engine --bin migrate
    # sqlx-macros-core calls dotenvy::dotenv_override() which overwrites DATABASE_URL
    # from the nearest .env file even when the env var is already set. Placing a
    # crate-level .env that points at our fresh temp DB wins over the root .env.
    crate_env="crates/syllabus-tracker/.env"
    printf 'DATABASE_URL=sqlite://%s\n' "$db" > "$crate_env"
    trap 'rm -rf "$tmp"; rm -f "$crate_env"' EXIT
    DATABASE_URL="sqlite://$db" \
        cargo sqlx prepare {{mode}} --workspace -- -p syllabus-tracker --tests --all-features

# Regenerate .sqlx/ offline query metadata, including queries in test code.
# `--workspace` puts the cache at the workspace root and limits cargo-check
# to the macro-bearing crate via `-p syllabus-tracker`.
[group('verify')]
sqlx-prepare: (_sqlx "")

# Advisory: check whether the .sqlx/ cache matches a fresh prepare. NOT part of
# `just verify` or CI, because SQLite expression-column inference varies by host
# (see launchbadge/sqlx#1737) and false-fails. Useful as a local sanity check.
[group('verify')]
sqlx-check: (_sqlx "--check")

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
# `vite_env` sets the frontend's VITE_ENVIRONMENT (feature-gate key); leave the
# default for normal dev, or use `dev-prod` to preview production-gated UI.
[group('run')]
dev vite_env="development": migrate
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
    # Override the dev.env VITE_ENVIRONMENT so `dev-prod` can run the full stack
    # with production feature gates (e.g. the in-progress camps/competitions UI
    # hidden). Defaults to development, so plain `just dev` is unchanged.
    export VITE_ENVIRONMENT={{ vite_env }}

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

# Native dev loop (backend + frontend + infra) with production feature gates,
# so the in-progress camps/competitions UI is hidden. Same stack as `dev`.
[group('run')]
dev-prod: (dev "production")

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

# Frontend dev server with VITE_ENVIRONMENT=production, so production feature
# gates apply (e.g. the in-progress camps/competitions UI is hidden). Use to
# preview the prod-gated UI locally without a full build.
[group('frontend')]
fe-dev-prod:
    cd frontend && VITE_ENVIRONMENT=production pnpm dev

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

# One-shot idempotent historical activity backfill. Run once at deploy.
[group('db')]
backfill-activity: migrate
    SQLX_OFFLINE=true DATABASE_URL=sqlite://data/sqlite.db SCHEMA_PATH=./config/schema.sql \
        cargo run -p syllabus-tracker --bin backfill_activity

# One-shot idempotent cursor seeding at deploy. Run after backfill-activity.
[group('db')]
init-activity-cursors: migrate
    SQLX_OFFLINE=true DATABASE_URL=sqlite://data/sqlite.db SCHEMA_PATH=./config/schema.sql \
        cargo run -p syllabus-tracker --bin init_activity_cursors

# One-shot idempotent backfill of the two legacy video-visibility tables into
# video_visibility_overrides. MUST run BEFORE `just migrate` drops them (so it
# deliberately does NOT depend on migrate). Safe to re-run.
[group('db')]
backfill-video-visibility:
    SQLX_OFFLINE=true DATABASE_URL=sqlite://data/sqlite.db SCHEMA_PATH=./config/schema.sql \
        cargo run -p syllabus-tracker --bin backfill_video_visibility

# Wipe just the attempts table then reseed (keeps users/techniques).
[group('db')]
reseed-attempts:
    sqlite3 data/sqlite.db "DELETE FROM attempts;"
    just seed

# ---- infra ----------------------------------------------------------------

# Decrypt the passphrase-protected age key and cache it in tmpfs
# (/dev/shm) for the rest of the boot. Subsequent sops invocations
# pick the cache up automatically. Shell-agnostic: works the same in
# bash, zsh, nushell, fish.
#
# Cache file is 600-perm and lives in RAM only (gone on reboot, gone on
# `just lock`). Never written to persistent storage.
[group('infra')]
unlock:
    #!/usr/bin/env bash
    set -euo pipefail
    age -d ~/.config/sops/age/keys.txt.age > /dev/shm/sops-age-key-$(id -u)
    chmod 600 /dev/shm/sops-age-key-$(id -u)
    echo "unlocked at /dev/shm/sops-age-key-$(id -u); run \`just lock\` to clear"

# Wipe the cached age key from /dev/shm. Next sops call will prompt
# for the passphrase again.
[group('infra')]
lock:
    @rm -f /dev/shm/sops-age-key-$(id -u) 2>/dev/null && echo "locked" || echo "already locked"

# ---- remote ops (shared prod/staging host) --------------------------------
#
# One-off SSH + docker/sqlite against the shared VM that runs both stacks.
# Requires your deploy SSH key loaded locally. The host (SILLYBUS_SSH_HOST) is
# exported by the flake dev shell; its value comes from the IaC (infra tofu
# output `_platform_vm_ip`). Refresh it with `just update-ssh-host`, then
# re-enter the dev shell. The `deploy` user runs docker without sudo, so these
# need no root. The DB is the `*_app-data` named volume, holding `sqlite.db` at
# its root; we reach it with a throwaway sqlite3 container mounting that volume
# (no sqlite3 needed on the host).
#
#   just update-ssh-host                          # one-time / when the IP changes
#   just db-sql-staging 'SELECT count(*) FROM activity;'
#   just db-sql-prod    'DELETE FROM activity;'   # prompts to confirm
#   just remote 'docker ps'

ssh_host := env_var_or_default("SILLYBUS_SSH_HOST", "")
ssh_user := env_var_or_default("SILLYBUS_SSH_USER", "deploy")
sqlite_image := "keinos/sqlite3:latest"

# Refresh SILLYBUS_SSH_HOST in flake.nix from the IaC (tofu _platform_vm_ip).
[group('remote')]
update-ssh-host:
    #!/usr/bin/env bash
    set -euo pipefail
    # Source of truth is infra tofu (needs it initialised, R2 creds in env).
    # Re-enter `nix develop` afterward to pick up the new value.
    ip="$(tofu -chdir=infra output -raw _platform_vm_ip)"
    [ -n "$ip" ] || { echo "tofu returned an empty _platform_vm_ip"; exit 1; }
    sed -i -E 's|SILLYBUS_SSH_HOST = "[^"]*";|SILLYBUS_SSH_HOST = "'"$ip"'";|' flake.nix
    echo "flake.nix SILLYBUS_SSH_HOST = $ip  (re-enter the dev shell to apply)"

[group('remote')]
[private]
_require-host:
    @test -n "{{ssh_host}}" || { echo "Host unset. Run 'just update-ssh-host' then re-enter the dev shell (or export SILLYBUS_SSH_HOST)."; exit 1; }

# Run an arbitrary command on the shared host, e.g. `just remote 'docker ps'`.
[group('remote')]
remote *cmd: _require-host
    ssh {{ssh_user}}@{{ssh_host}} {{quote(cmd)}}

# Internal: pipe SQL (stdin) to a stack's sqlite DB volume.
[group('remote')]
[private]
_db-sql vol sql:
    #!/usr/bin/env bash
    set -euo pipefail
    printf '%s\n' {{quote(sql)}} | ssh {{ssh_user}}@{{ssh_host}} \
      "docker run --rm -i -v {{vol}}:/data --entrypoint sqlite3 {{sqlite_image}} /data/sqlite.db"

# Run SQL against the STAGING database.
[group('remote')]
db-sql-staging sql: _require-host (_db-sql "sillybus-staging_app-data" sql)

# Interactive sqlite shell on STAGING.
[group('remote')]
db-shell-staging: _require-host
    ssh -t {{ssh_user}}@{{ssh_host}} "docker run --rm -it -v sillybus-staging_app-data:/data --entrypoint sqlite3 {{sqlite_image}} /data/sqlite.db"

# Run SQL against the PROD database. Prompts for confirmation first.
[group('remote')]
db-sql-prod sql: _require-host
    #!/usr/bin/env bash
    set -euo pipefail
    echo "About to run against PROD:"
    printf '  %s\n' {{quote(sql)}}
    read -r -p "Type 'prod' to continue: " ok
    [ "$ok" = "prod" ] || { echo "aborted"; exit 1; }
    printf '%s\n' {{quote(sql)}} | ssh {{ssh_user}}@{{ssh_host}} \
      "docker run --rm -i -v sillybus_app-data:/data --entrypoint sqlite3 {{sqlite_image}} /data/sqlite.db"

# Interactive sqlite shell on PROD.
[group('remote')]
db-shell-prod: _require-host
    ssh -t {{ssh_user}}@{{ssh_host}} "docker run --rm -it -v sillybus_app-data:/data --entrypoint sqlite3 {{sqlite_image}} /data/sqlite.db"

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
