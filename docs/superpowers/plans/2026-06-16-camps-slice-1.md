# Camps Slice 1 (generic camp spine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the generic-camp spine — coach-created camps holding library techniques, camp-owned videos, and camp discussion threads, fully wired into the activity feed with typed deep-links — reusing the existing polymorphic-video, thread, activity, and technique-row machinery.

**Architecture:** Camp is a new owning tier on the existing typed-column polymorphic patterns. Two new tables (`camps`, `camp_techniques`); `'camp'` added to `videos.parent_kind`, `threads.anchor_kind`, and the `activity` row's reference columns. Video visibility is global-hide only (Approach A from the spec) routed through one resolver helper so the future unified `video_visibility_overrides` slots in later. Writes are coach-only behind a new `Permission::ManageCamps`. Camp threads are auto-scoped to the camp's student, so existing per-viewer feed scoping applies unchanged.

**Tech Stack:** Rust + Rocket + sqlx (SQLite, declarative migration engine reading `config/schema.sql`); React 19 + Vite + TanStack Query + shadcn/ui; Vitest (Chromium browser tests).

**Spec:** `docs/superpowers/specs/2026-06-16-camps-slice-1-design.md`.

---

## Pre-flight

- [ ] **Confirm base branch.** Run: `git branch --show-current`. Expected: `feat/camps-slice-1` (created during brainstorming). If on `main`, run `git fetch origin && git checkout -b feat/camps-slice-1 origin/main` after verifying `origin/main` is current.
- [ ] **Confirm the dev DB + offline build work before changing anything.** Run: `nix develop .#ci --command just verify`. Expected: PASS (this is the gate every task commits against). If it fails pre-change, stop and fix the environment first.

## File structure

**Backend (`crates/syllabus-tracker/`):**
- `config/schema.sql` — add `camps`, `camp_techniques`; add `camp` parent/anchor branches + `camp_id` columns to `videos`, `threads`, `activity`. (repo root, not under the crate)
- `src/auth/permissions.rs` — add `Permission::ManageCamps` to the enum + coach set.
- `src/db/videos.rs` — `VideoParent::Camp`, `ParentColumns.camp_id`, all INSERT/SELECT column lists.
- `src/db/threads.rs` — `AnchorKind::Camp`, `anchor_columns` 6-tuple, `validate_anchor`, `create_thread` INSERT + camp auto-scope.
- `src/db/activity.rs` — 3 new `Verb`s, `EntityKind::Camp`, `NewActivity.camp_id` + `.camp()`, `emit` INSERT.
- `src/db/activity_read.rs` — `ActivityRow.camp_id` + SELECT columns.
- `src/db/camps.rs` — NEW. Camp CRUD + camp_techniques + activity emission.
- `src/db/mod.rs` — `pub mod camps;`.
- `src/camps/mod.rs`, `src/camps/routes.rs` — NEW. HTTP routes.
- `src/lib.rs` / `src/main.rs` — `mod camps;` + route mount.
- `src/test/camps.rs`, `src/test/mod.rs` — NEW test module + registration.

**Frontend (`frontend/src/`):**
- `lib/entity-ref.ts` — add `camp` to `EntityRef` + `ENTITY_TYPE_LOOKUP`.
- `lib/view-context.ts` — add `camp` `ViewContext` arm + `viewContextHref` + `rowToViewContext` + `ViewContextRow.camp_id`.
- `lib/activity-line.ts` — `describe()` arms for the 3 new verbs; `camp_id` on the row type.
- `lib/api.ts` — `Camp` types + camp fetch functions.
- `lib/queries.ts`, `lib/mutations.ts`, `lib/query-keys.ts` — camp hooks + keys.
- `components/technique-row/technique-row-context.ts`, `block-visibility.ts`, `technique-row.tsx` — add `camp` `RowContext` kind.
- `app/camps/[id]/page.tsx`, `app/student-camps/page.tsx` — NEW pages.
- `app/student-profile/page.tsx` — add Camps hub link.
- `App.tsx` — two new routes.

---

## Task 1: Schema + ManageCamps permission

**Files:**
- Modify: `config/schema.sql`
- Modify: `crates/syllabus-tracker/src/auth/permissions.rs:9-36`, `:57-79`
- Test: `crates/syllabus-tracker/src/test/camps.rs` (new), `crates/syllabus-tracker/src/test/mod.rs`

- [ ] **Step 1: Add the new tables to `config/schema.sql`.** Append after the `student_pinned_techniques` block (around line 233):

```sql
-- A camp: a stretch of intentional work between one coach and one student,
-- holding techniques, videos, and discussion. Slice 1 = generic camp only;
-- competition_id / references_camp_id are intentionally absent (nullable adds
-- later cost nothing under the declarative migrator).
CREATE TABLE IF NOT EXISTS camps (
    id             INTEGER PRIMARY KEY,
    student_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    coach_id       INTEGER NOT NULL REFERENCES users (id),
    name           TEXT NOT NULL,
    description    TEXT,
    created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    archived_at    TIMESTAMP,
    archived_by_id INTEGER REFERENCES users (id)
);
CREATE INDEX IF NOT EXISTS idx_camps_student
    ON camps (student_id) WHERE archived_at IS NULL;

-- Membership of (global library) techniques in a camp, with display order.
CREATE TABLE IF NOT EXISTS camp_techniques (
    camp_id      INTEGER NOT NULL REFERENCES camps (id) ON DELETE CASCADE,
    technique_id INTEGER NOT NULL REFERENCES techniques (id) ON DELETE CASCADE,
    position     INTEGER NOT NULL DEFAULT 0,
    added_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    added_by_id  INTEGER REFERENCES users (id),
    PRIMARY KEY (camp_id, technique_id)
);
CREATE INDEX IF NOT EXISTS idx_camp_techniques_position
    ON camp_techniques (camp_id, position);
```

- [ ] **Step 2: Add the `camp` branch to `videos`.** In `config/schema.sql`, edit the `videos` table: add `'camp'` to the `parent_kind` CHECK list, add a `camp_id` column after `thread_id`, and add the CHECK branch + an index.

```sql
-- in the parent_kind CHECK list:
    parent_kind TEXT NOT NULL DEFAULT 'technique' CHECK (parent_kind IN (
        'technique', 'student_profile', 'thread', 'loose', 'camp'
    )),
-- new column, after `thread_id INTEGER REFERENCES threads (id) ON DELETE CASCADE,`:
    camp_id INTEGER REFERENCES camps (id) ON DELETE CASCADE,
-- add a branch to the big CHECK( ... ) at the end of the table:
      (parent_kind = 'camp'            AND camp_id IS NOT NULL AND technique_id IS NULL AND student_id IS NULL AND thread_id IS NULL) OR
-- and update the three existing branches to also require `camp_id IS NULL`.
```

Add after the existing video indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_videos_camp
    ON videos (camp_id) WHERE deleted_at IS NULL;
```

> NOTE: the existing per-branch CHECK rows (technique / student_profile / thread / loose) must each gain `AND camp_id IS NULL`, otherwise a camp_id could leak onto a non-camp row. Edit all four.

- [ ] **Step 3: Add the `camp` branch to `threads`.** Edit the `threads` table CHECK and columns:

```sql
-- anchor_kind CHECK list gains 'camp':
    anchor_kind TEXT NOT NULL CHECK (anchor_kind IN (
        'student_profile','technique','video',
        'video_timestamp','sst','pinned_technique','camp')),
-- new column after `sst_id`:
    camp_id INTEGER REFERENCES camps (id) ON DELETE CASCADE,
-- new branch in the anchor CHECK( ... ):
      (anchor_kind='camp' AND camp_id IS NOT NULL AND student_id IS NULL AND technique_id IS NULL AND video_id IS NULL AND video_ts_seconds IS NULL AND sst_id IS NULL)
-- every existing anchor branch gains `AND camp_id IS NULL`.
```

Add the index:

```sql
CREATE INDEX IF NOT EXISTS idx_threads_camp ON threads(camp_id) WHERE deleted_at IS NULL;
```

> NOTE: do NOT touch the visibility CHECK (`visibility='private' OR anchor_kind IN ('technique','video','video_timestamp')`). Because `camp` is not in that list, camp threads are forced `private` automatically — that is the intended scoping (spec §2).

- [ ] **Step 4: Add `camp_id` to `activity`.** Edit the `activity` table: add a column after `thread_id` and an index.

```sql
    camp_id           INTEGER REFERENCES camps(id)      ON DELETE SET NULL,
```

```sql
CREATE INDEX IF NOT EXISTS idx_activity_camp
    ON activity (camp_id, occurred_at DESC, id DESC);
```

- [ ] **Step 5: Add `Permission::ManageCamps`.** In `crates/syllabus-tracker/src/auth/permissions.rs`, add the variant to the enum (after `BroadcastLibraryComment`, line 35) and to the coach set (after line 76):

```rust
// in pub enum Permission { ... }
    ManageCamps,
```
```rust
// in COACH_PERMISSIONS, after permissions.insert(Permission::BroadcastLibraryComment);
    permissions.insert(Permission::ManageCamps);
```

- [ ] **Step 6: Create the test module skeleton + a migration round-trip test.** Create `crates/syllabus-tracker/src/test/camps.rs`:

```rust
use crate::test::utils::TestDbBuilder;

#[tokio::test]
async fn schema_creates_camp_tables() {
    let db = TestDbBuilder::new().build().await.unwrap();
    // Both tables exist and are empty.
    let camps: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM camps")
        .fetch_one(&db.pool).await.unwrap();
    assert_eq!(camps, 0);
    let camp_techniques: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM camp_techniques")
        .fetch_one(&db.pool).await.unwrap();
    assert_eq!(camp_techniques, 0);
    // The new parent/anchor branches are accepted by the CHECK constraints.
    let video_camp_col: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pragma_table_info('videos') WHERE name = 'camp_id'")
        .fetch_one(&db.pool).await.unwrap();
    assert_eq!(video_camp_col, 1);
    let activity_camp_col: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pragma_table_info('activity') WHERE name = 'camp_id'")
        .fetch_one(&db.pool).await.unwrap();
    assert_eq!(activity_camp_col, 1);
}
```

Register the module in `crates/syllabus-tracker/src/test/mod.rs` (add `mod camps;` alphabetically near `mod attempts;`).

> Confirm `TestDbBuilder` is the correct builder name by reading `src/test/utils.rs:141` first; match the exact constructor used by `src/test/threads.rs`.

- [ ] **Step 7: Run the test.** Run: `nix develop .#ci --command cargo test -p syllabus-tracker schema_creates_camp_tables -- --nocapture`. Expected: PASS. (The declarative migrator builds the test DB from `config/schema.sql`, so a schema typo fails here.)

- [ ] **Step 8: Commit.**

```bash
git add config/schema.sql crates/syllabus-tracker/src/auth/permissions.rs crates/syllabus-tracker/src/test/camps.rs crates/syllabus-tracker/src/test/mod.rs
git commit -m "feat(camps): add camps + camp_techniques schema, camp parent/anchor columns, ManageCamps perm"
```

---

## Task 2: VideoParent::Camp

**Files:**
- Modify: `crates/syllabus-tracker/src/db/videos.rs:17-79` (enum, `ParentColumns`, `columns()`, `validate_parent`), plus every INSERT/SELECT that lists the parent columns (search the file for `thread_id,`).
- Test: `crates/syllabus-tracker/src/test/camps.rs`

- [ ] **Step 1: Write the failing test** in `src/test/camps.rs`:

```rust
use crate::db::videos::{create_processing_video, VideoParent};

#[tokio::test]
async fn create_video_with_camp_parent() {
    let db = TestDbBuilder::new().build().await.unwrap();
    let coach = db.create_coach("coach").await.unwrap();
    let student = db.create_student("student").await.unwrap();
    let camp_id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'X-guard prep') RETURNING id")
        .bind(student).bind(coach)
        .fetch_one(&db.pool).await.unwrap();

    let video_id = create_processing_video(
        &db.pool, VideoParent::Camp(camp_id), "match 1", None, coach,
    ).await.unwrap();

    let (kind, got_camp): (String, i64) = sqlx::query_as(
        "SELECT parent_kind, camp_id FROM videos WHERE id = ?")
        .bind(video_id).fetch_one(&db.pool).await.unwrap();
    assert_eq!(kind, "camp");
    assert_eq!(got_camp, camp_id);
}
```

> Confirm the helper names `db.create_coach` / `db.create_student` against `src/test/utils.rs`; use whatever `src/test/threads.rs` uses to make a coach/student.

- [ ] **Step 2: Run it, verify it fails to compile** (`VideoParent::Camp` doesn't exist). Run: `nix develop .#ci --command cargo test -p syllabus-tracker create_video_with_camp_parent`. Expected: compile error `no variant named Camp`.

- [ ] **Step 3: Extend `VideoParent` + `ParentColumns`** in `src/db/videos.rs`:

```rust
pub enum VideoParent {
    Technique(i64),
    StudentProfile(i64),
    Thread(i64),
    Camp(i64),
    Loose,
}

pub struct ParentColumns {
    pub kind: &'static str,
    pub technique_id: Option<i64>,
    pub student_id: Option<i64>,
    pub thread_id: Option<i64>,
    pub camp_id: Option<i64>,
}
```

Update `columns()` — add `camp_id: None` to every existing arm and the new arm:

```rust
            VideoParent::Technique(id) => ParentColumns {
                kind: "technique", technique_id: Some(id), student_id: None, thread_id: None, camp_id: None,
            },
            VideoParent::StudentProfile(id) => ParentColumns {
                kind: "student_profile", technique_id: None, student_id: Some(id), thread_id: None, camp_id: None,
            },
            VideoParent::Thread(id) => ParentColumns {
                kind: "thread", technique_id: None, student_id: None, thread_id: Some(id), camp_id: None,
            },
            VideoParent::Camp(id) => ParentColumns {
                kind: "camp", technique_id: None, student_id: None, thread_id: None, camp_id: Some(id),
            },
            VideoParent::Loose => ParentColumns {
                kind: "loose", technique_id: None, student_id: None, thread_id: None, camp_id: None,
            },
```

Add the existence check arm in `validate_parent`:

```rust
        VideoParent::Camp(id) => {
            sqlx::query_scalar!("SELECT 1 FROM camps WHERE id = ? AND archived_at IS NULL", id)
                .fetch_optional(pool).await?.is_some()
        }
```

- [ ] **Step 4: Thread `camp_id` through every parent-column SQL site.** Search `src/db/videos.rs` for each INSERT and SELECT that lists `technique_id, student_id, thread_id` (the `next_video_position` SELECT at :84, `create_processing_video` INSERT at :120, and the embed/external insert around :180). For each:
  - Add `camp_id` to the column list and a `?` / bind `c.camp_id`.
  - In `next_video_position`, add `AND (camp_id IS ? OR (camp_id IS NULL AND ? IS NULL))` with `c.camp_id` bound twice, mirroring the other three columns.

Example for the `create_processing_video` INSERT:

```rust
        "INSERT INTO videos (
            parent_kind, technique_id, student_id, thread_id, camp_id,
            title, description, position, kind, processing_status, uploaded_by_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        c.kind,
        c.technique_id,
        c.student_id,
        c.thread_id,
        c.camp_id,
        title,
        description,
        position,
        kind,
        status,
        uploaded_by_id,
```

- [ ] **Step 5: Run the test.** Run: `nix develop .#ci --command cargo test -p syllabus-tracker create_video_with_camp_parent`. Expected: PASS.

- [ ] **Step 6: Regenerate sqlx cache + full check.** Run: `nix develop .#ci --command just sqlx-prepare` then `nix develop .#ci --command cargo check -p syllabus-tracker`. Expected: clean.

- [ ] **Step 7: Commit.**

```bash
git add crates/syllabus-tracker/src/db/videos.rs crates/syllabus-tracker/src/test/camps.rs .sqlx
git commit -m "feat(camps): support VideoParent::Camp ownership tier"
```

---

## Task 3: AnchorKind::Camp + auto-scope camp threads

**Files:**
- Modify: `crates/syllabus-tracker/src/db/threads.rs:14-118` (enum, `as_str`, `from_str_kind`, `anchor_columns`, `validate_anchor`, `create_thread`)
- Modify: `crates/syllabus-tracker/src/threads/routes.rs` (camp anchor: derive scope from camp)
- Test: `crates/syllabus-tracker/src/test/camps.rs`

- [ ] **Step 1: Write the failing test** in `src/test/camps.rs`:

```rust
use crate::db::threads::{create_thread, Anchor, AnchorKind, NewThread, ThreadVisibility};

#[tokio::test]
async fn camp_thread_is_private_scoped_to_camp_student() {
    let db = TestDbBuilder::new().build().await.unwrap();
    let coach = db.create_coach("coach").await.unwrap();
    let student = db.create_student("student").await.unwrap();
    let camp_id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'X-guard') RETURNING id")
        .bind(student).bind(coach).fetch_one(&db.pool).await.unwrap();

    let thread_id = create_thread(&db.pool, NewThread {
        author_id: coach,
        anchor: Anchor { kind: AnchorKind::Camp, id: camp_id, video_ts_seconds: None, pinned_student_id: None },
        visibility: ThreadVisibility::Private,
        scope_student_id: Some(student),
        body: "How's the prep going?".into(),
    }).await.unwrap();

    let (vis, scope, got_camp): (String, i64, i64) = sqlx::query_as(
        "SELECT visibility, scope_student_id, camp_id FROM threads WHERE id = ?")
        .bind(thread_id).fetch_one(&db.pool).await.unwrap();
    assert_eq!(vis, "private");
    assert_eq!(scope, student);
    assert_eq!(got_camp, camp_id);
}
```

- [ ] **Step 2: Run it, verify it fails to compile** (`AnchorKind::Camp` missing). Run: `nix develop .#ci --command cargo test -p syllabus-tracker camp_thread_is_private_scoped`. Expected: compile error.

- [ ] **Step 3: Extend `AnchorKind`** in `src/db/threads.rs`:

```rust
pub enum AnchorKind {
    StudentProfile,
    Technique,
    Video,
    VideoTimestamp,
    Sst,
    PinnedTechnique,
    Camp,
}
```

Add `AnchorKind::Camp => "camp"` to `as_str`, `"camp" => Some(AnchorKind::Camp)` to `from_str_kind`. Leave `allows_broadcast` unchanged (camp must not allow broadcast).

- [ ] **Step 4: Extend `anchor_columns` to a 6-tuple** (append `camp_id` as the last element). Change the signature and every arm:

```rust
#[allow(clippy::type_complexity)]
fn anchor_columns(
    anchor: &Anchor,
) -> (Option<i64>, Option<i64>, Option<i64>, Option<i64>, Option<i64>, Option<i64>) {
    match anchor.kind {
        AnchorKind::StudentProfile => (Some(anchor.id), None, None, None, None, None),
        AnchorKind::Technique => (None, Some(anchor.id), None, None, None, None),
        AnchorKind::Video => (None, None, Some(anchor.id), None, None, None),
        AnchorKind::VideoTimestamp => (None, None, Some(anchor.id), anchor.video_ts_seconds, None, None),
        AnchorKind::Sst => (None, None, None, None, Some(anchor.id), None),
        AnchorKind::PinnedTechnique => (anchor.pinned_student_id, Some(anchor.id), None, None, None, None),
        AnchorKind::Camp => (None, None, None, None, None, Some(anchor.id)),
    }
}
```

Update the `create_thread` INSERT (find where `anchor_columns` is destructured and where the threads row is inserted): destructure 6 values and add `camp_id` to the INSERT column list + a bind. Read the current INSERT in `create_thread` (just below line 200) and add `camp_id` alongside `student_id, technique_id, video_id, video_ts_seconds, sst_id`.

- [ ] **Step 5: Add the `validate_anchor` arm** for camp:

```rust
        AnchorKind::Camp => sqlx::query_scalar!(
            r#"SELECT EXISTS(SELECT 1 FROM camps WHERE id = ?) AS "e!: i64""#,
            anchor.id
        )
        .fetch_one(pool)
        .await?,
```

- [ ] **Step 6: Run the test.** Run: `nix develop .#ci --command cargo test -p syllabus-tracker camp_thread_is_private_scoped`. Expected: PASS.

- [ ] **Step 7: Make the HTTP route derive scope server-side** so a client can't mis-scope a camp thread. In `src/threads/routes.rs` `api_create_thread`, before building `NewThread`, add:

```rust
    // Camp threads are inherently scoped to the camp's student; never trust a
    // client-supplied scope for them. Coaches only (Slice 1).
    let (visibility, scope_student_id) = if kind == AnchorKind::Camp {
        user.require_permission(Permission::ManageCamps).map_err(|_| Status::Forbidden)?;
        let camp_student = sqlx::query_scalar!(
            "SELECT student_id FROM camps WHERE id = ?", req.anchor_id
        )
        .fetch_optional(pool).await.map_err(|_| Status::InternalServerError)?
        .ok_or(Status::NotFound)?;
        (ThreadVisibility::Private, Some(camp_student))
    } else {
        (visibility, req.scope_student_id)
    };
```

Then pass `visibility` and `scope_student_id` (the rebound locals) into `create_thread`. Add `AnchorKind` to the `use` at the top of `routes.rs` if not already imported.

- [ ] **Step 8: Run the threads test suite to confirm no regression.** Run: `nix develop .#ci --command cargo test -p syllabus-tracker threads`. Expected: PASS.

- [ ] **Step 9: Regenerate sqlx + commit.**

```bash
nix develop .#ci --command just sqlx-prepare
git add crates/syllabus-tracker/src/db/threads.rs crates/syllabus-tracker/src/threads/routes.rs crates/syllabus-tracker/src/test/camps.rs .sqlx
git commit -m "feat(camps): support camp thread anchor, auto-scoped to the camp student"
```

---

## Task 4: Activity camp wiring

**Files:**
- Modify: `crates/syllabus-tracker/src/db/activity.rs` (Verb enum + ALL + as_str + from_str + notifiable + coalesces + primary_entity; EntityKind; NewActivity field + builder + primary_entity_id; emit INSERT)
- Modify: `crates/syllabus-tracker/src/db/activity_read.rs:26-44` (ActivityRow.camp_id) + each SELECT
- Test: `crates/syllabus-tracker/src/test/camps.rs`

- [ ] **Step 1: Write the failing test** (emission + per-viewer scoping) in `src/test/camps.rs`:

```rust
use crate::db::activity::{emit, NewActivity, Verb};

#[tokio::test]
async fn camp_created_activity_targets_camp_student() {
    let db = TestDbBuilder::new().build().await.unwrap();
    let coach = db.create_coach("coach").await.unwrap();
    let student = db.create_student("student").await.unwrap();
    let camp_id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'X-guard') RETURNING id")
        .bind(student).bind(coach).fetch_one(&db.pool).await.unwrap();

    let mut tx = db.pool.begin().await.unwrap();
    emit(&mut tx, NewActivity::new(Verb::CampCreated, coach)
        .target_student(student)
        .camp(camp_id)
        .context_kind("camp")).await.unwrap();
    tx.commit().await.unwrap();

    let (verb, target, got_camp, ctx): (String, i64, i64, String) = sqlx::query_as(
        "SELECT verb, target_student_id, camp_id, context_kind FROM activity ORDER BY id DESC LIMIT 1")
        .fetch_one(&db.pool).await.unwrap();
    assert_eq!(verb, "camp_created");
    assert_eq!(target, student);
    assert_eq!(got_camp, camp_id);
    assert_eq!(ctx, "camp");
}
```

- [ ] **Step 2: Run it, verify it fails to compile** (`Verb::CampCreated`, `.camp()` missing). Run: `nix develop .#ci --command cargo test -p syllabus-tracker camp_created_activity`. Expected: compile error.

- [ ] **Step 3: Add the three verbs.** In `src/db/activity.rs`:
  - Add to `enum Verb`: `CampCreated, CampTechniqueAdded, CampArchived,`.
  - Add the same three to `ALL` and bump the array length `[Verb; 21]` → `[Verb; 24]`.
  - Add to `as_str`: `Verb::CampCreated => "camp_created"`, `Verb::CampTechniqueAdded => "camp_technique_added"`, `Verb::CampArchived => "camp_archived"`.
  - `notifiable`: `CampArchived` is history-only — add it to the excluded `matches!` list; `CampCreated` and `CampTechniqueAdded` stay notifiable (default true).
  - `coalesces`: camp verbs are discrete — extend the exclusion: `!matches!(self, Verb::ThreadCommentPosted | Verb::CampCreated | Verb::CampTechniqueAdded | Verb::CampArchived)`.
  - `primary_entity`: add an arm mapping all three camp verbs to `EntityKind::Camp`.

- [ ] **Step 4: Add `EntityKind::Camp`.** Find the `EntityKind` enum (used by `primary_entity`/`primary_entity_id`/`find_coalesce_target`). Add the `Camp` variant. In `find_coalesce_target`, add `EntityKind::Camp => None,` (camp verbs are non-coalescing, so this branch is never reached, mirroring `EntityKind::Thread`).

- [ ] **Step 5: Add the `camp_id` field + builder to `NewActivity`.** In the struct (after `thread_id`):

```rust
    pub camp_id: Option<i64>,
```
In `NewActivity::new`, add `camp_id: None,`. Add the builder:
```rust
    pub fn camp(mut self, id: i64) -> Self {
        self.camp_id = Some(id);
        self
    }
```
In `primary_entity_id`, add `EntityKind::Camp => self.camp_id,`.

- [ ] **Step 6: Add `camp_id` to the `emit` INSERT** (`src/db/activity.rs:324`):

```rust
    sqlx::query!(
        "INSERT INTO activity
            (occurred_at, verb, actor_user_id, target_student_id,
             technique_id, syllabus_id, sst_id, video_id, thread_id, camp_id, payload_json, context_kind)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        now, verb, ev.actor_user_id, ev.target_student_id,
        ev.technique_id, ev.syllabus_id, ev.sst_id, ev.video_id, ev.thread_id,
        ev.camp_id, ev.payload_json, ev.context_kind,
    )
```

- [ ] **Step 7: Add `camp_id` to `ActivityRow` + the read SELECTs.** In `src/db/activity_read.rs`, add `pub camp_id: Option<i64>,` to `ActivityRow` (after `thread_id`). Then in each of the SELECT query blocks (there are several — `:230`, `:314`, `:428`), add `act.camp_id AS "camp_id?: i64"` to the column list and `camp_id: r.camp_id,` to each row constructor. Search the file for `thread_id` to find every site.

- [ ] **Step 7b: Wire camp deep-link context onto the camp-thread activity emission.** In `src/db/threads.rs`, `create_thread` emits a `ThreadCommentPosted` activity for the root post and denormalizes deep-link context per anchor kind (the `match new.anchor.kind` around line 258). The `AnchorKind::Camp` arm currently sets no context (there is a `TODO(camps Task 4)` comment there). Now that `NewActivity::camp()` exists, set the camp context. Change the camp arm handling so the emitted event carries the camp link, e.g. after computing `ev`:

```rust
        AnchorKind::Camp => (None, None, None),
```
keep returning no technique/video/sst id, but before `emit`, when `new.anchor.kind == AnchorKind::Camp`, apply `ev = ev.camp(new.anchor.id).context_kind("camp");`. Add a focused test in `src/test/camps.rs` asserting that creating a camp thread produces a `thread_comment_posted` activity row with `camp_id = <camp>` and `context_kind = 'camp'`. Remove the `TODO(camps Task 4)` comment once done.

- [ ] **Step 8: Run the test.** Run: `nix develop .#ci --command cargo test -p syllabus-tracker camp_created_activity`. Expected: PASS.

- [ ] **Step 9: Run the activity suite for no regressions.** Run: `nix develop .#ci --command cargo test -p syllabus-tracker activity`. Expected: PASS.

- [ ] **Step 10: Regenerate sqlx + commit.**

```bash
nix develop .#ci --command just sqlx-prepare
git add crates/syllabus-tracker/src/db/activity.rs crates/syllabus-tracker/src/db/activity_read.rs crates/syllabus-tracker/src/test/camps.rs .sqlx
git commit -m "feat(camps): emit + read camp activity verbs with camp_id reference"
```

---

## Task 5: db/camps.rs (CRUD + camp_techniques + emission)

**Files:**
- Create: `crates/syllabus-tracker/src/db/camps.rs`
- Modify: `crates/syllabus-tracker/src/db/mod.rs` (`pub mod camps;`)
- Test: `crates/syllabus-tracker/src/test/camps.rs`

- [ ] **Step 1: Write the failing test** in `src/test/camps.rs`:

```rust
use crate::db::camps::{
    add_camp_technique, archive_camp, create_camp, get_camp, list_camps_for_student,
    list_camp_techniques, remove_camp_technique, NewCamp,
};

#[tokio::test]
async fn camp_crud_roundtrip() {
    let db = TestDbBuilder::new().build().await.unwrap();
    let coach = db.create_coach("coach").await.unwrap();
    let student = db.create_student("student").await.unwrap();
    let tech = db.create_technique("single leg x").await.unwrap();

    let camp_id = create_camp(&db.pool, NewCamp {
        student_id: student, coach_id: coach,
        name: "Worlds prep".into(), description: Some("focus".into()),
    }).await.unwrap();

    let camp = get_camp(&db.pool, camp_id).await.unwrap().unwrap();
    assert_eq!(camp.name, "Worlds prep");
    assert!(camp.archived_at.is_none());

    add_camp_technique(&db.pool, camp_id, tech, coach).await.unwrap();
    let techs = list_camp_techniques(&db.pool, camp_id).await.unwrap();
    assert_eq!(techs.len(), 1);

    remove_camp_technique(&db.pool, camp_id, tech).await.unwrap();
    assert_eq!(list_camp_techniques(&db.pool, camp_id).await.unwrap().len(), 0);

    archive_camp(&db.pool, camp_id, coach).await.unwrap();
    assert!(get_camp(&db.pool, camp_id).await.unwrap().unwrap().archived_at.is_some());

    let listed = list_camps_for_student(&db.pool, student, true).await.unwrap();
    assert_eq!(listed.len(), 1);
}
```

> Confirm `db.create_technique` exists in `src/test/utils.rs`; if not, insert a technique row directly with `INSERT INTO techniques (name) VALUES (?) RETURNING id`.

- [ ] **Step 2: Run it, verify compile failure** (module missing). Run: `nix develop .#ci --command cargo test -p syllabus-tracker camp_crud_roundtrip`. Expected: `unresolved import crate::db::camps`.

- [ ] **Step 3: Create `src/db/camps.rs`:**

```rust
//! Camps: a generic camp is a coach-curated stretch of work for one student,
//! holding library-technique membership, camp-owned videos, and camp threads.
//! Slice 1: generic only. All writes are coach-gated at the route layer.

use chrono::NaiveDateTime;
use serde::Serialize;
use sqlx::{Pool, Sqlite};
use tracing::instrument;

use crate::db::activity::{emit, NewActivity, Verb};
use crate::error::AppError;

#[derive(Debug, Clone, Serialize)]
pub struct Camp {
    pub id: i64,
    pub student_id: i64,
    pub coach_id: i64,
    pub name: String,
    pub description: Option<String>,
    pub created_at: NaiveDateTime,
    pub archived_at: Option<NaiveDateTime>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CampTechnique {
    pub technique_id: i64,
    pub name: String,
    pub description: Option<String>,
    pub position: i64,
}

pub struct NewCamp {
    pub student_id: i64,
    pub coach_id: i64,
    pub name: String,
    pub description: Option<String>,
}

#[instrument(skip(pool, new))]
pub async fn create_camp(pool: &Pool<Sqlite>, new: NewCamp) -> Result<i64, AppError> {
    let mut tx = pool.begin().await?;
    let id = sqlx::query_scalar!(
        r#"INSERT INTO camps (student_id, coach_id, name, description)
           VALUES (?, ?, ?, ?) RETURNING id AS "id!: i64""#,
        new.student_id, new.coach_id, new.name, new.description,
    )
    .fetch_one(&mut *tx)
    .await?;
    emit(&mut tx, NewActivity::new(Verb::CampCreated, new.coach_id)
        .target_student(new.student_id)
        .camp(id)
        .context_kind("camp")).await?;
    tx.commit().await?;
    Ok(id)
}

#[instrument(skip(pool))]
pub async fn get_camp(pool: &Pool<Sqlite>, id: i64) -> Result<Option<Camp>, AppError> {
    let row = sqlx::query!(
        r#"SELECT id AS "id!: i64", student_id AS "student_id!: i64",
                  coach_id AS "coach_id!: i64", name, description,
                  created_at AS "created_at!: NaiveDateTime",
                  archived_at AS "archived_at?: NaiveDateTime"
           FROM camps WHERE id = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| Camp {
        id: r.id, student_id: r.student_id, coach_id: r.coach_id,
        name: r.name, description: r.description,
        created_at: r.created_at, archived_at: r.archived_at,
    }))
}

#[instrument(skip(pool))]
pub async fn list_camps_for_student(
    pool: &Pool<Sqlite>, student_id: i64, include_archived: bool,
) -> Result<Vec<Camp>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT id AS "id!: i64", student_id AS "student_id!: i64",
                  coach_id AS "coach_id!: i64", name, description,
                  created_at AS "created_at!: NaiveDateTime",
                  archived_at AS "archived_at?: NaiveDateTime"
           FROM camps
           WHERE student_id = ? AND (? OR archived_at IS NULL)
           ORDER BY (archived_at IS NOT NULL), created_at DESC"#,
        student_id, include_archived,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| Camp {
        id: r.id, student_id: r.student_id, coach_id: r.coach_id,
        name: r.name, description: r.description,
        created_at: r.created_at, archived_at: r.archived_at,
    }).collect())
}

#[instrument(skip(pool))]
pub async fn update_camp(
    pool: &Pool<Sqlite>, id: i64, name: &str, description: Option<&str>,
) -> Result<(), AppError> {
    sqlx::query!(
        "UPDATE camps SET name = ?, description = ? WHERE id = ?",
        name, description, id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[instrument(skip(pool))]
pub async fn archive_camp(pool: &Pool<Sqlite>, id: i64, by_id: i64) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    let camp = sqlx::query!(
        r#"SELECT student_id AS "student_id!: i64" FROM camps WHERE id = ?"#, id
    ).fetch_optional(&mut *tx).await?
     .ok_or_else(|| AppError::NotFound("camp not found".into()))?;
    sqlx::query!(
        "UPDATE camps SET archived_at = CURRENT_TIMESTAMP, archived_by_id = ?
         WHERE id = ? AND archived_at IS NULL",
        by_id, id,
    ).execute(&mut *tx).await?;
    emit(&mut tx, NewActivity::new(Verb::CampArchived, by_id)
        .target_student(camp.student_id)
        .camp(id)
        .context_kind("camp")).await?;
    tx.commit().await?;
    Ok(())
}

#[instrument(skip(pool))]
pub async fn add_camp_technique(
    pool: &Pool<Sqlite>, camp_id: i64, technique_id: i64, by_id: i64,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    let camp = sqlx::query!(
        r#"SELECT student_id AS "student_id!: i64" FROM camps WHERE id = ?"#, camp_id
    ).fetch_optional(&mut *tx).await?
     .ok_or_else(|| AppError::NotFound("camp not found".into()))?;
    let position = sqlx::query_scalar!(
        r#"SELECT COALESCE(MAX(position), -1) + 1 AS "p!: i64"
           FROM camp_techniques WHERE camp_id = ?"#, camp_id
    ).fetch_one(&mut *tx).await?;
    sqlx::query!(
        "INSERT OR IGNORE INTO camp_techniques (camp_id, technique_id, position, added_by_id)
         VALUES (?, ?, ?, ?)",
        camp_id, technique_id, position, by_id,
    ).execute(&mut *tx).await?;
    emit(&mut tx, NewActivity::new(Verb::CampTechniqueAdded, by_id)
        .target_student(camp.student_id)
        .camp(camp_id)
        .technique(technique_id)
        .context_kind("camp")).await?;
    tx.commit().await?;
    Ok(())
}

#[instrument(skip(pool))]
pub async fn remove_camp_technique(
    pool: &Pool<Sqlite>, camp_id: i64, technique_id: i64,
) -> Result<(), AppError> {
    sqlx::query!(
        "DELETE FROM camp_techniques WHERE camp_id = ? AND technique_id = ?",
        camp_id, technique_id,
    ).execute(pool).await?;
    Ok(())
}

#[instrument(skip(pool))]
pub async fn list_camp_techniques(
    pool: &Pool<Sqlite>, camp_id: i64,
) -> Result<Vec<CampTechnique>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT t.id AS "technique_id!: i64", t.name, t.description,
                  ct.position AS "position!: i64"
           FROM camp_techniques ct
           JOIN techniques t ON t.id = ct.technique_id
           WHERE ct.camp_id = ?
           ORDER BY ct.position"#,
        camp_id
    ).fetch_all(pool).await?;
    Ok(rows.into_iter().map(|r| CampTechnique {
        technique_id: r.technique_id, name: r.name,
        description: r.description, position: r.position,
    }).collect())
}
```

> If `AppError::NotFound` has a different constructor shape, match `src/db/videos.rs:77`'s usage. If `create_camp`'s `RETURNING id` macro typing complains, follow the `RETURNING` pattern already used elsewhere in the crate (search `RETURNING id`).

- [ ] **Step 4: Register the module.** In `src/db/mod.rs`, add `pub mod camps;` (alphabetical, near `pub mod attempts;`).

- [ ] **Step 5: Run the test.** Run: `nix develop .#ci --command cargo test -p syllabus-tracker camp_crud_roundtrip`. Expected: PASS.

- [ ] **Step 6: Regenerate sqlx + commit.**

```bash
nix develop .#ci --command just sqlx-prepare
git add crates/syllabus-tracker/src/db/camps.rs crates/syllabus-tracker/src/db/mod.rs crates/syllabus-tracker/src/test/camps.rs .sqlx
git commit -m "feat(camps): camp CRUD + technique membership db layer with activity emission"
```

---

## Task 6: HTTP routes + mount + camp video upload

**Files:**
- Create: `crates/syllabus-tracker/src/camps/mod.rs`, `crates/syllabus-tracker/src/camps/routes.rs`
- Modify: `crates/syllabus-tracker/src/lib.rs` (`pub mod camps;`), `crates/syllabus-tracker/src/main.rs` (use + mount)
- Test: `crates/syllabus-tracker/src/test/camps.rs` (HTTP-level via test client)

- [ ] **Step 1: Write the failing HTTP test** in `src/test/camps.rs`. Mirror the request/login helpers used in `src/test/threads.rs`:

```rust
use crate::test::utils::{login_test_user, setup_test_client, create_standard_test_db};
use rocket::http::{ContentType, Status};

#[tokio::test]
async fn coach_creates_camp_student_cannot() {
    let test_db = create_standard_test_db().await;
    let (client, _db) = setup_test_client(test_db).await;

    // Coach can create.
    let coach_cookie = login_test_user(&client, "coach", "password").await;
    let resp = client.post("/api/camps")
        .cookie(coach_cookie)
        .header(ContentType::JSON)
        .body(r#"{"student_id": 2, "name": "Worlds prep", "description": null}"#)
        .dispatch().await;
    assert_eq!(resp.status(), Status::Ok);

    // Student cannot create.
    let student_cookie = login_test_user(&client, "student", "password").await;
    let resp = client.post("/api/camps")
        .cookie(student_cookie)
        .header(ContentType::JSON)
        .body(r#"{"student_id": 2, "name": "sneaky", "description": null}"#)
        .dispatch().await;
    assert_eq!(resp.status(), Status::Forbidden);
}
```

> Read `src/test/threads.rs` for the exact `login_test_user` signature, the seeded usernames/passwords, and seeded user ids (the `student_id: 2` here must match a seeded student; adjust to the real seed).

- [ ] **Step 2: Run it, verify it fails** (route 404 → `Status::NotFound`, not `Ok`). Run: `nix develop .#ci --command cargo test -p syllabus-tracker coach_creates_camp_student_cannot`. Expected: FAIL.

- [ ] **Step 3: Create `src/camps/mod.rs`:**

```rust
pub mod routes;
pub use routes::*;
```

- [ ] **Step 4: Create `src/camps/routes.rs`:**

```rust
use rocket::State;
use rocket::http::Status;
use rocket::serde::{Deserialize, Serialize, json::Json};
use sqlx::{Pool, Sqlite};
use tracing::instrument;

use crate::auth::{Permission, User};
use crate::db::camps::{
    add_camp_technique, archive_camp, create_camp, get_camp, list_camp_techniques,
    list_camps_for_student, remove_camp_technique, update_camp, Camp, CampTechnique, NewCamp,
};

fn require_camps(user: &User) -> Result<(), Status> {
    user.require_permission(Permission::ManageCamps).map_err(|_| Status::Forbidden)
}

/// A student may read only their own camps; a coach may read anyone's.
fn can_read(user: &User, camp: &Camp) -> bool {
    user.has_permission(Permission::ViewAllStudents) || camp.student_id == user.id
}

#[derive(Deserialize)]
pub struct CreateCampRequest {
    pub student_id: i64,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateCampRequest {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Deserialize)]
pub struct AddTechniqueRequest { pub technique_id: i64 }

#[derive(Serialize)]
pub struct CreatedResponse { pub id: i64 }

#[derive(Serialize)]
pub struct CampListResponse { pub camps: Vec<Camp> }

#[derive(Serialize)]
pub struct CampDetailResponse {
    #[serde(flatten)]
    pub camp: Camp,
    pub techniques: Vec<CampTechnique>,
}

#[instrument(skip(req, pool, user))]
#[post("/camps", data = "<req>")]
pub async fn api_create_camp(
    user: User, req: Json<CreateCampRequest>, pool: &State<Pool<Sqlite>>,
) -> Result<Json<CreatedResponse>, Status> {
    require_camps(&user)?;
    let id = create_camp(pool.inner(), NewCamp {
        student_id: req.student_id, coach_id: user.id,
        name: req.name.clone(), description: req.description.clone(),
    }).await.map_err(|_| Status::BadRequest)?;
    Ok(Json(CreatedResponse { id }))
}

#[instrument(skip(pool, user))]
#[get("/camps?<student_id>")]
pub async fn api_list_camps(
    user: User, student_id: i64, pool: &State<Pool<Sqlite>>,
) -> Result<Json<CampListResponse>, Status> {
    let is_coach = user.has_permission(Permission::ViewAllStudents);
    if !is_coach && student_id != user.id {
        return Err(Status::Forbidden);
    }
    let camps = list_camps_for_student(pool.inner(), student_id, true)
        .await.map_err(|_| Status::InternalServerError)?;
    Ok(Json(CampListResponse { camps }))
}

#[instrument(skip(pool, user))]
#[get("/camps/<id>")]
pub async fn api_get_camp(
    id: i64, user: User, pool: &State<Pool<Sqlite>>,
) -> Result<Json<CampDetailResponse>, Status> {
    let pool = pool.inner();
    let camp = get_camp(pool, id).await.map_err(|_| Status::InternalServerError)?
        .ok_or(Status::NotFound)?;
    if !can_read(&user, &camp) {
        return Err(Status::Forbidden);
    }
    let techniques = list_camp_techniques(pool, id).await.map_err(|_| Status::InternalServerError)?;
    Ok(Json(CampDetailResponse { camp, techniques }))
}

#[instrument(skip(req, pool, user))]
#[put("/camps/<id>", data = "<req>")]
pub async fn api_update_camp(
    id: i64, user: User, req: Json<UpdateCampRequest>, pool: &State<Pool<Sqlite>>,
) -> Result<Status, Status> {
    require_camps(&user)?;
    update_camp(pool.inner(), id, &req.name, req.description.as_deref())
        .await.map_err(|_| Status::BadRequest)?;
    Ok(Status::NoContent)
}

#[instrument(skip(pool, user))]
#[post("/camps/<id>/archive")]
pub async fn api_archive_camp(
    id: i64, user: User, pool: &State<Pool<Sqlite>>,
) -> Result<Status, Status> {
    require_camps(&user)?;
    archive_camp(pool.inner(), id, user.id).await.map_err(|_| Status::BadRequest)?;
    Ok(Status::NoContent)
}

#[instrument(skip(req, pool, user))]
#[post("/camps/<id>/techniques", data = "<req>")]
pub async fn api_add_camp_technique(
    id: i64, user: User, req: Json<AddTechniqueRequest>, pool: &State<Pool<Sqlite>>,
) -> Result<Status, Status> {
    require_camps(&user)?;
    add_camp_technique(pool.inner(), id, req.technique_id, user.id)
        .await.map_err(|_| Status::BadRequest)?;
    Ok(Status::NoContent)
}

#[instrument(skip(pool, user))]
#[delete("/camps/<id>/techniques/<technique_id>")]
pub async fn api_remove_camp_technique(
    id: i64, technique_id: i64, user: User, pool: &State<Pool<Sqlite>>,
) -> Result<Status, Status> {
    require_camps(&user)?;
    remove_camp_technique(pool.inner(), id, technique_id)
        .await.map_err(|_| Status::BadRequest)?;
    Ok(Status::NoContent)
}
```

> If `User::require_permission` / `has_permission` signatures differ, match `src/threads/routes.rs:63,66`. If `#[serde(flatten)]` on `CampDetailResponse` causes issues with Rocket's JSON, inline the fields instead.

- [ ] **Step 5: Register the module + mount the routes.** In `src/lib.rs` add `pub mod camps;` next to `pub mod threads;`. In `src/main.rs`: add `use camps::{ api_create_camp, api_list_camps, api_get_camp, api_update_camp, api_archive_camp, api_add_camp_technique, api_remove_camp_technique };` near the threads `use` (line 55), and add those seven idents to the `routes![ ... ]` block (around line 268-361) where `api_create_thread` is listed.

- [ ] **Step 6: Run the test.** Run: `nix develop .#ci --command cargo test -p syllabus-tracker coach_creates_camp_student_cannot`. Expected: PASS.

- [ ] **Step 7: Add camp video upload.** Find the existing video upload route in `src/videos/routes.rs` (search for `VideoParent::Technique` or the multipart upload handler). It already dispatches on a parent kind/id from the request. Add a `"camp"` arm that maps to `VideoParent::Camp(parent_id)` and, before accepting, calls `require_permission(Permission::ManageCamps)` (Slice 1 = coach-only). Mirror the existing arm exactly. Write a test:

```rust
#[tokio::test]
async fn coach_uploads_video_to_camp() {
    // create a camp via db, POST a small multipart video with parent_kind=camp,
    // assert 200 and that a videos row exists with parent_kind='camp'.
    // Mirror the upload test in src/test/videos.rs for the multipart body shape.
}
```

> Read `src/test/videos.rs` for the multipart upload test helper before writing this; reuse it. If video uploads are feature-flagged off in tests, gate this test the same way `src/test/videos.rs` does.

- [ ] **Step 8: Run the video upload test + full suite.** Run: `nix develop .#ci --command cargo test -p syllabus-tracker camp`. Expected: PASS.

- [ ] **Step 9: Regenerate sqlx + commit.**

```bash
nix develop .#ci --command just sqlx-prepare
git add crates/syllabus-tracker/src/camps crates/syllabus-tracker/src/lib.rs crates/syllabus-tracker/src/main.rs crates/syllabus-tracker/src/videos/routes.rs crates/syllabus-tracker/src/test/camps.rs .sqlx
git commit -m "feat(camps): camp HTTP routes, mount, and coach camp-video upload"
```

---

## Task 7: Frontend deep-link unions + tests

**Files:**
- Modify: `frontend/src/lib/entity-ref.ts`
- Modify: `frontend/src/lib/view-context.ts`
- Modify: `frontend/src/lib/activity-line.ts`
- Test: `frontend/src/lib/view-context.test.ts` (create if absent, else extend the existing deep-link unit test)

- [ ] **Step 1: Write the failing test.** In `frontend/src/lib/view-context.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { rowToViewContext, viewContextHref } from "./view-context";
import { parseFocusToken, refToken } from "./entity-ref";

describe("camp deep links", () => {
  it("round-trips a camp EntityRef token", () => {
    expect(refToken({ type: "camp", id: 7 })).toBe("camp:7");
    expect(parseFocusToken("camp:7")).toEqual({ type: "camp", id: 7 });
  });

  it("routes a camp_created row to the camp page", () => {
    const ctx = rowToViewContext({
      verb: "camp_created",
      context_kind: "camp",
      target_student_id: 3,
      syllabus_id: null,
      sst_id: null,
      technique_id: null,
      video_id: null,
      camp_id: 7,
    });
    expect(ctx).not.toBeNull();
    expect(viewContextHref(ctx!)).toBe("/camps/7?focus=camp:7");
  });

  it("routes a camp video_added row focused on the video", () => {
    const ctx = rowToViewContext({
      verb: "video_added",
      context_kind: "camp",
      target_student_id: 3,
      syllabus_id: null,
      sst_id: null,
      technique_id: null,
      video_id: 12,
      camp_id: 7,
    });
    expect(viewContextHref(ctx!)).toBe("/camps/7?focus=camp:7&video=12");
  });
});
```

- [ ] **Step 2: Run it, verify it fails.** Run: `cd frontend && npx vitest run src/lib/view-context.test.ts`. Expected: FAIL (`camp` not assignable / wrong href).

> NOTE: `.test.ts` (non-tsx, pure logic) runs in node and is safe on this box. Only `.test.tsx` (component) needs Chromium/CI.

- [ ] **Step 3: Add `camp` to `EntityRef`.** In `frontend/src/lib/entity-ref.ts`:

```ts
export type EntityRef =
  | { type: "technique"; id: number }
  | { type: "video"; id: number }
  | { type: "sst"; id: number }
  | { type: "syllabus"; id: number }
  | { type: "student"; id: number }
  | { type: "camp"; id: number };
```
Add `camp: true,` to `ENTITY_TYPE_LOOKUP`.

- [ ] **Step 4: Add the `camp` `ViewContext` arm + routing.** In `frontend/src/lib/view-context.ts`:

```ts
export type ViewContext =
  | { kind: "library"; technique: EntityRef; video?: EntityRef }
  | {
      kind: "syllabus";
      student: EntityRef; syllabus: EntityRef; sst: EntityRef; video?: EntityRef;
    }
  | { kind: "camp"; camp: EntityRef; video?: EntityRef };
```

Add the `viewContextHref` arm:

```ts
    case "camp": {
      const video = ctx.video ? `&video=${ctx.video.id}` : "";
      return `/camps/${ctx.camp.id}?focus=${refToken(ctx.camp)}${video}`;
    }
```

Add `camp_id: number | null;` to `ViewContextRow`. In `rowToViewContext`, before the existing `video_watched`/`video_added` handling, add a camp branch:

```ts
  if (row.context_kind === "camp" && row.camp_id != null) {
    return {
      kind: "camp",
      camp: { type: "camp", id: row.camp_id },
      video: row.video_id != null ? { type: "video", id: row.video_id } : undefined,
    };
  }
```

Also handle the three camp verbs (they always carry `context_kind='camp'`, so the branch above catches them). Ensure the `video_added` early-return doesn't shadow camp context: the camp check must come first.

- [ ] **Step 5: Add `describe()` arms + `camp_id` to the row type** in `frontend/src/lib/activity-line.ts`. Add `camp_id: number | null;` to the row interface (near `context_kind` at :38). Add cases to the `describe()` switch:

```ts
    case "camp_created":
      return { verb: "started a camp", href: rowHref(row) };
    case "camp_technique_added":
      return { verb: "added a technique to a camp", href: rowHref(row) };
    case "camp_archived":
      return { verb: "archived a camp", href: rowHref(row) };
```

> Match the exact return shape of the other `describe()` arms (read `:149-281`); the snippet above assumes `{ verb, href }` — adapt field names (e.g. it may be `{ description, href }`). `rowHref(row)` is the existing helper at `:80-84` that calls `rowToViewContext` + `viewContextHref`.

- [ ] **Step 6: Run the test.** Run: `cd frontend && npx vitest run src/lib/view-context.test.ts`. Expected: PASS.

- [ ] **Step 7: Typecheck.** Run: `cd frontend && npx tsc --noEmit`. Expected: clean (the exhaustive switches force every new arm to be handled).

- [ ] **Step 8: Commit.**

```bash
git add frontend/src/lib/entity-ref.ts frontend/src/lib/view-context.ts frontend/src/lib/activity-line.ts frontend/src/lib/view-context.test.ts
git commit -m "feat(camps): typed camp deep-links in EntityRef/ViewContext/activity-line"
```

---

## Task 8: Frontend API client + query/mutation hooks

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/lib/query-keys.ts`, `frontend/src/lib/queries.ts`, `frontend/src/lib/mutations.ts`

- [ ] **Step 1: Add types + fetchers to `frontend/src/lib/api.ts`.** Match the existing fetch-helper style (read `getCollection` at :252 for the wrapper/`apiFetch` convention):

```ts
export interface Camp {
  id: number;
  student_id: number;
  coach_id: number;
  name: string;
  description: string | null;
  created_at: string;
  archived_at: string | null;
}

export interface CampTechnique {
  technique_id: number;
  name: string;
  description: string | null;
  position: number;
}

export interface CampDetail extends Camp {
  techniques: CampTechnique[];
}

export async function getCampsForStudent(studentId: number): Promise<Camp[]> {
  const res = await fetch(`/api/camps?student_id=${studentId}`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load camps");
  return (await res.json()).camps;
}

export async function getCamp(id: number): Promise<CampDetail> {
  const res = await fetch(`/api/camps/${id}`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load camp");
  return res.json();
}

export async function createCamp(data: {
  student_id: number; name: string; description: string | null;
}): Promise<{ id: number }> {
  const res = await fetch("/api/camps", {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create camp");
  return res.json();
}

export async function archiveCamp(id: number): Promise<void> {
  const res = await fetch(`/api/camps/${id}/archive`, { method: "POST", credentials: "include" });
  if (!res.ok) throw new Error("Failed to archive camp");
}

export async function addCampTechnique(campId: number, techniqueId: number): Promise<void> {
  const res = await fetch(`/api/camps/${campId}/techniques`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ technique_id: techniqueId }),
  });
  if (!res.ok) throw new Error("Failed to add technique");
}

export async function removeCampTechnique(campId: number, techniqueId: number): Promise<void> {
  const res = await fetch(`/api/camps/${campId}/techniques/${techniqueId}`, {
    method: "DELETE", credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to remove technique");
}
```

> If `api.ts` uses a shared `apiFetch`/`request` wrapper rather than raw `fetch`, use that wrapper instead — match the surrounding functions exactly.

- [ ] **Step 2: Add query keys** to `frontend/src/lib/query-keys.ts` (match the `qk` object shape):

```ts
  campsForStudent: (studentId: number) => ["camps", "student", studentId] as const,
  camp: (id: number) => ["camps", id] as const,
```

- [ ] **Step 3: Add query hooks** to `frontend/src/lib/queries.ts`:

```ts
export function useCampsForStudent(studentId: number | undefined) {
  return useQuery({
    queryKey: qk.campsForStudent(studentId ?? 0),
    queryFn: studentId ? () => getCampsForStudent(studentId) : skipToken,
  });
}

export function useCamp(id: number | undefined) {
  return useQuery({
    queryKey: qk.camp(id ?? 0),
    queryFn: id ? () => getCamp(id) : skipToken,
  });
}
```
Add `getCampsForStudent, getCamp` to the `@/lib/api` import.

- [ ] **Step 4: Add mutation hooks** to `frontend/src/lib/mutations.ts` (match the `invalidateQueries` style of `useUpdateTechnique` at :206):

```ts
export function useCreateCamp(studentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; description: string | null }) =>
      createCamp({ student_id: studentId, ...data }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: qk.campsForStudent(studentId) }); },
  });
}

export function useArchiveCamp(studentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => archiveCamp(id),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: qk.campsForStudent(studentId) });
      qc.invalidateQueries({ queryKey: qk.camp(id) });
    },
  });
}

export function useAddCampTechnique(campId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (techniqueId: number) => addCampTechnique(campId, techniqueId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: qk.camp(campId) }); },
  });
}

export function useRemoveCampTechnique(campId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (techniqueId: number) => removeCampTechnique(campId, techniqueId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: qk.camp(campId) }); },
  });
}
```
Add the four api functions to the `@/lib/api` import in `mutations.ts`.

- [ ] **Step 5: Typecheck.** Run: `cd frontend && npx tsc --noEmit`. Expected: clean.

- [ ] **Step 6: Commit.**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/query-keys.ts frontend/src/lib/queries.ts frontend/src/lib/mutations.ts
git commit -m "feat(camps): frontend camp api client + query/mutation hooks"
```

---

## Task 9: TechniqueRow `camp` RowContext

**Files:**
- Modify: `frontend/src/components/technique-row/technique-row-context.ts`
- Modify: `frontend/src/components/technique-row/block-visibility.ts`
- Modify: `frontend/src/components/technique-row/technique-row.tsx:75-86` (viewerIsOwner switch)

- [ ] **Step 1: Add the `camp` kind to `RowContext`.** In `technique-row-context.ts`, append to the union:

```ts
  | {
      kind: "camp";
      campId: number;
      studentId: number;
      /** Display name for the surface breadcrumb; null when the owner views their own. */
      studentName?: string | null;
      /** Coach-only: remove the technique from the camp. Absent for students. */
      onRemove?: (technique: LibraryTechniqueRow) => void;
    };
```

- [ ] **Step 2: Add the `camp` row to `BLOCK_VISIBILITY`** in `block-visibility.ts`. Camp techniques reference global library techniques; show read blocks for everyone, edit-definition for coaches (edits the global technique), no status/attempts/pins:

```ts
  camp: {
    student: ["description", "tags", "videos", "discussion"],
    coach: ["description", "tags", "videos", "edit-definition", "discussion"],
    admin: ["description", "tags", "videos", "edit-definition", "discussion"],
  },
```

The `satisfies Record<RowKind, ...>` will fail to compile until this cell exists — that is the guard working.

- [ ] **Step 3: Handle `camp` in the `viewerIsOwner` switch** in `technique-row.tsx`:

```ts
      case "camp":
        return user.id === context.studentId;
```

- [ ] **Step 4: Typecheck.** Run: `cd frontend && npx tsc --noEmit`. Expected: clean. The exhaustive switches in `technique-row.tsx` and any block reading `context.kind` will surface every site that needs the `camp` arm; add a passthrough/no-op arm wherever the compiler points (e.g. blocks that branch on `kind` for coach affordances — mirror the `global-library` behaviour).

- [ ] **Step 5: Commit.**

```bash
git add frontend/src/components/technique-row/technique-row-context.ts frontend/src/components/technique-row/block-visibility.ts frontend/src/components/technique-row/technique-row.tsx
git commit -m "feat(camps): camp RowContext variant for the shared technique row"
```

---

## Task 10: Camp list page + profile hub link + route

**Files:**
- Create: `frontend/src/app/student-camps/page.tsx`
- Modify: `frontend/src/app/student-profile/page.tsx:140-151` (hub links)
- Modify: `frontend/src/App.tsx` (lazy import + route)

- [ ] **Step 1: Create `frontend/src/app/student-camps/page.tsx`:**

```tsx
import { Navigate, useParams, Link } from "react-router-dom";
import { Dumbbell, ChevronRight } from "lucide-react";
import { useUser } from "@/lib/current-user-context";
import { isCoachOrAdmin } from "@/lib/api";
import { useCampsForStudent } from "@/lib/queries";

export default function StudentCampsPage() {
  const params = useParams<{ id: string }>();
  const studentId = params.id ? parseInt(params.id, 10) : NaN;
  const viewer = useUser();
  if (!Number.isFinite(studentId)) return <Navigate to="/dashboard" replace />;

  const isOwner = viewer.id === studentId;
  const isCoach = isCoachOrAdmin(viewer);
  if (!isOwner && !isCoach) return <Navigate to="/dashboard" replace />;

  const campsQuery = useCampsForStudent(studentId);
  const camps = campsQuery.data ?? [];
  const active = camps.filter((c) => !c.archived_at);
  const archived = camps.filter((c) => c.archived_at);

  return (
    <div className="container mx-auto space-y-6 px-4 py-6 sm:px-6 md:py-8">
      <h1 className="text-base font-semibold">{isOwner ? "My camps" : "Camps"}</h1>

      <Section title="Active" camps={active} loading={campsQuery.isLoading}
        empty="No active camps." />
      {archived.length > 0 && <Section title="Archived" camps={archived} loading={false} empty="" />}
    </div>
  );
}

function Section({
  title, camps, loading, empty,
}: { title: string; camps: { id: number; name: string; description: string | null }[]; loading: boolean; empty: string }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {loading ? (
          <div className="h-12 animate-pulse bg-muted" />
        ) : camps.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">{empty}</p>
        ) : (
          camps.map((c, i) => (
            <Link key={c.id} to={`/camps/${c.id}`}
              className={`flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40 ${i < camps.length - 1 ? "border-b border-border" : ""}`}>
              <Dumbbell className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{c.name}</p>
                {c.description && <p className="truncate text-xs text-muted-foreground">{c.description}</p>}
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          ))
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Add the Camps hub link** in `student-profile/page.tsx`. Import `Dumbbell` from `lucide-react`, and add a `HubLink` after the Pinned one (move `last` onto Camps):

```tsx
          <HubLink
            to={`/student/${studentId}/pinned`}
            icon={Pin}
            title={isOwnView ? "Pinned" : "Pinned techniques"}
          />
          <HubLink
            to={`/student/${studentId}/camps`}
            icon={Dumbbell}
            title="Camps"
            last
          />
```

- [ ] **Step 3: Add the route** in `App.tsx`. Add the lazy import near the others (line ~52):

```tsx
const StudentCampsPage = lazy(() => import('./app/student-camps/page'));
```
Add the route alongside `/student/:id/activity` (line ~341), using the same guard wrapper the neighbouring routes use:

```tsx
      <Route
        path="/student/:id/camps"
        element={<StudentCampsPage />}
      />
```

> Match the exact `element=` wrapper (route guard component) the sibling `/student/:id/pinned` route uses at line ~301; copy that structure.

- [ ] **Step 4: Typecheck + build.** Run: `cd frontend && npx tsc --noEmit && npx vite build`. Expected: clean.

- [ ] **Step 5: Commit.**

```bash
git add frontend/src/app/student-camps/page.tsx frontend/src/app/student-profile/page.tsx frontend/src/App.tsx
git commit -m "feat(camps): student camps list page + profile hub link + route"
```

---

## Task 11: Camp detail page + route + focus consumption

**Files:**
- Create: `frontend/src/app/camps/[id]/page.tsx`
- Modify: `frontend/src/App.tsx` (lazy import + route)

- [ ] **Step 1: Create `frontend/src/app/camps/[id]/page.tsx`.** Header + camp techniques (reuse `TechniqueRow` with the `camp` context) + camp discussion (reuse `ThreadView`/`ThreadComposer` with `anchorKind="camp"`). Consume the `focus=` token:

```tsx
import { useState } from "react";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Accordion } from "@/components/ui/accordion";
import { useUser } from "@/lib/current-user-context";
import { isCoachOrAdmin } from "@/lib/api";
import { useCamp, useThreadsForAnchor } from "@/lib/queries";
import { useCreateThread } from "@/lib/mutations";
import { useArchiveCamp, useRemoveCampTechnique } from "@/lib/mutations";
import { TechniqueRow } from "@/components/technique-row/technique-row";
import { ThreadView } from "@/components/threads/thread-view";
import { ThreadComposer } from "@/components/threads/thread-composer";
import { parseFocusToken } from "@/lib/entity-ref";

export default function CampDetailPage() {
  const params = useParams<{ id: string }>();
  const campId = params.id ? parseInt(params.id, 10) : NaN;
  const viewer = useUser();
  const [searchParams] = useSearchParams();
  const focus = parseFocusToken(searchParams.get("focus"));
  const focusVideoId = searchParams.get("video");

  if (!Number.isFinite(campId)) return <Navigate to="/dashboard" replace />;

  const campQuery = useCamp(campId);
  const camp = campQuery.data;
  const isCoach = isCoachOrAdmin(viewer);

  const threadsQuery = useThreadsForAnchor("camp", campId);
  const createThread = useCreateThread();
  const removeTechnique = useRemoveCampTechnique(campId);

  // Default the technique accordion open to the focused technique, if any.
  const [openValue, setOpenValue] = useState<string | undefined>(undefined);

  if (campQuery.isLoading || !camp) {
    return <div className="container mx-auto px-4 py-6"><div className="h-6 w-40 animate-pulse rounded bg-muted" /></div>;
  }

  const viewerIsOwner = viewer.id === camp.student_id;
  if (!viewerIsOwner && !isCoach) return <Navigate to="/dashboard" replace />;

  async function startThread(body: string) {
    try {
      await createThread.mutateAsync({
        anchor_kind: "camp", anchor_id: campId,
        visibility: "private", scope_student_id: camp!.student_id, body,
      });
    } catch {
      toast.error("Couldn't post your thread.");
    }
  }

  return (
    <div className="container mx-auto space-y-6 px-4 py-6 sm:px-6 md:py-8">
      <header className="space-y-1">
        <h1 className="text-base font-semibold">{camp.name}</h1>
        {camp.description && <p className="text-sm text-muted-foreground">{camp.description}</p>}
        {camp.archived_at && <span className="text-xs text-muted-foreground">Archived</span>}
      </header>

      <section className="space-y-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Techniques</h2>
        {camp.techniques.length === 0 ? (
          <p className="text-sm text-muted-foreground">No techniques yet.</p>
        ) : (
          <Accordion type="single" collapsible value={openValue} onValueChange={setOpenValue}>
            {camp.techniques.map((t) => {
              const value = `tech-${t.technique_id}`;
              const isOpen = value === openValue
                || (focus?.type === "technique" && focus.id === t.technique_id);
              return (
                <TechniqueRow
                  key={t.technique_id}
                  technique={{ id: t.technique_id, name: t.name, description: t.description } as never}
                  context={{
                    kind: "camp",
                    campId,
                    studentId: camp.student_id,
                    onRemove: isCoach
                      ? () => removeTechnique.mutate(t.technique_id)
                      : undefined,
                  }}
                  value={value}
                  isOpen={isOpen}
                  scrollToVideoId={focusVideoId ? Number(focusVideoId) : null}
                />
              );
            })}
          </Accordion>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Discussion</h2>
        <div className="space-y-4 rounded-lg border border-border bg-card p-4">
          {(threadsQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No discussion yet.</p>
          ) : (
            (threadsQuery.data ?? []).map((t) => (
              <ThreadView key={t.id} thread={t} anchorKind="camp" anchorId={campId} />
            ))
          )}
          <ThreadComposer
            placeholder="Start a thread..."
            submitLabel="Post"
            pending={createThread.isPending}
            onSubmit={startThread}
          />
        </div>
      </section>
    </div>
  );
}
```

> The `technique={... as never}` cast is a placeholder for the real `LibraryTechniqueRow` shape — before finalizing, fetch the camp techniques in the shape `TechniqueRow` expects. Read `LibraryTechniqueRow` in `api.ts` and either (a) widen `CampTechnique`/`list_camp_techniques` in Task 5 to return the full library-row shape (reuse the existing library-row SELECT, joining `camp_techniques`), or (b) map the fields. Prefer (a): make `GET /api/camps/<id>` return `techniques: LibraryTechniqueRow[]` so no cast is needed. Update the Task 5 query + the `CampTechnique`→`LibraryTechniqueRow` type accordingly when you reach this step.

- [ ] **Step 2: Confirm `useThreadsForAnchor` accepts `"camp"`.** It takes an `anchor_kind` string and passes it to `GET /api/threads`. The backend already accepts `camp` (Task 3). Confirm the TS type of the hook's first arg is a string union that includes `"camp"`; if it's a closed union, add `"camp"` to it (search `useThreadsForAnchor` in `queries.ts`). Likewise confirm `ThreadView`/`ThreadComposer` `anchorKind` prop type accepts `"camp"`; widen if it's a closed union.

- [ ] **Step 3: Add the route** in `App.tsx`:

```tsx
const CampDetailPage = lazy(() => import('./app/camps/[id]/page'));
```
```tsx
      <Route path="/camps/:id" element={<CampDetailPage />} />
```
Use the same guarded-route wrapper as the sibling authenticated routes.

- [ ] **Step 4: Typecheck + build.** Run: `cd frontend && npx tsc --noEmit && npx vite build`. Expected: clean.

- [ ] **Step 5: Commit.**

```bash
git add frontend/src/app/camps frontend/src/App.tsx frontend/src/lib/queries.ts
git commit -m "feat(camps): camp detail page with technique rows, discussion, and focus deep-link"
```

---

## Task 12: Camp page component test + full verify + PR

**Files:**
- Create: `frontend/src/app/camps/[id]/camp-detail.test.tsx`

- [ ] **Step 1: Write a component test** (`.test.tsx`, Chromium/CI). Stub `window.fetch`, use `renderWithProviders` + `buildUser` (per the project's vitest-browser convention):

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderWithProviders, buildUser } from "@/test/utils";
import CampDetailPage from "./page";

describe("CampDetailPage", () => {
  beforeEach(() => {
    vi.spyOn(window, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/api/camps/1")) {
        return new Response(JSON.stringify({
          id: 1, student_id: 2, coach_id: 1, name: "Worlds prep",
          description: "focus", created_at: "2026-06-16T00:00:00Z",
          archived_at: null, techniques: [],
        }), { status: 200 });
      }
      if (u.includes("/api/threads")) {
        return new Response(JSON.stringify({ threads: [] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
  });

  it("renders the camp name and empty states", async () => {
    renderWithProviders(<CampDetailPage />, {
      user: buildUser({ id: 1, role: "coach" }),
      route: "/camps/1",
      path: "/camps/:id",
    });
    expect(await screenFindText("Worlds prep")).toBeTruthy();
  });
});
```

> Read `frontend/src/test/utils.ts` for the exact `renderWithProviders` signature (route/path params) and the correct query helper (`screen.findByText` etc.); match an existing `.test.tsx` such as `student-activity.test.tsx`.

- [ ] **Step 2: Run the full frontend test + lint.** Run: `cd frontend && npm run lint && npx tsc --noEmit`. (Browser `.test.tsx` runs in CI; locally rely on lint + typecheck per the project's NixOS constraint.) Expected: clean.

- [ ] **Step 3: Run the full backend gate.** Run: `nix develop .#ci --command just verify`. Expected: PASS (offline build + lint + tests).

- [ ] **Step 4: Regenerate sqlx one final time if any query changed in Task 11.** Run: `nix develop .#ci --command just sqlx-prepare` and commit `.sqlx` if it changed.

- [ ] **Step 5: Commit + push + open PR.**

```bash
git add frontend/src/app/camps/[id]/camp-detail.test.tsx
git commit -m "test(camps): camp detail page render test"
git push -u origin feat/camps-slice-1
gh pr create --base main --title "feat: camps Slice 1 (generic camp spine)" --body "$(cat <<'EOF'
Implements the generic-camp spine per docs/superpowers/specs/2026-06-16-camps-slice-1-design.md.

- camps + camp_techniques tables; camp parent/anchor on videos/threads/activity
- VideoParent::Camp ownership (global-hide only, Approach A — forward-compatible with the video-tiers unified resolver)
- camp threads auto-scoped to the camp student
- camp activity verbs with typed deep-linking + per-viewer scoping
- coach-only ManageCamps writes; relationship-derived footage authz documented, student upload deferred
- frontend: camp list + detail pages, profile hub link, deep-link unions

Out of scope (named deps): competitions/matches, scoped techniques, per-camp video visibility.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review (run before handing off to execution)

**Spec coverage** (against `2026-06-16-camps-slice-1-design.md`):
- §1 tables → Task 1. §2 video/thread/activity parent extension → Tasks 1-4. §2a viewer scoping + deep-link → Tasks 4, 7. §3 ownership/global-hide → Task 2 + camp video read uses global hide (no override rows written). §4 footage authz (coach branch) → Task 6 upload route gate. §5 routes → Task 6. §6 frontend → Tasks 9-11. §8 testing → Tasks 1-12.
- §3 "single resolver helper `effective_camp_video_visible`": camp video read currently flows through the existing video list query filtered by `parent_kind='camp' AND hidden_at IS NULL`. **Gap to close in execution:** when wiring the camp detail page's camp-video list (folded into Task 11's camp-detail GET widening, or a follow-up `GET /api/camps/<id>/videos`), route it through one helper so the future `scope_kind='camp'` rung lands in one place. If camp-owned video display is not reached in Slice 1's detail page, capture it as a fast-follow — the schema + VideoParent already support upload (Task 6).

**Placeholder scan:** the two `> NOTE`/`>` confirm-against-source callouts (TechniqueRow shape in Task 11; helper/seed names) are verification instructions, not placeholders — each names the exact file to check and the concrete fallback. Resolve the Task 11 `as never` cast by widening the camp-techniques payload to `LibraryTechniqueRow[]` (preferred path stated inline).

**Type consistency:** `VideoParent::Camp`, `AnchorKind::Camp`, `Verb::CampCreated/CampTechniqueAdded/CampArchived`, `EntityKind::Camp`, `NewActivity.camp()/camp_id`, `Permission::ManageCamps`, `EntityRef{type:"camp"}`, `ViewContext{kind:"camp"}`, `RowContext{kind:"camp"}` used consistently across backend and frontend tasks. Route idents in Task 6 match the `use` + `routes![]` registration list.
