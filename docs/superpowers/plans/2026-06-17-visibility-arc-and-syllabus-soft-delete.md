# Video-visibility exclusive-arc + syllabus soft-delete — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the polymorphic `(scope_kind, scope_id)` reference in `video_visibility_overrides` with an exclusive-arc (typed FK columns + exactly-one CHECK) design, add a compiler-guided `VisibilityScope` enum, and convert `delete_syllabus` from a hard delete to a soft delete — so the override table is correct-by-construction (FK cascade) and the lone hard-delete anomaly is removed.

**Architecture:** Mirror the existing `videos.parent_kind` / `threads.anchor_kind` exclusive-arc pattern: keep `scope_kind` as the discriminator, replace the bare `scope_id` with four nullable typed FK columns (`student_id`, `syllabus_id`, `assignment_id`, `camp_id`), each `REFERENCES … ON DELETE CASCADE`, plus a CHECK enforcing exactly the right column is set for each `scope_kind`. Partial unique indexes preserve "one override per (scope entity, video)". The resolver's three `LEFT JOIN`s switch from `scope_id = …` to the typed column. The legacy→new backfill targets arc columns directly. Syllabus soft-delete adds `deleted_at` + read-site filtering.

**Tech Stack:** Rust, sqlx (offline/compile-time-checked queries), SQLite, declarative migration-engine (`crates/migration-engine`).

**Landing decision (locked — Path A, incremental merge):** Arc + soft-delete land on **`feat/video-tiers-propagation` (PR #75)** — the branch that introduces the override table — then the camps stack (`#76 slice-1` → `#77 comp-matches` → `#78 footage-nextcamp` → `#79 scoped-visibility`) is re-rebased on top. Stack merges bottom-up over time, so closing the bug at #75 prevents the polymorphic table reaching prod. See Phase 5.

**CRITICAL — #75 is 3-scope only.** Verified on `feat/video-tiers-propagation`: the override table CHECK is `('student','syllabus','assignment')` — **no `camp`**. There is no `camps` table, no `camp_id`, no `list_videos_for_camp` / `set_video_camp_visibility`, no camp-scope code on #75. All camp scope is layered on by the camps stack (#76 spine, #79 per-camp visibility). Therefore on #75:
- The arc is **3-scope**: `student_id`, `syllabus_id`, `assignment_id` only. No `camp_id` column, no `camps` FK, 3-branch CHECK, 3 partial indexes.
- `VisibilityScope` enum has **3 variants** (no `Camp`).
- The **camp arc is net-new work during the #76 rebase** (add `camp_id` column + CHECK branch + `Camp` variant + `idx_vvo_camp` + convert camp reads/writes to typed columns), NOT mere conflict resolution. See Phase 5.

**Line numbers in this plan reflect the #79 tree and are STALE on #75. Implementers MUST locate sites by grep, not by line number.** Canonical inventory command:
```bash
grep -rnE "scope_kind|scope_id|video_visibility_overrides|set_video_override|clear_video_override" crates/syllabus-tracker/src --include=*.rs
```

**Key assumption (verified — Task 0 done):** PR #75 is unmerged; production has no `video_visibility_overrides` table. Table is created fresh (arc shape) on first deploy of #75; no prod data to transition. Dev/staging DBs with #75's old-shape table are rebuilt from `schema.sql`. (If ever false, Appendix A.)

---

## Commit gating (IMPORTANT)

`lefthook.yml` pre-commit runs `just test-backend` on any staged `*.rs`. The arc migration is only green once schema + all queries + writers + backfill + regenerated `.sqlx` land together. **Therefore Tasks 2-7 are implemented and committed as ONE atomic commit** ("arc migration core") — they cannot be split without failing the test gate on a half-migrated tree. Task 1 (enum, additive) and Task 8 (soft-delete, independent) are their own commits. Do not use `--no-verify` to sneak broken intermediate commits.

## File map

- `config/schema.sql` — `video_visibility_overrides` table redefinition (~448-456) + partial unique indexes; `syllabi.deleted_at` column (~351) + partial indexes on syllabus read paths.
- `crates/syllabus-tracker/src/db/videos.rs` — `VisibilityScope` enum (new); retype `set_video_override` / `clear_video_override`; switch read queries at 697-700, 792-795, 826-829, 988-999, 1381-1382, 1630-1631; rewrite legacy backfill INSERTs at 1068-1104; `promote_video_to_global` DELETE at 1234 unchanged (keyed by `video_id`).
- `crates/syllabus-tracker/src/db/student_syllabus_techniques.rs` — assignment-scope read at 625-634.
- `crates/syllabus-tracker/src/db/syllabi.rs` — `delete_syllabus` (181) → soft delete; `get`/`list` reads (67, 98) filter `deleted_at IS NULL`.
- `crates/syllabus-tracker/src/db/syllabus_assignments.rs` — joins at 59, 113 (decide filter, see Task 8).
- Callers passing string scope: `videos.rs:734` (camp), `1355-1356` (student), `1577-1578` (assignment); `syllabi/routes.rs:369` (assignment clear).
- Tests: `src/test/videos.rs` (1006-1153, 1264, 1404-1436), `src/test/syllabi.rs` (844-957), `src/test/camps.rs` (1013-1246), `src/test/pinned.rs` (240-285).
- sqlx offline metadata: `.sqlx/` (regen via `nix develop .#ci --command just sqlx-prepare`).

---

## Task 0: Verify the landing assumption and stack state

**Files:** none (investigation only).

- [ ] **Step 1: Confirm #75 is unmerged and prod lacks the table**

Run:
```bash
gh pr view 75 --json state,baseRefName
git log origin/main --oneline | grep -i "video.tier\|visibility_override" || echo "not on main (expected)"
```
Expected: PR #75 `state: OPEN`; no `video_visibility_overrides`-introducing commit on `origin/main`. If #75 is MERGED or the table is on `main`, STOP and use Appendix A.

- [ ] **Step 2: Confirm the camps stack order**

Run: `gh pr list --state open --json number,headRefName,baseRefName --jq '.[] | select(.number>=74 and .number<=79)'`
Expected: chain `74←75←76←77←78←79`. Record current HEADs of each branch (`git rev-parse feat/video-tiers-propagation feat/camps-slice-1 …`) for the rebase in Phase 5.

- [ ] **Step 3: Check out the target branch**

Run: `git switch feat/video-tiers-propagation && git status`
Expected: clean tree on `feat/video-tiers-propagation`. (Do NOT `git stash` — the stash holds unrelated WIP.)

---

## Task 1: `VisibilityScope` enum (compiler-guided scope, mirrors `VideoParent`)

**Files:**
- Modify: `crates/syllabus-tracker/src/db/videos.rs` (add enum near the existing `VideoParent` definition).
- Test: `crates/syllabus-tracker/src/test/videos.rs`.

- [ ] **Step 1: Write the failing test**

In `src/test/videos.rs`, add:
```rust
#[test]
fn visibility_scope_maps_to_kind_and_columns() {
    use crate::db::VisibilityScope::*;
    assert_eq!(Student(7).kind(), "student");
    assert_eq!(Student(7).columns(), (Some(7), None, None));
    assert_eq!(Syllabus(7).columns(), (None, Some(7), None));
    assert_eq!(Assignment(7).columns(), (None, None, Some(7)));
}
```
(3-scope on #75. The `Camp` variant + a 4th tuple slot are added during the #76 rebase — Phase 5.)

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p syllabus-tracker visibility_scope_maps_to_kind_and_columns`
Expected: FAIL — `VisibilityScope` not found.

- [ ] **Step 3: Implement the enum**

In `src/db/videos.rs`:
```rust
/// A coach visibility-override scope. Mirrors the exclusive-arc parent pattern
/// (`VideoParent`): exactly one entity is referenced, the DB enforces it via a
/// CHECK + per-scope FK cascade on `video_visibility_overrides`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VisibilityScope {
    Student(i64),
    Syllabus(i64),
    Assignment(i64),
}

impl VisibilityScope {
    pub fn kind(&self) -> &'static str {
        match self {
            VisibilityScope::Student(_) => "student",
            VisibilityScope::Syllabus(_) => "syllabus",
            VisibilityScope::Assignment(_) => "assignment",
        }
    }

    /// Returns `(student_id, syllabus_id, assignment_id)` with exactly one
    /// `Some`, matching the table's typed columns.
    pub fn columns(&self) -> (Option<i64>, Option<i64>, Option<i64>) {
        match *self {
            VisibilityScope::Student(id) => (Some(id), None, None),
            VisibilityScope::Syllabus(id) => (None, Some(id), None),
            VisibilityScope::Assignment(id) => (None, None, Some(id)),
        }
    }
}
```
Re-export from `crate::db` if `VideoParent` is (match the existing `pub use` in `db/mod.rs`). **(Camp variant + 4th column slot added during #76 rebase.)**

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test -p syllabus-tracker visibility_scope_maps_to_kind_and_columns`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/syllabus-tracker/src/db/videos.rs crates/syllabus-tracker/src/test/videos.rs
git commit -m "feat(videos): add VisibilityScope enum for typed override scopes"
```

---

## Task 2: Arc table schema + partial unique indexes

**Files:**
- Modify: `config/schema.sql` (replace `video_visibility_overrides` block, ~448-456).

- [ ] **Step 1: Replace the table definition**

Replace lines ~448-456 with:
```sql
-- Coach visibility override for a single video within a single scope
-- (student / syllabus / assignment / camp). Exclusive-arc design mirroring
-- videos.parent_kind / threads.anchor_kind: `scope_kind` discriminates, and
-- exactly one typed FK column is set (CHECK-enforced). Each scope FK is
-- ON DELETE CASCADE, so deleting a scope entity removes its overrides — no
-- dangling rows, no rowid-reuse mis-application. Absence of a row = inherit.
CREATE TABLE IF NOT EXISTS video_visibility_overrides (
    scope_kind    TEXT NOT NULL CHECK (scope_kind IN ('student','syllabus','assignment')),
    student_id    INTEGER REFERENCES users (id)                ON DELETE CASCADE,
    syllabus_id   INTEGER REFERENCES syllabi (id)              ON DELETE CASCADE,
    assignment_id INTEGER REFERENCES syllabus_assignments (id) ON DELETE CASCADE,
    video_id      INTEGER NOT NULL REFERENCES videos (id)      ON DELETE CASCADE,
    visible       BOOLEAN NOT NULL,
    set_by_id     INTEGER REFERENCES users (id),
    set_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (
      (scope_kind='student'    AND student_id    IS NOT NULL AND syllabus_id IS NULL AND assignment_id IS NULL) OR
      (scope_kind='syllabus'   AND syllabus_id   IS NOT NULL AND student_id  IS NULL AND assignment_id IS NULL) OR
      (scope_kind='assignment' AND assignment_id IS NOT NULL AND student_id  IS NULL AND syllabus_id   IS NULL)
    )
);
-- One override per (scope entity, video). Partial indexes keep the mostly-NULL
-- arc columns cheap and enforce per-scope uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vvo_student    ON video_visibility_overrides (student_id, video_id)    WHERE scope_kind='student';
CREATE UNIQUE INDEX IF NOT EXISTS idx_vvo_syllabus   ON video_visibility_overrides (syllabus_id, video_id)   WHERE scope_kind='syllabus';
CREATE UNIQUE INDEX IF NOT EXISTS idx_vvo_assignment ON video_visibility_overrides (assignment_id, video_id) WHERE scope_kind='assignment';
```
**(3-scope on #75. The `camp_id` column, `camp` CHECK branch, and `idx_vvo_camp` are added during the #76 rebase — Phase 5.)**

- [ ] **Step 2: Sanity-check the schema parses**

Run: `sqlite3 ":memory:" ".read config/schema.sql" ".schema video_visibility_overrides"`
Expected: prints the new table + 4 indexes, no error. (Confirms CHECK/FK/index SQL is valid.)

- [ ] **Step 3: Commit**

```bash
git add config/schema.sql
git commit -m "feat(videos): exclusive-arc video_visibility_overrides (typed FK cascade + CHECK)"
```

---

## Task 3: Retype the override writers (`set_video_override` / `clear_video_override`)

**Files:**
- Modify: `crates/syllabus-tracker/src/db/videos.rs` (1134-1180 writers; callers at 734, 1355-1356, 1577-1578; `syllabi/routes.rs:369`).
- Test: `crates/syllabus-tracker/src/test/videos.rs`.

Note: the old PK `(scope_kind, scope_id, video_id)` is gone, so the `ON CONFLICT` upsert target is gone. Implement upsert as delete-then-insert inside a transaction (single writer, simplest correct form; avoids partial-index conflict-target syntax).

- [ ] **Step 1: Write the failing test (round-trip via typed scope + cascade)**

In `src/test/videos.rs` add:
```rust
#[sqlx::test]
async fn override_upsert_and_scope_cascade(pool: sqlx::SqlitePool) {
    // setup: a coach, student, syllabus, assignment, a T1 video. (reuse existing
    // builders in this test module — see effective_video_visible_precedence.)
    let db = TestDb::from(pool);
    let (coach, _student, _syl, assignment_id, video_id) = seed_basic_assignment_with_video(&db).await;

    // upsert twice at the same scope -> exactly one row, latest value wins.
    set_video_override(&db.pool, VisibilityScope::Assignment(assignment_id), video_id, true, coach).await.unwrap();
    set_video_override(&db.pool, VisibilityScope::Assignment(assignment_id), video_id, false, coach).await.unwrap();
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM video_visibility_overrides WHERE assignment_id = ? AND video_id = ?")
        .bind(assignment_id).bind(video_id).fetch_one(&db.pool).await.unwrap();
    assert_eq!(n, 1, "upsert keeps a single row");

    // deleting the assignment cascades the override away (the bug being fixed).
    sqlx::query("PRAGMA foreign_keys = ON").execute(&db.pool).await.unwrap();
    sqlx::query("DELETE FROM syllabus_assignments WHERE id = ?").bind(assignment_id).execute(&db.pool).await.unwrap();
    let after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM video_visibility_overrides WHERE assignment_id = ?")
        .bind(assignment_id).fetch_one(&db.pool).await.unwrap();
    assert_eq!(after, 0, "override cascades on scope delete — no dangling row");
}
```
(If no `seed_basic_assignment_with_video` helper exists, inline the setup copied from `effective_video_visible_precedence` at `src/test/videos.rs:1006`. Ensure the test pool has `PRAGMA foreign_keys=ON`; the app sets it at `main.rs:142` but `sqlx::test` pools may not.)

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p syllabus-tracker override_upsert_and_scope_cascade`
Expected: FAIL — signature mismatch (`set_video_override` still takes `&str, i64`) / column `assignment_id` does not exist until offline metadata regenerated.

- [ ] **Step 3: Rewrite the writers**

Replace `set_video_override` (1134-1159):
```rust
#[instrument(skip(pool))]
pub async fn set_video_override(
    pool: &Pool<Sqlite>,
    scope: VisibilityScope,
    video_id: i64,
    visible: bool,
    by_id: i64,
) -> Result<(), AppError> {
    let kind = scope.kind();
    let (student_id, syllabus_id, assignment_id, camp_id) = scope.columns();
    let mut tx = pool.begin().await?;
    // Upsert = clear-then-insert at this scope (single writer; avoids partial
    // unique-index ON CONFLICT target syntax).
    sqlx::query!(
        "DELETE FROM video_visibility_overrides
         WHERE scope_kind = ?
           AND student_id IS ? AND syllabus_id IS ? AND assignment_id IS ? AND camp_id IS ?
           AND video_id = ?",
        kind, student_id, syllabus_id, assignment_id, camp_id, video_id,
    ).execute(&mut *tx).await?;
    sqlx::query!(
        "INSERT INTO video_visibility_overrides
            (scope_kind, student_id, syllabus_id, assignment_id, camp_id, video_id, visible, set_by_id, set_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
        kind, student_id, syllabus_id, assignment_id, camp_id, video_id, visible, by_id,
    ).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}
```
Replace `clear_video_override` (1164-1180):
```rust
#[instrument(skip(pool))]
pub async fn clear_video_override(
    pool: &Pool<Sqlite>,
    scope: VisibilityScope,
    video_id: i64,
) -> Result<(), AppError> {
    let kind = scope.kind();
    let (student_id, syllabus_id, assignment_id, camp_id) = scope.columns();
    sqlx::query!(
        "DELETE FROM video_visibility_overrides
         WHERE scope_kind = ?
           AND student_id IS ? AND syllabus_id IS ? AND assignment_id IS ? AND camp_id IS ?
           AND video_id = ?",
        kind, student_id, syllabus_id, assignment_id, camp_id, video_id,
    ).execute(pool).await?;
    Ok(())
}
```
(`IS ?` matches NULL-or-value in SQLite — correct for the three NULL columns.)

- [ ] **Step 4: Update the three higher-level callers + the route**

- `set_video_camp_visibility` (734): `set_video_override(pool, VisibilityScope::Camp(camp_id), video_id, visible, by_id).await`
- `set_video_student_visibility` (1355-1356):
  `Some(b) => set_video_override(pool, VisibilityScope::Student(student_id), video_id, b, actor_id).await?,`
  `None => clear_video_override(pool, VisibilityScope::Student(student_id), video_id).await?,`
- assignment writer (1577-1578): `VisibilityScope::Assignment(assignment_id)` in both arms.
- `syllabi/routes.rs:369`: `db::clear_video_override(db, VisibilityScope::Assignment(assignment.id), entry.video_id).await?` (add the `VisibilityScope` import).

- [ ] **Step 5: Defer compile/run to Task 7** (offline metadata must be regenerated once all queries are switched). Mark this task's code complete; tests run green in Task 7.

- [ ] **Step 6: Commit**

```bash
git add crates/syllabus-tracker/src/db/videos.rs crates/syllabus-tracker/src/syllabi/routes.rs crates/syllabus-tracker/src/test/videos.rs
git commit -m "refactor(videos): type override writers on VisibilityScope (delete-then-insert upsert)"
```

---

## Task 4: Switch all read queries to typed columns

**Files:**
- Modify: `crates/syllabus-tracker/src/db/videos.rs` (697-700, 792-795, 826-829, 988-999, 1381-1382, 1630-1631).
- Modify: `crates/syllabus-tracker/src/db/student_syllabus_techniques.rs` (633-634).

Mechanical rule: drop `AND scope_kind = '<x>'` is OPTIONAL but keep it for clarity/index selection; change `ov.scope_id = <expr>` → `ov.<typed_col> = <expr>`.

- [ ] **Step 1: `effective_video_visible` (988-999)**

```
ov_assignment … AND ov_assignment.scope_kind='assignment' AND ov_assignment.assignment_id = sa.id
ov_syllabus   … AND ov_syllabus.scope_kind='syllabus'     AND ov_syllabus.syllabus_id   = sa.syllabus_id
ov_student    … AND ov_student.scope_kind='student'       AND ov_student.student_id     = sa.student_id
```

- [ ] **Step 2: `list_videos_for_camp` (697-700)**

`AND ov.scope_kind='camp' AND ov.camp_id = ?1`

- [ ] **Step 3: `video_visible_to_student` / `_anywhere` student joins (792-795, 826-829)**

`AND vsv.scope_kind='student' AND vsv.student_id = ?` (and the `ov` alias at 826-829 likewise → `ov.student_id = ?`).

- [ ] **Step 4: bulk student select (1381-1382)**

`WHERE scope_kind='student' AND student_id = ? AND video_id IN ({placeholders})`

- [ ] **Step 5: bulk assignment select (1630-1631)**

`WHERE scope_kind='assignment' AND assignment_id = ` (the dynamically-built query — keep its bind structure, just rename the column).

- [ ] **Step 6: SST assignment-scope read (`student_syllabus_techniques.rs:633-634`)**

`WHERE ov.scope_kind='assignment' AND ov.assignment_id = ?`

- [ ] **Step 7: Commit**

```bash
git add crates/syllabus-tracker/src/db/videos.rs crates/syllabus-tracker/src/db/student_syllabus_techniques.rs
git commit -m "refactor(videos): resolver/read queries key on typed scope columns"
```

---

## Task 5: Rewrite the legacy→arc backfill

**Files:**
- Modify: `crates/syllabus-tracker/src/db/videos.rs` (`run_video_visibility_backfill`, 1054-1127; the two `INSERT OR IGNORE` at 1068-1075 and 1100-1104).

These use raw (non-macro) queries on purpose (legacy tables are dropped from `schema.sql`); they stay raw. Only the INSERT target columns change from `(scope_kind, scope_id, …)` to arc columns. The existing orphan-skip (ssvv with no matching assignment) is preserved — that IS the orphan handling.

- [ ] **Step 1: assignment-scope INSERT (1068-1075)**

```sql
INSERT OR IGNORE INTO video_visibility_overrides
    (scope_kind, assignment_id, video_id, visible, set_by_id, set_at)
SELECT 'assignment', sa.id, ssvv.video_id, ssvv.visible, ssvv.updated_by_id, ssvv.updated_at
FROM student_syllabus_video_visibility ssvv
JOIN syllabus_assignments sa
     ON sa.student_id = ssvv.student_id AND sa.syllabus_id = ssvv.syllabus_id
```
(The `JOIN` already drops orphans; the partial unique index `idx_vvo_assignment` backs the `INSERT OR IGNORE`.)

- [ ] **Step 2: student-scope INSERT (1100-1104)**

```sql
INSERT OR IGNORE INTO video_visibility_overrides
    (scope_kind, student_id, video_id, visible, set_by_id, set_at)
SELECT 'student', vsv.student_id, vsv.video_id, vsv.visible, vsv.set_by_id, vsv.set_at
FROM video_student_visibility vsv
```

- [ ] **Step 3: Commit**

```bash
git add crates/syllabus-tracker/src/db/videos.rs
git commit -m "refactor(videos): legacy visibility backfill writes arc columns"
```

---

## Task 6: Fix tests that read `scope_id` directly

**Files:**
- Modify: `src/test/videos.rs` (1409-1436), `src/test/syllabi.rs` (844-957), `src/test/camps.rs` (1087, 1098, 1245-1246), and every `set_video_override(&pool, "student"/"syllabus"/"assignment", id, …)` call to the new enum API.

- [ ] **Step 1: Convert `set_video_override` / `clear_video_override` call sites**

`set_video_override(&db.pool, "assignment", assignment_id, v, b, coach)` → `set_video_override(&db.pool, VisibilityScope::Assignment(assignment_id), v, b, coach)` (and `"syllabus"`→`Syllabus`, `"student"`→`Student`). `clear_video_override(&db.pool, "assignment", id, v)` → `clear_video_override(&db.pool, VisibilityScope::Assignment(id), v)`. Add `VisibilityScope` to each test module's `use crate::db::{…}`.

- [ ] **Step 2: Convert raw SQL assertions**

`… WHERE scope_kind='assignment' AND scope_id = ? AND video_id = ?` → `… AND assignment_id = ? AND video_id = ?`. `SELECT scope_id …` (videos.rs:1409/1422) → `SELECT assignment_id AS "scope_id!: i64"` / `SELECT student_id …` to keep the binding name, OR rename the local. camps.rs 1087/1245-1246 `scope_id=?` → `camp_id=?`. camps.rs:1098 `scope_kind='student'` count → `student_id IS NOT NULL` (or keep `scope_kind='student'`).

- [ ] **Step 3: Defer run to Task 7.**

- [ ] **Step 4: Commit**

```bash
git add crates/syllabus-tracker/src/test/
git commit -m "test(videos): switch override tests to VisibilityScope + typed columns"
```

---

## Task 7: Regenerate sqlx offline metadata, build, and run the full suite

**Files:** `.sqlx/` (generated).

- [ ] **Step 1: Regenerate offline metadata (the gate — never bare `cargo sqlx prepare` on the seeded dev DB)**

Run: `nix develop .#ci --command just sqlx-prepare`
Expected: `.sqlx/` updated; the new arc columns now resolve in `query!` macros. Commit churn under `.sqlx/`.

- [ ] **Step 2: Offline build**

Run: `SQLX_OFFLINE=true cargo build -p syllabus-tracker`
Expected: compiles. (If `query!` complains a column is unknown, the offline metadata or `schema.sql` is out of sync — re-run Step 1.)

- [ ] **Step 3: Full test suite (includes Task 3/6 deferred tests)**

Run: `nix develop .#ci --command just test` (or `cargo test -p syllabus-tracker`)
Expected: PASS, including `override_upsert_and_scope_cascade`, `effective_video_visible_precedence`, the camp visibility tests, and `video_syllabus_visibility_upsert_and_clear`.

- [ ] **Step 4: Commit**

```bash
git add .sqlx
git commit -m "chore(sqlx): regenerate offline metadata for arc override columns"
```

---

## Task 8: Syllabus soft-delete

**Files:**
- Modify: `config/schema.sql` (`syllabi`, ~350-357; add `deleted_at` + read-path partial indexes).
- Modify: `crates/syllabus-tracker/src/db/syllabi.rs` (`delete_syllabus` 181; reads 67, 98).
- Possibly `syllabus_assignments.rs` (59, 113) — see Step 1 decision.
- Test: `src/test/syllabi.rs`.

**Decision to lock before coding (Step 0):** When a syllabus is soft-deleted, what happens to its active assignments? With hard delete they cascaded away. Options: (a) cascade-soft — also set `unassigned_at` on its open assignments (recommended: preserves the old user-visible effect — the syllabus disappears from students); (b) leave assignments, filter by `syllabus.deleted_at IS NULL` at every assignment read. (a) is closer to current behavior and less read-site surface. **Plan assumes (a).**

- [ ] **Step 1: Write the failing test**

```rust
#[sqlx::test]
async fn soft_delete_syllabus_hides_it_and_unassigns(pool: sqlx::SqlitePool) {
    let db = TestDb::from(pool);
    let (coach, student, syllabus_id) = seed_coach_student_syllabus(&db).await;
    assign_syllabus(&db, student, syllabus_id, coach).await;

    db::delete_syllabus(&db.pool, syllabus_id).await.unwrap();

    // row still present but flagged
    let alive: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM syllabi WHERE id = ? AND deleted_at IS NULL")
        .bind(syllabus_id).fetch_one(&db.pool).await.unwrap();
    assert_eq!(alive, 0, "soft-deleted syllabus no longer counts as alive");
    // not listed
    let listed = db::list_syllabi(&db.pool).await.unwrap();
    assert!(!listed.iter().any(|s| s.id == syllabus_id), "soft-deleted syllabus is not listed");
    // assignment closed
    let open: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM syllabus_assignments WHERE syllabus_id = ? AND unassigned_at IS NULL")
        .bind(syllabus_id).fetch_one(&db.pool).await.unwrap();
    assert_eq!(open, 0, "open assignments are closed on soft delete");
}
```
(Use the existing builders in `src/test/syllabi.rs`; match real `list_syllabi` fn name — verify at `db/syllabi.rs:98`.)

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p syllabus-tracker soft_delete_syllabus_hides_it_and_unassigns`
Expected: FAIL — `deleted_at` column unknown / hard delete removes the row.

- [ ] **Step 3: Schema — add `deleted_at` to `syllabi`**

In `config/schema.sql`, in the `syllabi` table add `deleted_at TIMESTAMP,` after `updated_at`. (No new index strictly required for correctness; add `CREATE INDEX IF NOT EXISTS idx_syllabi_alive ON syllabi (id) WHERE deleted_at IS NULL;` only if list queries show up hot — optional.)

- [ ] **Step 4: Implement soft delete**

`db/syllabi.rs:181-186`:
```rust
#[instrument]
pub async fn delete_syllabus(pool: &Pool<Sqlite>, id: i64) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    sqlx::query!("UPDATE syllabi SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?", id)
        .execute(&mut *tx).await?;
    // Close open assignments so the syllabus disappears for students (matches
    // the prior hard-delete user-visible effect).
    sqlx::query!(
        "UPDATE syllabus_assignments SET unassigned_at = CURRENT_TIMESTAMP
         WHERE syllabus_id = ? AND unassigned_at IS NULL",
        id,
    ).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}
```

- [ ] **Step 5: Filter reads**

`db/syllabi.rs` get (67) and list (98): add `WHERE s.deleted_at IS NULL` (or `AND` into existing WHERE). Audit other `FROM/JOIN syllabi` sites: `student_syllabus_techniques.rs:495`, `syllabus_assignments.rs:59,113` — since Step 4 closes assignments, those assignment-scoped reads already filter `unassigned_at IS NULL` and need no syllabus filter; confirm each. `activity_read.rs` LEFT JOINs are historical display — leave unfiltered (soft delete keeps the name resolvable, a benefit).

- [ ] **Step 6: Run to verify it passes**

Run: `cargo test -p syllabus-tracker soft_delete_syllabus_hides_it_and_unassigns` then the full suite.
Expected: PASS.

- [ ] **Step 7: Regenerate sqlx + commit**

```bash
nix develop .#ci --command just sqlx-prepare
git add config/schema.sql crates/syllabus-tracker/src/db/syllabi.rs crates/syllabus-tracker/src/test/syllabi.rs .sqlx
git commit -m "feat(syllabus): soft-delete syllabi (deleted_at) and close open assignments"
```

---

## Task 9: Local verify gate

**Files:** none.

- [ ] **Step 1: Run the project verify gate**

Run: `just verify` (or `nix develop .#ci --command just verify`)
Expected: lint + offline build + tests all green. Fix anything before proceeding to the rebase.

- [ ] **Step 2: Manual smoke (optional but recommended)**

Use the `run` / `verify` skill to launch the app, hide a video for a syllabus, delete that syllabus, confirm no stale override resurfaces on a freshly created syllabus that reuses the id.

---

## Phase 5: Re-rebase the camps stack

The arc (3-scope) + soft-delete commits now sit on `feat/video-tiers-propagation` (#75). Rebase each child branch onto its updated parent, in order. `#76 slice-1` introduces the `camps` table + `camp` scope and `#79 scoped-visibility` adds per-camp visibility — both need **net-new camp-arc work during rebase, not just conflict resolution**. `#77`/`#78` should be clean.

- [ ] **Step 1: Rebase #76 onto #75 AND add the camp arc**

```bash
git switch feat/camps-slice-1
git rebase feat/video-tiers-propagation
```
The camps stack commits were written against the polymorphic `(scope_kind, scope_id)` table, so their override-touching hunks will conflict. Resolve to the arc form, AND extend the arc with the camp scope (since #76 introduces `camps`):
- `config/schema.sql`: add `camp_id INTEGER REFERENCES camps (id) ON DELETE CASCADE` to `video_visibility_overrides`; add `'camp'` to the `scope_kind` CHECK list; add the 4th CHECK branch `(scope_kind='camp' AND camp_id IS NOT NULL AND student_id IS NULL AND syllabus_id IS NULL AND assignment_id IS NULL)`; add `CREATE UNIQUE INDEX idx_vvo_camp ON video_visibility_overrides (camp_id, video_id) WHERE scope_kind='camp';`. Also update the other 3 CHECK branches to include `AND camp_id IS NULL`.
- `VisibilityScope` enum: add `Camp(i64)`; widen `.columns()` to a 4-tuple `(student, syllabus, assignment, camp)` and update the 3 existing variants + all call sites/tests accordingly; `.kind()` gains the `camp` arm.
- Any camp-scope reads/writes #76 introduces: convert to typed `camp_id` columns (same mechanical rule as Task 4).
- Regenerate offline metadata: `nix develop .#ci --command just sqlx-prepare`.
Run `SQLX_OFFLINE=true cargo build -p syllabus-tracker` + camp tests after resolving.

- [ ] **Step 2: Rebase #77 onto #76**

```bash
git switch feat/camps-comp-matches && git rebase feat/camps-slice-1
```
Expected: clean (slice 2 doesn't touch the table).

- [ ] **Step 3: Rebase #78 onto #77**

```bash
git switch feat/camps-footage-nextcamp && git rebase feat/camps-comp-matches
```
Expected: clean.

- [ ] **Step 4: Rebase #79 onto #78**

```bash
git switch feat/camps-scoped-visibility && git rebase feat/camps-footage-nextcamp
```
Resolve per-camp visibility conflicts to the arc form. The camp writer/reader already updated in Tasks 3-4 — ensure slice-4's additions match.

- [ ] **Step 5: Per-branch verify**

On each rebased branch (at minimum #76 and #79): `nix develop .#ci --command just sqlx-prepare` (if a branch added override queries) + `SQLX_OFFLINE=true cargo build -p syllabus-tracker` + targeted tests. The `.sqlx/` metadata must be regenerated on any branch that introduced/changed override queries.

- [ ] **Step 6: Force-push the stack (only after all branches build+test)**

```bash
git push --force-with-lease origin feat/video-tiers-propagation feat/camps-slice-1 feat/camps-comp-matches feat/camps-footage-nextcamp feat/camps-scoped-visibility
```
Confirm each PR's base is unchanged on GitHub and CI re-runs green.

---

## Task 10: Clean up the working doc

- [ ] **Step 1:** Update `VISIBILITY_REFACTOR.md` §6 to record the decision (Option C / arc chosen over B; arc makes hard-delete safe; syllabus soft-delete done as paired convention fix) OR delete it per its own "decide, action, then delete" note. Confirm with the user which.

---

## Self-review notes

- **Spec coverage:** arc schema (Task 2), enum (Task 1), writers (Task 3), every read site from the grep inventory (Task 4), legacy backfill (Task 5), tests (Task 6), sqlx gate (Task 7), soft-delete (Task 8), verify (Task 9), stacked rebase (Phase 5). All convergence findings addressed.
- **Type consistency:** `VisibilityScope::{Student,Syllabus,Assignment,Camp}(i64)`; `.kind()` → `&'static str`; `.columns()` → `(Option<i64>×4)` used identically in Tasks 1/3/6.
- **Open decision flagged:** Task 8 Step 0 (assignment behavior on syllabus soft-delete) — plan assumes cascade-soft (a).
- **Risk:** if Task 0 finds #75 already merged/live, the in-place transitional migration (Appendix A) replaces Task 5's assumption.

## Appendix A: in-place transitional migration (ONLY if #75 is already live in prod)

If prod already has the old-shape `video_visibility_overrides` with data, the column-name-intersection rebuild (`migration-engine` `main.rs:403`) would NULL the new arc columns and abort on the CHECK. In that case add a runtime backfill (mirror `run_video_visibility_backfill`, raw queries) that runs BEFORE the declarative migrate:
1. `ALTER TABLE video_visibility_overrides ADD COLUMN student_id INTEGER REFERENCES users(id) ON DELETE CASCADE;` (×4 scopes).
2. `UPDATE … SET student_id = scope_id WHERE scope_kind='student';` (×4).
3. Purge pre-existing orphans so the post-rebuild FK check passes: `DELETE … WHERE scope_kind='syllabus' AND syllabus_id NOT IN (SELECT id FROM syllabi);` (×4).
4. Leave `scope_id`; the declarative migrate (with `allow_deletions`) drops it, and the now-populated typed columns satisfy the CHECK on the rebuild copy.
Guard idempotently on "does `student_id` column already exist?".
