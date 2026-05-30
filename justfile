default:
    @just --list

build:
    docker build --target production -t syllabus-tracker:latest .
    docker build --target production -t syllabus-tracker-frontend:latest ./frontend

up:
    docker compose up -d --build

dev:
    docker compose up --build

stop:
    docker compose stop

down:
    docker compose down

# Idempotent. Inserts demo users, techniques, collections, assignments, and
# attempts. Existing rows (matched by name/username/student_technique) are
# skipped so re-running won't duplicate.
seed:
    DATABASE_URL=sqlite://sqlite.db SCHEMA_PATH=./config/schema.sql \
        cargo test --bin syllabus-tracker -- --ignored --nocapture seed_demo_data

# Wipe just the attempts and reseed them. Useful when you want a fresh
# distribution without resetting users or techniques.
reseed-attempts:
    sqlite3 sqlite.db "DELETE FROM attempts;"
    just seed

# Wipe all data from the database. Schema is preserved; rerun `just seed`
# afterwards to repopulate demo data.
clean:
    sqlite3 sqlite.db "DELETE FROM attempts; \
        DELETE FROM technique_tags; \
        DELETE FROM tags; \
        DELETE FROM collection_techniques; \
        DELETE FROM student_techniques; \
        DELETE FROM collections; \
        DELETE FROM techniques; \
        DELETE FROM invite_tokens; \
        DELETE FROM user_sessions; \
        DELETE FROM users;"

# Frontend commands. All run from the frontend/ folder.
fe-dev:
    cd frontend && pnpm dev

fe-build:
    cd frontend && pnpm build

fe-lint:
    cd frontend && pnpm lint

fe-typecheck:
    cd frontend && pnpm exec tsc -b

fe-install:
    cd frontend && pnpm install
