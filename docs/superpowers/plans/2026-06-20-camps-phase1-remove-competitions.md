# Camps Phase 1: Remove Competitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the competitions/matches/registrations subsystem entirely from schema, backend, frontend, and seed, leaving the generic camp intact.

**Architecture:** Pure destructive removal. Competitions are gated off production (`campsUiEnabled`), so no production data exists; `config/schema.sql` is declarative and the migration engine drops the tables. Work proceeds layer by layer (frontend, then backend route → db → model → schema), keeping the workspace compiling and green after every task.

**Tech Stack:** Rust (Rocket, sqlx, SQLite), migration-engine (declarative), React 19 + Vite + TanStack Query, `cargo nextest`, `just`.

**Spec:** `docs/superpowers/specs/2026-06-20-camps-redesign-remove-competitions-design.md`

---

## Conventions for every task

- Backend build/test runs offline against cached sqlx metadata:
  `nix develop .#ci --command env SQLX_OFFLINE=true cargo nextest run --workspace --all-features`
  (a plain `SQLX_OFFLINE=true cargo nextest run --workspace --all-features` also works on this box).
- After **any** change to a sqlx query (added/removed/edited), regenerate the
  cache: `nix develop .#ci --command just sqlx-prepare`. Never run bare
  `cargo sqlx prepare` against the seeded dev DB. (Pure deletions leave stale
  `.sqlx` files that are harmless, but regenerate at the end of the phase to
  prune them.)
- Commit messages: imperative, scoped, NO co-author trailer (repo convention,
  see `atomic-commits` skill). Example: `refactor(camps): drop competition link`.
- This work happens on a feature branch (currently `feat/camps-new`), not main.

---

## Task 1: Remove competition frontend

**Files:**
- Delete: `frontend/src/app/competitions/page.tsx`
- Delete: `frontend/src/app/competitions/[id]/page.tsx`
- Modify: `frontend/src/components/camp-summary-card.tsx`
- Modify: `frontend/src/lib/mutations.ts`
- Modify: `frontend/src/lib/queries.ts`
- Modify: `frontend/src/lib/query-keys.ts`
- Modify: `frontend/src/lib/entity-ref.ts`
- Modify: `frontend/src/components/navbar.tsx`, `frontend/src/components/bottom-nav.tsx`, `frontend/src/App.tsx`

- [ ] **Step 1: Inventory every competition/match reference in the frontend**

Run: `cd frontend && grep -rn -i "competition\|registration\|\bmatch\b\|match_id\|matchId" src --include=*.ts --include=*.tsx | grep -vi "matchMedia\|matchPath\|switch\|\.match(\|matches(" `
Expected: a list of usages across the files above. Treat this list as the worklist for this task.

- [ ] **Step 2: Delete the competition route files and their router entries**

Delete `frontend/src/app/competitions/page.tsx` and `frontend/src/app/competitions/[id]/page.tsx`. In `frontend/src/App.tsx` remove the `<Route>` entries that point at those pages and any now-unused imports.

- [ ] **Step 3: Remove competition/match nav + query + mutation + ref code**

Edit `navbar.tsx`, `bottom-nav.tsx` to drop competition links. In `lib/mutations.ts`, `lib/queries.ts`, `lib/query-keys.ts` remove the competition/registration/match query hooks, mutation hooks, and key factories. In `lib/entity-ref.ts` remove the `competition`/`match` entity-ref variants. In `components/camp-summary-card.tsx` remove the "competition camp" branch and any `competition`/`promote` UI so the card renders a plain camp.

- [ ] **Step 4: Typecheck and lint**

Run: `cd frontend && pnpm exec tsc -b && pnpm lint`
Expected: PASS, no references to competition/match symbols remain (re-run the Step 1 grep; expect no app-code hits).

- [ ] **Step 5: Commit**

```bash
git add frontend
git commit -m "feat(camps): remove competition UI from frontend"
```

---

## Task 2: Unmount competition + match routes (backend)

**Files:**
- Modify: `crates/syllabus-tracker/src/main.rs:56-66` (imports), `:396-413` (mount list)
- Modify: `crates/syllabus-tracker/src/lib.rs:8` (`pub mod competitions;`)
- Modify: `crates/syllabus-tracker/src/videos/routes.rs:299-330` (`api_match_video_upload`) and `:15` import
- Delete: `crates/syllabus-tracker/src/competitions/routes.rs` and its module dir

- [ ] **Step 1: Remove the competition/match route handlers from the mount list**

In `src/main.rs`, delete the `// competitions + matches` block from the `routes![...]` macro (the `api_create_competition` … `api_list_match_videos` entries, lines ~396-413) and the corresponding `use competitions::{...}` import block (~61-66). Remove `competitions` from the `use crate::{ ... }` module list (~5).

- [ ] **Step 2: Delete the competition route module**

Delete `src/competitions/routes.rs` (and the `competitions/` directory). Remove `pub mod competitions;` from `src/lib.rs`.

- [ ] **Step 3: Remove the match video upload route**

In `src/videos/routes.rs`, delete `api_match_video_upload` (the `#[post("/matches/<match_id>/videos/upload" ...)]` handler, ~299-330) and remove `use crate::db::matches::{can_manage_match, student_id_for_match};` (~15). Remove `api_match_video_upload` from the `routes![]` mount in `src/main.rs` if listed there.

- [ ] **Step 4: Build (expect remaining references to fail — that is the worklist)**

Run: `nix develop .#ci --command env SQLX_OFFLINE=true cargo build --workspace`
Expected: compile errors only from code still referencing `db::competitions` / `db::matches` (handled in Task 3). If errors appear outside those modules, note them for Task 3/4.

- [ ] **Step 5: Commit (after Task 3 makes it compile)** — defer commit; this task is not independently compiling. Proceed directly to Task 3, then commit both together.

---

## Task 3: Delete competition + match db modules, verbs, permissions

**Files:**
- Delete: `crates/syllabus-tracker/src/db/competitions.rs`, `crates/syllabus-tracker/src/db/matches.rs`
- Modify: `crates/syllabus-tracker/src/db/mod.rs` (module decls + re-exports)
- Modify: `crates/syllabus-tracker/src/db/activity.rs` (match/competition `Verb` variants + context kinds)
- Modify: `crates/syllabus-tracker/src/auth/permissions.rs` (`can_manage_match` and any competition/match permission helpers)

- [ ] **Step 1: Delete the db modules and their wiring**

Delete `src/db/competitions.rs` and `src/db/matches.rs`. In `src/db/mod.rs` remove `pub mod competitions;`, `pub mod matches;`, and any `pub use competitions::...` / `pub use matches::...` re-exports.

- [ ] **Step 2: Remove competition/match activity verbs**

Run: `grep -n "Verb::" crates/syllabus-tracker/src/db/activity.rs`
Identify the match/competition verbs (e.g. `MatchLogged`, `CompetitionRegistered`, `CompetitionCreated`, and any `promote`-related verb). Remove those enum variants, their `as_str`/`from_str` arms, and any context-kind strings (`'match'`, `'competition'`) the verbs used.

- [ ] **Step 3: Remove competition/match permission helpers**

In `src/auth/permissions.rs` remove `can_manage_match` and any competition/registration/match-specific permission functions. Leave `ManageCamps` and all camp/library permissions untouched.

- [ ] **Step 4: Build**

Run: `nix develop .#ci --command env SQLX_OFFLINE=true cargo build --workspace`
Expected: remaining errors only in `camps`, `models`, `videos` parent enum, and `activity` columns (handled in Task 4). No errors referencing `db::competitions` or `db::matches`.

- [ ] **Step 5: Commit (after Task 4 compiles)** — defer; proceed to Task 4.

---

## Task 4: Strip competition/match from camp, video, model, activity code

**Files:**
- Modify: `crates/syllabus-tracker/src/db/camps.rs` (`competition_id` field + queries; `references_camp_id` stays)
- Modify: `crates/syllabus-tracker/src/camps/routes.rs` (`api_promote_camp_to_competition`, camp_referenced_matches handling)
- Modify: `crates/syllabus-tracker/src/models.rs:203-270` (`camp_id`/`match_id` fields on the affected struct — remove `match_id` only)
- Modify: `crates/syllabus-tracker/src/db/videos.rs` (the `VideoParent` enum — remove the `Match` variant) and `crates/syllabus-tracker/src/db/mod.rs` re-exports
- Modify: `crates/syllabus-tracker/src/db/activity.rs` (the activity insert/read that writes `match_id`/`competition_id`)
- Modify: `crates/syllabus-tracker/src/db/activity_read.rs` (selects of `match_id`/`competition_id`)

- [ ] **Step 1: Remove `competition_id` from the `Camp` model and its queries**

In `src/db/camps.rs`: delete the `competition_id: Option<i64>` field from `struct Camp`, the `competition_id AS "competition_id?: i64"` select column in `get_camp` (and any other camp select), and the struct construction line `competition_id: r.competition_id`. Keep all `references_camp_id` code.

- [ ] **Step 2: Remove camp↔competition/match route logic**

In `src/camps/routes.rs` delete `api_promote_camp_to_competition` and any handler reading/writing `camp_referenced_matches` or `competition_id`. Remove the corresponding entries from the `routes![]` mount in `src/main.rs` and the `use camps::{...}` import.

- [ ] **Step 3: Remove the `Match` video parent and `match_id`/`competition_id` activity columns**

In `src/db/videos.rs` remove the `Match(i64)` variant from `VideoParent` and every `match`/`Match` arm in its `parent_kind()` / column-resolution helpers. In `src/db/activity.rs` and `src/db/activity_read.rs` remove `match_id` and `competition_id` from the `NewActivity` builder, the INSERT column list, and the SELECT projections. In `src/models.rs` remove the `match_id` field (keep `camp_id`).

- [ ] **Step 4: Build the whole workspace**

Run: `nix develop .#ci --command env SQLX_OFFLINE=true cargo build --workspace`
Expected: errors now only from sqlx queries that still name dropped columns/tables — those resolve when the schema and sqlx cache update in Task 5. If non-query Rust errors remain, fix them here.

- [ ] **Step 5: Commit Tasks 2-4 together (compiles after Task 5 cache regen)** — defer the commit to Task 5 Step 4, where the schema + sqlx cache make the workspace build clean. (Tasks 2-4 are one atomic backend removal; committing mid-way would leave a broken build.)

---

## Task 5: Drop competition schema and regenerate sqlx cache

**Files:**
- Modify: `config/schema.sql`
- Regenerate: `crates/syllabus-tracker/.sqlx/` (via `just sqlx-prepare`)

- [ ] **Step 1: Remove the competition/match schema objects**

In `config/schema.sql` delete:
- `CREATE TABLE ... competitions`, `competition_registrations`, `matches`, `match_techniques`, `camp_referenced_matches` (lines ~236-339 region) and their indexes.
- The `competition_id INTEGER REFERENCES competitions(id)` column on `camps` (~272).
- The `match_id` column, its CHECK arm, `idx_videos_match`, and `match_id` from the composite `idx_videos_*` index on `videos` (~140-191). Remove `'match'` from the `videos.parent_kind` CHECK `IN (...)` list (~132).
- `activity.match_id`, `activity.competition_id` columns and `idx_activity_match` (and any competition activity index) (~484-507).
- Any `'match'` / `'competition'` members left in activity context-kind CHECK lists.

- [ ] **Step 2: Apply the destructive migration locally**

Run: `just migrate-destructive`
Expected: the engine drops the removed tables/columns against `data/sqlite.db` with no FK-violation panic (no data depends on them). Output ends without error.

- [ ] **Step 3: Regenerate the sqlx offline cache**

Run: `nix develop .#ci --command just sqlx-prepare`
Expected: `.sqlx/` updated; stale competition/match query metadata pruned, no metadata for dropped columns remains.

- [ ] **Step 4: Build, then commit the whole backend removal (Tasks 2-5)**

Run: `nix develop .#ci --command env SQLX_OFFLINE=true cargo build --workspace`
Expected: PASS, clean build.

```bash
git add crates/syllabus-tracker config/schema.sql
git commit -m "feat(camps): remove competitions and matches from backend and schema"
```

---

## Task 6: Delete competition/match tests, add removal guard

**Files:**
- Delete: `crates/syllabus-tracker/src/test/competitions.rs`, `crates/syllabus-tracker/src/test/matches.rs`
- Modify: `crates/syllabus-tracker/src/test/mod.rs` (remove `pub mod competitions;`, `pub mod matches;`)
- Modify: `crates/syllabus-tracker/src/test/camps.rs` (add a guard test; fix any references to removed symbols)
- Modify: `crates/syllabus-tracker/src/test/videos.rs`, `.../threads.rs` (remove any match/competition references)

- [ ] **Step 1: Write the failing removal-guard test**

Add to the `mod tests` block in `crates/syllabus-tracker/src/test/camps.rs`:

```rust
#[rocket::async_test]
async fn competition_and_match_tables_are_gone() {
    use crate::test::test_utils::TestDbBuilder;
    let db = TestDbBuilder::new()
        .coach("coach_user", Some("Coach"))
        .student("student_user", Some("Sam"))
        .build()
        .await
        .unwrap();

    for table in ["competitions", "competition_registrations", "matches", "match_techniques", "camp_referenced_matches"] {
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = ?",
        )
        .bind(table)
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(count, 0, "table {table} should not exist");
    }

    let camp_competition_col: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pragma_table_info('camps') WHERE name = 'competition_id'",
    )
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(camp_competition_col, 0, "camps.competition_id should be dropped");

    let video_match_col: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pragma_table_info('videos') WHERE name = 'match_id'",
    )
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(video_match_col, 0, "videos.match_id should be dropped");
}
```

- [ ] **Step 2: Delete the obsolete test modules**

Delete `src/test/competitions.rs` and `src/test/matches.rs`. Remove `pub mod competitions;` and `pub mod matches;` from `src/test/mod.rs`. In `src/test/camps.rs`, `videos.rs`, `threads.rs` remove or update any test referencing competition/match symbols (the build errors point you to them).

- [ ] **Step 3: Run the full backend test suite**

Run: `nix develop .#ci --command env SQLX_OFFLINE=true cargo nextest run --workspace --all-features`
Expected: PASS, including the new `competition_and_match_tables_are_gone`. No remaining tests reference removed types.

- [ ] **Step 4: Commit**

```bash
git add crates/syllabus-tracker/src/test
git commit -m "test(camps): drop competition tests, guard competition removal"
```

---

## Task 7: Strip competition/match seed data

**Files:**
- Modify: `crates/syllabus-tracker/src/bin/seed.rs`

- [ ] **Step 1: Find and remove competition/match seeding**

Run: `grep -n -i "competition\|registration\|\bmatch\b\|match_techniques" crates/syllabus-tracker/src/bin/seed.rs`
Remove the blocks that create competitions, registrations, matches, match_techniques, camp_referenced_matches, or set `competition_id` on camps. Keep all generic camp seeding.

- [ ] **Step 2: Build the seed binary and reseed locally**

Run: `nix develop .#ci --command env SQLX_OFFLINE=true cargo build -p syllabus-tracker --bin seed`
Expected: PASS.
Run: `just seed`
Expected: seeds without referencing dropped tables; completes without error.

- [ ] **Step 3: Commit**

```bash
git add crates/syllabus-tracker/src/bin/seed.rs
git commit -m "chore(camps): remove competition data from seed"
```

---

## Task 8: Full verify

- [ ] **Step 1: Run the repo verify gate**

Run: `nix develop .#ci --command just verify`
Expected: lint (backend clippy + frontend), tests, unused-deps all PASS. (sqlx-check is intentionally excluded from CI/verify.)

- [ ] **Step 2: Final grep sweep for stragglers**

Run: `grep -rn -i "competition\|match_id\|registration" crates/syllabus-tracker/src config/schema.sql frontend/src --include=*.rs --include=*.sql --include=*.ts --include=*.tsx | grep -vi "matchMedia\|matchPath\|\.match(\|matches(\|switch\|MatchResult\|rematch"`
Expected: no functional competition/match references remain (residual code-comment mentions are acceptable; remove if trivial).

- [ ] **Step 3: Commit any cleanup, then open the PR**

```bash
git commit -am "chore(camps): final competition-removal cleanup" || true
```
Open a PR per the `ci-and-staging-deploy` skill. Note in the PR body that the prod deploy needs `allow_destructive_migrations=true` on workflow_dispatch (drops are destructive; prod has no rows behind these tables, so it is safe).

---

## Self-review notes

- Spec Phase 1 schema bullets → Task 5. Backend bullets → Tasks 2-4, 7. Frontend bullets → Task 1. `references_camp_id` retained → explicit in Task 4 Step 1. Acceptance (camp CRUD green, build/tests pass) → Tasks 6, 8.
- Backend Tasks 2-5 deliberately commit as one atomic unit because a compiled Rust workspace cannot land deletion in independently-compiling slices across module + schema + sqlx-cache boundaries. Each task still ends in a build checkpoint.
