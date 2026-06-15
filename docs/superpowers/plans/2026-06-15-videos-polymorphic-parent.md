# Videos Polymorphic Parent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple `videos` from its hardcoded `technique_id NOT NULL` parent so a video can belong to a technique, a student profile, a thread (video reply), or nothing (loose), with the camp/match parents added later when those tables exist.

**Architecture:** Mirror the existing `threads` typed-column polymorphism (a `parent_kind` TEXT discriminator + one nullable FK column per kind + a CHECK matrix enforcing exactly-one-parent), NOT the loose `parent_kind/parent_id` pair the CSV literally suggests — typed columns keep FK integrity and cascade deletes. The schema is changed declaratively (edit `config/schema.sql`; the `migration-engine` diffs and rebuilds the table). The DB write path moves from "create video for technique_id" to "create video for a `VideoParent`". The CX-010 rule (no new thread on a video that is itself a thread reply) is enforced as an API guard in thread creation and as a hidden affordance in the frontend.

**Tech Stack:** Rust + Rocket + SQLx (compile-time-checked, offline cache) + SQLite (declarative migrator) on the backend; React 19 + Vite + TS on the frontend. Tests: Rust `#[tokio::test]` via `rocket::local` client + Vitest.

**Out of scope (their own later PRs):** camp/match parent kinds (need CC tables first); the actual upload UIs for profile/loose/thread videos; the full video-reply thread flow. This slab delivers the *data model + DB primitive + guards* so those PRs are unblocked.

---

## Background the engineer needs

**The declarative migrator.** There are no migration scripts. `config/schema.sql` is the single source of truth. On boot (`just migrate`), `crates/migration-engine` builds a pristine in-memory DB from `schema.sql`, diffs it against the live DB, and for a changed table runs SQLite's table-rebuild: create `videos_migration_new`, `INSERT ... SELECT <common columns>`, drop old, rename. FK enforcement is OFF during the rebuild and a `PRAGMA foreign_key_check` runs before commit. **Consequence:** new columns get their schema DEFAULT for existing rows (they are not "common columns" copied from the old table). So a new `parent_kind` column MUST be `NOT NULL DEFAULT 'technique'` for existing rows to satisfy the CHECK matrix after the rebuild.

**SQLx offline cache.** Queries are compile-time-checked against `.sqlx/`. After changing any `query!`/`query_as!` SQL or the `videos` columns, regenerate with `nix develop .#ci --command just sqlx-prepare`. Never run bare `cargo sqlx prepare` on the seeded dev DB (see project memory `sqlx-check-seed-dependency`). The CI gate is the offline build, not `sqlx-check`.

**Models are already half-ready.** `crates/syllabus-tracker/src/models.rs`: `DbVideo.technique_id` is already `Option<i64>` (line ~230) and `Video` derives it via `db.technique_id.unwrap_or_default()` (line ~255). So making the column nullable is transparent to the row-mapping layer — the `query_as!(DbVideo, ...)` calls keep compiling because SQLx already permits an `Option<T>` field over a (currently) NOT NULL column.

**The threads precedent to copy** lives in `crates/syllabus-tracker/src/db/threads.rs`: `AnchorKind` enum with `as_str`/`from_str_kind`, an `anchor_columns()` resolver returning the typed column tuple, and `validate_anchor()` confirming the parent row exists. Replicate that shape for videos.

**Commands (run inside the nix CI shell):**
- Backend tests: `nix develop .#ci --command just test-backend`
- A single backend test: `nix develop .#ci --command cargo test -p syllabus-tracker <test_name> -- --nocapture`
- Frontend tests: `nix develop .#ci --command just test-frontend` (Vitest runs in Chromium; only in CI/nix, not on the bare NixOS box — see memory `vitest-browser-fetch-stub`)
- Regenerate offline SQL: `nix develop .#ci --command just sqlx-prepare`
- Full gate: `nix develop .#ci --command just verify`

---

## File Structure

**Modified:**
- `config/schema.sql` — `videos` table: add `parent_kind`, `student_id`, `thread_id`; drop `NOT NULL` on `technique_id`; add CHECK matrix; add `idx_videos_parent`.
- `crates/syllabus-tracker/src/db/videos.rs` — new `VideoParent` enum + `parent_columns()` + `validate_parent()`; `create_processing_video`/`create_external_video`/`next_video_position` take a `VideoParent`; new `list_videos_for_parent_global_visible`; `get_db_video`/list reads also select the three new columns.
- `crates/syllabus-tracker/src/models.rs` — `DbVideo` gains `parent_kind`, `student_id`, `thread_id`; `Video` exposes `parent_kind: String` + makes `technique_id: Option<i64>`.
- `crates/syllabus-tracker/src/db/threads.rs` — `validate_anchor()` rejects a `Video`/`VideoTimestamp` anchor whose target video has `parent_kind = 'thread'`.
- `crates/syllabus-tracker/src/videos/routes.rs` — existing technique upload calls the new parent-aware create with `VideoParent::Technique(tid)` (behavior unchanged); `Video` serialization carries `parent_kind`.
- `frontend/src/lib/entity-ref.ts` — (no change required this slab; note only).
- `frontend/src/components/videos/review/moment-feed.tsx` and/or `frontend/src/components/threads/thread-view.tsx` — hide the "start a thread at this timestamp" affordance when the video's `parent_kind === "thread"`.
- `frontend/src/<video type>.ts` — frontend `Video` type gains `parent_kind: string` and `technique_id: number | null`.

**Created:**
- Tests live alongside existing ones in `crates/syllabus-tracker/src/test/videos.rs` and `crates/syllabus-tracker/src/test/threads.rs`.

---

## Task 1: Schema — make `videos` polymorphic

**Files:**
- Modify: `config/schema.sql` (the `videos` table + a new index)

- [ ] **Step 1: Edit the `videos` table in `config/schema.sql`**

Change the `technique_id` line to drop `NOT NULL`, and add the three parent columns + CHECK matrix just before the existing `deleted_at`/`hidden_at` columns. Final column set:

```sql
CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY,
    -- Parent is polymorphic (typed-column pattern, mirrors threads.anchor_kind).
    -- DEFAULT 'technique' so the declarative table-rebuild backfills existing
    -- rows (which all have technique_id set) into the technique branch.
    parent_kind TEXT NOT NULL DEFAULT 'technique' CHECK (parent_kind IN (
        'technique', 'student_profile', 'thread', 'loose'
    )),
    technique_id INTEGER REFERENCES techniques (id) ON DELETE CASCADE,
    student_id INTEGER REFERENCES users (id) ON DELETE CASCADE,
    thread_id INTEGER REFERENCES threads (id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    kind TEXT NOT NULL,
    processing_status TEXT NOT NULL,
    processing_error TEXT,
    storage_key TEXT,
    bytes INTEGER,
    duration_seconds INTEGER,
    width INTEGER,
    height INTEGER,
    external_url TEXT,
    external_host TEXT,
    external_video_id TEXT,
    uploaded_by_id INTEGER NOT NULL REFERENCES users (id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP,
    hidden_at TIMESTAMP,
    CHECK (
      (parent_kind = 'technique'       AND technique_id IS NOT NULL AND student_id IS NULL     AND thread_id IS NULL) OR
      (parent_kind = 'student_profile' AND student_id IS NOT NULL    AND technique_id IS NULL   AND thread_id IS NULL) OR
      (parent_kind = 'thread'          AND thread_id IS NOT NULL      AND technique_id IS NULL   AND student_id IS NULL) OR
      (parent_kind = 'loose'           AND technique_id IS NULL       AND student_id IS NULL     AND thread_id IS NULL)
    )
);
```

Keep the existing explanatory comments on `deleted_at`/`hidden_at` (omitted here for brevity — do not delete them).

- [ ] **Step 2: Add a parent lookup index** below the table (near other `CREATE INDEX` lines in the file):

```sql
CREATE INDEX IF NOT EXISTS idx_videos_parent
    ON videos (parent_kind, technique_id, student_id, thread_id);
```

- [ ] **Step 3: Apply the migration against a scratch copy of the dev DB and verify the rebuild is clean**

Run: `nix develop .#ci --command just migrate`
Expected: migration reports "Modifying table videos" (+ new index), completes with no "Foreign key violations" and no CHECK failure. Existing rows survive with `parent_kind='technique'`.

- [ ] **Step 4: Sanity-check existing rows landed in the technique branch**

Run: `nix develop .#ci --command sqlite3 sqlite.db "SELECT parent_kind, COUNT(*) FROM videos GROUP BY parent_kind;"`
Expected: a single `technique|<n>` row (all pre-existing videos), no other kinds, no NULL parent_kind.

- [ ] **Step 5: Commit**

```bash
git add config/schema.sql
git commit -m "feat(videos): add polymorphic parent columns to videos schema"
```

---

## Task 2: `VideoParent` enum + column resolver + validation

**Files:**
- Modify: `crates/syllabus-tracker/src/db/videos.rs` (add enum + helpers near the top, after imports)
- Test: `crates/syllabus-tracker/src/db/videos.rs` (a `#[cfg(test)] mod parent_tests` at the bottom for the pure logic)

- [ ] **Step 1: Write the failing unit test for the column resolver**

Add at the bottom of `crates/syllabus-tracker/src/db/videos.rs`:

```rust
#[cfg(test)]
mod parent_tests {
    use super::*;

    #[test]
    fn parent_columns_map_each_kind_to_exactly_one_id() {
        assert_eq!(
            VideoParent::Technique(7).columns(),
            ParentColumns { kind: "technique", technique_id: Some(7), student_id: None, thread_id: None }
        );
        assert_eq!(
            VideoParent::StudentProfile(3).columns(),
            ParentColumns { kind: "student_profile", technique_id: None, student_id: Some(3), thread_id: None }
        );
        assert_eq!(
            VideoParent::Thread(11).columns(),
            ParentColumns { kind: "thread", technique_id: None, student_id: None, thread_id: Some(11) }
        );
        assert_eq!(
            VideoParent::Loose.columns(),
            ParentColumns { kind: "loose", technique_id: None, student_id: None, thread_id: None }
        );
    }
}
```

- [ ] **Step 2: Run it to verify it fails to compile**

Run: `nix develop .#ci --command cargo test -p syllabus-tracker parent_columns_map -- --nocapture`
Expected: FAIL — `cannot find type VideoParent` / `ParentColumns`.

- [ ] **Step 3: Add the enum, `ParentColumns`, `columns()`, and `validate_parent()`** near the top of `videos.rs` (after the `use` block):

```rust
/// The kinds of thing a video can hang off. Typed-column polymorphism,
/// mirrors `threads::AnchorKind`. Camp and match parents are added when
/// those tables exist.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VideoParent {
    Technique(i64),
    StudentProfile(i64),
    /// A video reply living under a thread. Per CX-010 a thread can NOT be
    /// started on a video whose parent is a thread (no endless reply chains);
    /// that guard lives in `db::threads::validate_anchor`.
    Thread(i64),
    Loose,
}

/// The four typed columns a `VideoParent` resolves to in the `videos` table.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ParentColumns {
    pub kind: &'static str,
    pub technique_id: Option<i64>,
    pub student_id: Option<i64>,
    pub thread_id: Option<i64>,
}

impl VideoParent {
    pub fn columns(self) -> ParentColumns {
        match self {
            VideoParent::Technique(id) => ParentColumns {
                kind: "technique", technique_id: Some(id), student_id: None, thread_id: None,
            },
            VideoParent::StudentProfile(id) => ParentColumns {
                kind: "student_profile", technique_id: None, student_id: Some(id), thread_id: None,
            },
            VideoParent::Thread(id) => ParentColumns {
                kind: "thread", technique_id: None, student_id: None, thread_id: Some(id),
            },
            VideoParent::Loose => ParentColumns {
                kind: "loose", technique_id: None, student_id: None, thread_id: None,
            },
        }
    }
}

/// Confirms the parent row exists before inserting a video against it.
/// Loose has no parent to check.
#[instrument(skip(pool))]
pub async fn validate_parent(pool: &Pool<Sqlite>, parent: VideoParent) -> Result<(), AppError> {
    let exists = match parent {
        VideoParent::Technique(id) => {
            sqlx::query_scalar!("SELECT 1 FROM techniques WHERE id = ?", id)
                .fetch_optional(pool).await?.is_some()
        }
        VideoParent::StudentProfile(id) => {
            sqlx::query_scalar!("SELECT 1 FROM users WHERE id = ?", id)
                .fetch_optional(pool).await?.is_some()
        }
        VideoParent::Thread(id) => {
            sqlx::query_scalar!("SELECT 1 FROM threads WHERE id = ? AND deleted_at IS NULL", id)
                .fetch_optional(pool).await?.is_some()
        }
        VideoParent::Loose => true,
    };
    if exists {
        Ok(())
    } else {
        Err(AppError::NotFound)
    }
}
```

Confirm `AppError::NotFound` exists (grep `crates/syllabus-tracker/src/error.rs`); if the variant is named differently, use the existing not-found variant.

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `nix develop .#ci --command cargo test -p syllabus-tracker parent_columns_map -- --nocapture`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/syllabus-tracker/src/db/videos.rs
git commit -m "feat(videos): add VideoParent enum and column resolver"
```

---

## Task 3: Models carry the parent

**Files:**
- Modify: `crates/syllabus-tracker/src/models.rs` (`DbVideo` ~line 228, `Video` ~line 197, `From<DbVideo> for Video` ~line 250)

- [ ] **Step 1: Add the new columns to `DbVideo`**

In `struct DbVideo`, add (keep `technique_id: Option<i64>` as-is):

```rust
    pub parent_kind: String,
    pub student_id: Option<i64>,
    pub thread_id: Option<i64>,
```

- [ ] **Step 2: Expose them on the API `Video`**

In `struct Video`, add `pub parent_kind: String,` and change `pub technique_id: i64,` to `pub technique_id: Option<i64>,`. Add `pub student_id: Option<i64>,` and `pub thread_id: Option<i64>,`.

- [ ] **Step 3: Update `From<DbVideo> for Video`**

Replace `technique_id: db.technique_id.unwrap_or_default(),` with `technique_id: db.technique_id,` and carry the new fields:

```rust
            parent_kind: db.parent_kind,
            technique_id: db.technique_id,
            student_id: db.student_id,
            thread_id: db.thread_id,
```

(Adjust field order to match the struct. `parent_kind` is moved out of `db` by value, so place it appropriately or `.clone()` if `db` is used afterward — it is not, so move is fine.)

- [ ] **Step 4: Verify it does not yet compile (queries don't select the new columns)**

Run: `nix develop .#ci --command cargo build -p syllabus-tracker`
Expected: FAIL — `query_as!(DbVideo, ...)` rows are missing `parent_kind`/`student_id`/`thread_id`. This is expected; Task 4 fixes the SELECTs.

- [ ] **Step 5: Commit (allowed to be red between stacked tasks; the slab is verified green at Task 8)**

```bash
git add crates/syllabus-tracker/src/models.rs
git commit -m "feat(videos): carry parent_kind/student_id/thread_id on video models"
```

---

## Task 4: DB write + read path goes through `VideoParent`

**Files:**
- Modify: `crates/syllabus-tracker/src/db/videos.rs` (`next_video_position`, `create_processing_video`, `create_external_video`, every `SELECT ... FROM videos` mapping `DbVideo`, add `list_videos_for_parent_global_visible`)
- Modify: `crates/syllabus-tracker/src/videos/routes.rs` (call site of `create_processing_video`)

- [ ] **Step 1: Generalize `next_video_position` to a parent**

Replace the body to scope position per parent (existing technique behavior preserved):

```rust
#[instrument(skip(pool))]
pub async fn next_video_position(pool: &Pool<Sqlite>, parent: VideoParent) -> Result<i64, AppError> {
    let c = parent.columns();
    let row = sqlx::query!(
        "SELECT COALESCE(MAX(position), -1) AS max_position
         FROM videos
         WHERE deleted_at IS NULL
           AND parent_kind = ?
           AND (technique_id IS ? OR (technique_id IS NULL AND ? IS NULL))
           AND (student_id   IS ? OR (student_id   IS NULL AND ? IS NULL))
           AND (thread_id    IS ? OR (thread_id    IS NULL AND ? IS NULL))",
        c.kind,
        c.technique_id, c.technique_id,
        c.student_id, c.student_id,
        c.thread_id, c.thread_id,
    )
    .fetch_one(pool)
    .await?;
    Ok(row.max_position + 1)
}
```

If SQLx's macro rejects the `IS ?` form, fall back to matching on `parent_kind` + a single non-null id via a `match parent` that runs the kind-specific `WHERE technique_id = ?` etc. Keep it simple; position only needs to be monotonic per parent.

- [ ] **Step 2: Update `create_processing_video` to take `VideoParent`**

Change the signature and INSERT to write all four parent columns; only emit the technique-fanout activity when the parent is a technique:

```rust
#[instrument(skip(pool))]
pub async fn create_processing_video(
    pool: &Pool<Sqlite>,
    parent: VideoParent,
    title: &str,
    description: Option<&str>,
    uploaded_by_id: i64,
) -> Result<i64, AppError> {
    info!("Creating processing video");
    validate_parent(pool, parent).await?;
    let c = parent.columns();
    let position = next_video_position(pool, parent).await?;
    let kind = VideoKind::Native.as_str();
    let status = ProcessingStatus::Processing.as_str();
    let mut tx = pool.begin().await?;
    let res = sqlx::query!(
        "INSERT INTO videos (
            parent_kind, technique_id, student_id, thread_id,
            title, description, position, kind, processing_status, uploaded_by_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        c.kind, c.technique_id, c.student_id, c.thread_id,
        title, description, position, kind, status, uploaded_by_id,
    )
    .execute(&mut *tx)
    .await?;
    let video_id = res.last_insert_rowid();
    if let VideoParent::Technique(technique_id) = parent {
        let affected = affected_students_for_technique(&mut tx, technique_id).await?;
        emit_fanout(
            &mut tx,
            NewActivity::new(Verb::VideoAdded, uploaded_by_id)
                .video(video_id)
                .technique(technique_id),
            &affected,
        )
        .await?;
    }
    tx.commit().await?;
    Ok(video_id)
}
```

- [ ] **Step 3: Update `create_external_video` the same way**

Change `NewExternalVideo.technique_id: i64` to `parent: VideoParent`, write the four parent columns in the INSERT, and gate the fanout emit behind `if let VideoParent::Technique(technique_id) = input.parent`. Mirror Step 2's structure.

- [ ] **Step 4: Add the new columns to every `DbVideo` SELECT**

In `get_db_video`, `list_videos_for_technique`, `list_videos_for_technique_in_syllabus_visible_to`, `list_videos_for_technique_global_visible`, and the deprecated `list_videos_for_technique_visible_to`, add `parent_kind, student_id, thread_id` to the column list (alias with the `v.` prefix where the query uses the `v` alias). Example for `get_db_video`:

```rust
        "SELECT id, parent_kind, technique_id, student_id, thread_id, title, description,
                position, kind, processing_status, processing_error, storage_key, bytes,
                duration_seconds, width, height,
                external_url, external_host, external_video_id, uploaded_by_id,
                created_at, updated_at, hidden_at
         FROM videos
         WHERE id = ? AND deleted_at IS NULL",
```

- [ ] **Step 5: Add a parent-scoped read for non-technique parents**

```rust
/// Lists the globally-visible (not soft-deleted, not globally-hidden) videos
/// hanging off a given parent. Used by profile/thread/loose surfaces, which
/// per CX-019 apply only the global hide (no per-student override layers).
#[instrument(skip(pool))]
pub async fn list_videos_for_parent_global_visible(
    pool: &Pool<Sqlite>,
    parent: VideoParent,
) -> Result<Vec<Video>, AppError> {
    let c = parent.columns();
    let rows = sqlx::query_as!(
        DbVideo,
        "SELECT id, parent_kind, technique_id, student_id, thread_id, title, description,
                position, kind, processing_status, processing_error, storage_key, bytes,
                duration_seconds, width, height,
                external_url, external_host, external_video_id, uploaded_by_id,
                created_at, updated_at, hidden_at
         FROM videos
         WHERE deleted_at IS NULL AND hidden_at IS NULL
           AND parent_kind = ?
           AND (technique_id IS ? OR (technique_id IS NULL AND ? IS NULL))
           AND (student_id   IS ? OR (student_id   IS NULL AND ? IS NULL))
           AND (thread_id    IS ? OR (thread_id    IS NULL AND ? IS NULL))
         ORDER BY position ASC, id ASC",
        c.kind,
        c.technique_id, c.technique_id,
        c.student_id, c.student_id,
        c.thread_id, c.thread_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(Video::from).collect())
}
```

- [ ] **Step 6: Fix the upload route call site**

In `crates/syllabus-tracker/src/videos/routes.rs`, the technique upload handler (`POST /techniques/<tid>/videos/upload`) calls `create_processing_video(pool, tid, ...)`. Change to `create_processing_video(pool, db::videos::VideoParent::Technique(tid), ...)`. Do the same for any `create_external_video` / `next_video_position` call sites (grep them: `git grep -n 'create_processing_video\|create_external_video\|next_video_position\|technique_id:' crates/syllabus-tracker/src/videos`). The external-link handler builds `NewExternalVideo { technique_id: tid, .. }` → change to `parent: VideoParent::Technique(tid)`.

- [ ] **Step 7: Also fix `set_video_hidden_globally`'s technique read**

It does `SELECT technique_id ... WHERE id = ?` and fans out to `affected_students_for_technique`. Now `technique_id` can be NULL. Guard it: if the row's `technique_id` is NULL, skip the technique-fanout emit (a non-technique video has no syllabus students to fan out to). Wrap the existing fanout in `if let Some(technique_id) = technique_id_opt { ... }`.

- [ ] **Step 8: Regenerate the offline SQL cache**

Run: `nix develop .#ci --command just sqlx-prepare`
Expected: `.sqlx/` updated; no errors.

- [ ] **Step 9: Build**

Run: `nix develop .#ci --command cargo build -p syllabus-tracker`
Expected: PASS (models from Task 3 now satisfied by the SELECTs).

- [ ] **Step 10: Commit**

```bash
git add crates/syllabus-tracker/src/db/videos.rs crates/syllabus-tracker/src/videos/routes.rs .sqlx
git commit -m "feat(videos): route create/read through VideoParent"
```

---

## Task 5: Backend test — upload to each parent kind

**Files:**
- Modify: `crates/syllabus-tracker/src/test/videos.rs` (add tests in the existing `mod tests`)

- [ ] **Step 1: Write a failing test that creates a video for each parent and reads it back**

Add to `crates/syllabus-tracker/src/test/videos.rs`. This drives the DB layer directly (no HTTP, since profile/loose/thread upload routes are a later PR):

```rust
#[tokio::test]
async fn create_video_for_each_parent_kind_round_trips() {
    use crate::db::videos::{
        create_processing_video, get_db_video, list_videos_for_parent_global_visible, VideoParent,
    };
    let db = create_standard_test_db().await;
    let pool = db.pool();
    let tech = db.technique_id("Armbar").expect("seeded");
    let student = db.user_id("student").expect("seeded student");

    let tech_vid = create_processing_video(pool, VideoParent::Technique(tech), "t", None, student).await.unwrap();
    let prof_vid = create_processing_video(pool, VideoParent::StudentProfile(student), "p", None, student).await.unwrap();
    let loose_vid = create_processing_video(pool, VideoParent::Loose, "l", None, student).await.unwrap();

    assert_eq!(get_db_video(pool, tech_vid).await.unwrap().unwrap().parent_kind, "technique");
    assert_eq!(get_db_video(pool, prof_vid).await.unwrap().unwrap().parent_kind, "student_profile");
    assert_eq!(get_db_video(pool, loose_vid).await.unwrap().unwrap().parent_kind, "loose");

    let prof_list = list_videos_for_parent_global_visible(pool, VideoParent::StudentProfile(student)).await.unwrap();
    assert_eq!(prof_list.len(), 1);
    assert_eq!(prof_list[0].id, prof_vid);
    assert_eq!(prof_list[0].technique_id, None);
}
```

Confirm the helper names against `crates/syllabus-tracker/src/test/test_utils.rs` (`db.pool()`, `db.user_id(..)`, `db.technique_id(..)`). If a seeded student helper differs, adjust to the real accessor.

- [ ] **Step 2: Run it to verify it fails (or passes — it may already pass if Task 4 is complete)**

Run: `nix develop .#ci --command cargo test -p syllabus-tracker create_video_for_each_parent_kind -- --nocapture`
Expected: PASS if Task 4 landed correctly. If it fails on a helper name, fix the helper reference (not the production code).

- [ ] **Step 3: Add a test that the CHECK matrix rejects a malformed row**

```rust
#[tokio::test]
async fn validate_parent_rejects_missing_parent_row() {
    use crate::db::videos::{create_processing_video, VideoParent};
    let db = create_standard_test_db().await;
    let pool = db.pool();
    // technique id 999999 does not exist
    let err = create_processing_video(pool, VideoParent::Technique(999_999), "x", None, 1).await;
    assert!(err.is_err(), "creating a video for a non-existent technique must fail");
}
```

- [ ] **Step 4: Run both tests**

Run: `nix develop .#ci --command cargo test -p syllabus-tracker _parent -- --nocapture`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/syllabus-tracker/src/test/videos.rs
git commit -m "test(videos): round-trip videos across parent kinds"
```

---

## Task 6: CX-010 backend guard — no thread on a reply video

**Files:**
- Modify: `crates/syllabus-tracker/src/db/threads.rs` (`validate_anchor`)
- Test: `crates/syllabus-tracker/src/test/threads.rs`

- [ ] **Step 1: Write the failing test**

Add to `crates/syllabus-tracker/src/test/threads.rs`:

```rust
#[tokio::test]
async fn cannot_start_thread_on_a_thread_reply_video() {
    use crate::db::videos::{create_processing_video, VideoParent};
    use crate::db::threads::{create_thread, Anchor, AnchorKind, NewThread, ThreadVisibility};
    let db = create_standard_test_db().await;
    let pool = db.pool();
    let coach = db.user_id("coach").expect("seeded");
    let student = db.user_id("student").expect("seeded");

    // A root thread on the student's profile, then a video reply living under it.
    let root = create_thread(pool, NewThread {
        author_id: coach,
        anchor: Anchor { kind: AnchorKind::StudentProfile, id: student, video_ts_seconds: None, pinned_student_id: None },
        visibility: ThreadVisibility::Private,
        scope_student_id: Some(student),
        body: "root".into(),
    }).await.unwrap();
    let reply_video = create_processing_video(pool, VideoParent::Thread(root), "reply clip", None, coach).await.unwrap();

    // Attempting to anchor a NEW thread on that reply video must be rejected.
    let res = create_thread(pool, NewThread {
        author_id: coach,
        anchor: Anchor { kind: AnchorKind::Video, id: reply_video, video_ts_seconds: None, pinned_student_id: None },
        visibility: ThreadVisibility::Broadcast,
        scope_student_id: None,
        body: "should fail".into(),
    }).await;
    assert!(res.is_err(), "starting a thread on a thread-reply video must be rejected (CX-010)");
}
```

Confirm `create_thread`'s real name/signature in `threads.rs` and adjust (the file owns `NewThread`/`Anchor`/`AnchorKind`/`ThreadVisibility`). If the root thread on a profile requires `Private` + a scope student, the example already does that.

- [ ] **Step 2: Run it to verify it fails**

Run: `nix develop .#ci --command cargo test -p syllabus-tracker cannot_start_thread_on_a_thread_reply_video -- --nocapture`
Expected: FAIL — the thread is created instead of rejected.

- [ ] **Step 3: Add the guard in `validate_anchor`**

In `crates/syllabus-tracker/src/db/threads.rs`, inside `validate_anchor`, for the `Video` and `VideoTimestamp` arms, after confirming the video row exists, also reject when that video's `parent_kind = 'thread'`:

```rust
        AnchorKind::Video | AnchorKind::VideoTimestamp => {
            let row = sqlx::query!(
                "SELECT parent_kind FROM videos WHERE id = ? AND deleted_at IS NULL",
                anchor.id
            )
            .fetch_optional(pool)
            .await?;
            match row {
                None => false,
                // CX-010: a video that is itself a thread reply cannot anchor a new thread.
                Some(r) if r.parent_kind == "thread" => {
                    return Err(AppError::Validation(
                        "cannot start a thread on a video that is a thread reply".into(),
                    ));
                }
                Some(_) => true,
            }
        }
```

Match the existing arm's return-bool shape used elsewhere in `validate_anchor`; use whatever the file's existing validation-error variant is (grep `AppError::` usages in `threads.rs`). The key behavior: existence check AND the `parent_kind != 'thread'` rule.

- [ ] **Step 4: Run the test to verify it passes**

Run: `nix develop .#ci --command cargo test -p syllabus-tracker cannot_start_thread_on_a_thread_reply_video -- --nocapture`
Expected: PASS.

- [ ] **Step 5: Confirm normal video anchors still work**

Run: `nix develop .#ci --command cargo test -p syllabus-tracker -- threads`
Expected: PASS — existing thread-on-video tests (technique videos) are unaffected.

- [ ] **Step 6: Commit**

```bash
git add crates/syllabus-tracker/src/db/threads.rs crates/syllabus-tracker/src/test/threads.rs
git commit -m "feat(threads): reject thread anchored on a thread-reply video (CX-010)"
```

---

## Task 7: Frontend — type + hide the start-thread affordance on reply videos

**Files:**
- Modify: the frontend `Video` type (grep `git grep -nE "technique_id|parent_kind" frontend/src/**/*.ts | grep -i video` and the type that the videos API returns; likely `frontend/src/lib/api` or a `videos` types module)
- Modify: `frontend/src/components/videos/review/moment-feed.tsx` and/or `frontend/src/components/threads/thread-view.tsx`

- [ ] **Step 1: Add the field to the frontend `Video` type**

Locate the TS interface mapping the backend `Video` (it currently has `technique_id: number`). Change to:

```ts
  parent_kind: "technique" | "student_profile" | "thread" | "loose";
  technique_id: number | null;
  student_id: number | null;
  thread_id: number | null;
```

Fix any TS errors at read sites where `technique_id` was assumed non-null (grep the type's usages). Most call sites pass a technique's own id into the uploader and don't read `video.technique_id`, so the surface is small.

- [ ] **Step 2: Write a failing component test for the hidden affordance**

In the test file beside the component that renders the "start a thread at this moment" / comment button on a video (e.g. `frontend/src/components/videos/review/moment-feed.test.tsx`), add a case: given a video with `parent_kind: "thread"`, the start-thread control is NOT rendered. Follow the existing test's render harness (`renderWithProviders`, `buildUser`, stub `window.fetch` per memory `vitest-browser-fetch-stub`):

```tsx
it("hides the start-thread control on a thread-reply video", async () => {
  const video = buildVideo({ parent_kind: "thread", technique_id: null });
  renderWithProviders(<MomentFeed video={video} /* ...existing required props... */ />);
  expect(screen.queryByRole("button", { name: /start (a )?thread|comment at/i })).toBeNull();
});
```

Use the real component name, props, and a `buildVideo` factory (add one to the test fixtures if absent, defaulting `parent_kind: "technique"`).

- [ ] **Step 3: Run it to verify it fails**

Run: `nix develop .#ci --command just test-frontend`
Expected: FAIL — control still rendered.

- [ ] **Step 4: Gate the affordance in the component**

Where the component renders the start-thread / comment-at-timestamp control, wrap it so it does not render when `video.parent_kind === "thread"`:

```tsx
const isReplyVideo = video.parent_kind === "thread";
// ...
{!isReplyVideo && (
  <StartThreadButton /* existing props */ />
)}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `nix develop .#ci --command just test-frontend`
Expected: PASS, and no other frontend tests regress.

- [ ] **Step 6: Commit**

```bash
git add frontend/src
git commit -m "feat(videos): hide start-thread control on thread-reply videos (CX-010)"
```

---

## Task 8: Full verification + docs

**Files:**
- Modify: `config/schema.sql` is already the source of truth; no separate doc needed. Optionally add a one-line note to any video architecture doc if one exists.

- [ ] **Step 1: Run the full gate**

Run: `nix develop .#ci --command just verify`
Expected: PASS — lint, all backend + frontend tests, unused-deps.

- [ ] **Step 2: Confirm the offline cache is committed and the offline build is clean**

Run: `nix develop .#ci --command env SQLX_OFFLINE=true cargo build -p syllabus-tracker`
Expected: PASS with no DB connection (proves `.sqlx/` is regenerated and committed).

- [ ] **Step 3: Final review against the seed/dev flow**

Run: `nix develop .#ci --command just seed`
Expected: migrate + seed succeed against the polymorphic `videos` table; existing seeded videos are `parent_kind='technique'`.

- [ ] **Step 4: Push the branch and open a PR** (only if the user has asked to push; otherwise stop here)

```bash
git push -u origin <branch>
gh pr create --fill
```

---

## Self-Review notes (author check, already applied)

- **Spec coverage:** This slab covers the foundation under CX-016/017/018, CC-016/017/021, CX-012's unified video index, and CX-019's "library/thread/pinned read only `hidden_at`" rule (via `list_videos_for_parent_global_visible`). It encodes the CX-010 guard (Tasks 6 + 7). Camp/match parent kinds (CC-015/CC-021) are deliberately deferred until those tables exist — adding them later is one `parent_kind` value + one nullable FK + one CHECK branch each, no rebuild of this work.
- **Type consistency:** `VideoParent`/`ParentColumns`/`columns()`/`validate_parent` names are used identically in Tasks 2, 4, 5, 6. `DbVideo` gains `parent_kind: String`, `student_id`/`thread_id: Option<i64>`; `Video.technique_id` becomes `Option<i64>` consistently across models and the frontend type.
- **Declarative migration:** `parent_kind NOT NULL DEFAULT 'technique'` is the lynchpin that lets the table rebuild backfill existing rows into a CHECK-valid state.
