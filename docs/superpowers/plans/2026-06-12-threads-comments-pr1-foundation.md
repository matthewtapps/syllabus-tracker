# Threads & Comments — PR1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the `threads` + `thread_comments` tables, the two new permissions, and an anchor-agnostic thread/comment CRUD API (proven on the `student_profile` and `technique` anchor kinds) with correct visibility and soft-delete, so later PRs only wire surfaces, the remaining anchor kinds, and the activity feed.

**Architecture:** Two new tables with typed FK anchor columns plus an `anchor_kind` discriminator (per spec decision D2). A `db/threads.rs` module owns the SQL and the anchor/visibility rules; a `threads/` route module exposes CRUD; handlers mount in `main.rs`'s existing flat `routes![]` block (the per-module `routes()` convention is M8-future, not current). No activity-feed emission in this PR (that is PR5).

**Tech Stack:** Rust, Rocket, sqlx (compile-time-checked SQL against SQLite), a declarative migration engine that diffs `config/schema.sql` against the live DB. Frontend is untouched in this PR.

**Spec:** `docs/superpowers/specs/2026-06-12-threads-comments-design.md` (§4 data model, §6 permissions/visibility, D2/D4/D6).

**Conventions to follow (verified in the codebase):**
- Migrations are **declarative**: edit `config/schema.sql`; `migrate_database_declaratively` reconciles. There are no hand-written migration files.
- DB functions live in `crates/syllabus-tracker/src/db/<name>.rs`, take `&Pool<Sqlite>` (or a `&mut Transaction`), use `sqlx::query!`/`query_as!`, and return `Result<_, AppError>`. Re-export from `db/mod.rs`.
- Route handlers take a `User` request guard, call `user.require_permission(Permission::X)?`, wear `#[instrument(skip(...))]`, return `Result<Json<_>, Status>` (or `AppError`).
- Tests live in-crate under `src/test/<name>.rs`, registered in `src/test/mod.rs`, run with `#[rocket::async_test]`, and use `TestDbBuilder` / `setup_test_client` / `login_test_user`. DB functions are also unit-tested directly against `db.pool`.
- After any change to a `sqlx::query!` shape, regenerate the `.sqlx` cache against a seeded DB (see Task 8).

**Run the backend test suite with:** `cargo test -p syllabus-tracker` (from repo root). A single test: `cargo test -p syllabus-tracker <test_name> -- --nocapture`.

---

## File map

- Modify: `config/schema.sql` — add `threads`, `thread_comments` + indexes.
- Modify: `crates/syllabus-tracker/src/auth/permissions.rs` — add `ManageThreads`, `BroadcastLibraryComment`.
- Create: `crates/syllabus-tracker/src/db/threads.rs` — anchor/visibility types + CRUD SQL.
- Modify: `crates/syllabus-tracker/src/db/mod.rs` — `pub mod threads;` + re-exports.
- Create: `crates/syllabus-tracker/src/threads/mod.rs` — module root.
- Create: `crates/syllabus-tracker/src/threads/routes.rs` — handlers + request DTOs.
- Modify: `crates/syllabus-tracker/src/lib.rs` — `pub mod threads;`.
- Modify: `crates/syllabus-tracker/src/main.rs` — mount the new handlers in `routes![]`.
- Create: `crates/syllabus-tracker/src/test/threads.rs` — unit + integration tests.
- Modify: `crates/syllabus-tracker/src/test/mod.rs` — `pub mod threads;`.

---

## Task 1: Schema — add `threads` and `thread_comments`

**Files:**
- Modify: `config/schema.sql`

- [ ] **Step 1: Add the two tables to the schema**

Append to `config/schema.sql` (anywhere after the `student_syllabus_techniques` table, since `threads.sst_id` references it). This is the exact DDL from spec §4:

```sql
CREATE TABLE IF NOT EXISTS threads (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    anchor_kind     TEXT NOT NULL CHECK (anchor_kind IN (
                        'student_profile','technique','video',
                        'video_timestamp','sst','pinned_technique')),

    student_id      INTEGER REFERENCES users(id)                       ON DELETE CASCADE,
    technique_id    INTEGER REFERENCES techniques(id)                  ON DELETE CASCADE,
    video_id        INTEGER REFERENCES videos(id)                      ON DELETE CASCADE,
    video_ts_seconds INTEGER,
    sst_id          INTEGER REFERENCES student_syllabus_techniques(id) ON DELETE CASCADE,

    visibility      TEXT NOT NULL DEFAULT 'broadcast'
                        CHECK (visibility IN ('broadcast','private')),
    scope_student_id INTEGER REFERENCES users(id) ON DELETE CASCADE,

    last_activity_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at      TIMESTAMP,
    deleted_by_id   INTEGER REFERENCES users(id),

    CHECK (
      (anchor_kind='student_profile'  AND student_id IS NOT NULL AND technique_id IS NULL AND video_id IS NULL AND video_ts_seconds IS NULL AND sst_id IS NULL) OR
      (anchor_kind='technique'        AND technique_id IS NOT NULL AND student_id IS NULL AND video_id IS NULL AND video_ts_seconds IS NULL AND sst_id IS NULL) OR
      (anchor_kind='video'            AND video_id IS NOT NULL AND video_ts_seconds IS NULL AND student_id IS NULL AND technique_id IS NULL AND sst_id IS NULL) OR
      (anchor_kind='video_timestamp'  AND video_id IS NOT NULL AND video_ts_seconds IS NOT NULL AND student_id IS NULL AND technique_id IS NULL AND sst_id IS NULL) OR
      (anchor_kind='sst'              AND sst_id IS NOT NULL AND student_id IS NULL AND technique_id IS NULL AND video_id IS NULL AND video_ts_seconds IS NULL) OR
      (anchor_kind='pinned_technique' AND student_id IS NOT NULL AND technique_id IS NOT NULL AND video_id IS NULL AND video_ts_seconds IS NULL AND sst_id IS NULL)
    ),
    CHECK (
      (visibility='private'   AND scope_student_id IS NOT NULL) OR
      (visibility='broadcast' AND scope_student_id IS NULL)
    ),
    CHECK (
      visibility='private'
      OR anchor_kind IN ('technique','video','video_timestamp')
    )
);

CREATE INDEX IF NOT EXISTS idx_threads_student   ON threads(student_id)   WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_threads_technique ON threads(technique_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_threads_video     ON threads(video_id)     WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_threads_sst       ON threads(sst_id)       WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_threads_scope     ON threads(scope_student_id) WHERE scope_student_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS thread_comments (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id         INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    parent_comment_id INTEGER REFERENCES thread_comments(id) ON DELETE CASCADE,
    author_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body              TEXT NOT NULL,
    created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    edited_at         TIMESTAMP,
    deleted_at        TIMESTAMP,
    deleted_by_id     INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_thread_comments_thread ON thread_comments(thread_id, created_at);
```

- [ ] **Step 2: Write a test that the migrator creates the tables**

Create `crates/syllabus-tracker/src/test/threads.rs` with this first test (the module is registered in Task 7; for now add the file and a temporary `pub mod threads;` line to `src/test/mod.rs` so it compiles):

```rust
#[cfg(test)]
mod tests {
    use crate::test::test_utils::{create_standard_test_db};

    #[rocket::async_test]
    async fn migrator_creates_thread_tables() {
        let db = create_standard_test_db().await;
        let names: Vec<String> = sqlx::query_scalar!(
            r#"SELECT name AS "name!: String" FROM sqlite_master
               WHERE type='table' AND name IN ('threads','thread_comments')
               ORDER BY name"#
        )
        .fetch_all(&db.pool)
        .await
        .unwrap();
        assert_eq!(names, vec!["thread_comments", "threads"]);
    }
}
```

Add to `crates/syllabus-tracker/src/test/mod.rs`:

```rust
pub mod threads;
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `cargo test -p syllabus-tracker migrator_creates_thread_tables -- --nocapture`
Expected: PASS. (The declarative migrator reads `config/schema.sql` via `SCHEMA_PATH` and creates the new tables in the in-memory DB.)

- [ ] **Step 4: Commit**

```bash
git add config/schema.sql crates/syllabus-tracker/src/test/threads.rs crates/syllabus-tracker/src/test/mod.rs
git commit -m "feat(threads): Add threads and thread_comments schema"
```

---

## Task 2: Permissions — `ManageThreads` and `BroadcastLibraryComment`

**Files:**
- Modify: `crates/syllabus-tracker/src/auth/permissions.rs`

- [ ] **Step 1: Write the failing test**

Add to the bottom of `crates/syllabus-tracker/src/auth/permissions.rs`:

```rust
#[cfg(test)]
mod thread_permission_tests {
    use super::{Permission, Role};

    #[test]
    fn coach_and_admin_have_thread_permissions_student_does_not() {
        assert!(Role::Coach.has_permission(Permission::ManageThreads));
        assert!(Role::Coach.has_permission(Permission::BroadcastLibraryComment));
        assert!(Role::Admin.has_permission(Permission::ManageThreads));
        assert!(Role::Admin.has_permission(Permission::BroadcastLibraryComment));
        assert!(!Role::Student.has_permission(Permission::ManageThreads));
        assert!(!Role::Student.has_permission(Permission::BroadcastLibraryComment));
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p syllabus-tracker coach_and_admin_have_thread_permissions -- --nocapture`
Expected: FAIL to compile — `no variant named ManageThreads`.

- [ ] **Step 3: Add the variants and grant them to coaches**

In the `Permission` enum (after `ManageVideoVisibility`), add:

```rust
    ManageThreads,
    BroadcastLibraryComment,
```

In `COACH_PERMISSIONS` (after `permissions.insert(Permission::ManageVideoVisibility);`), add:

```rust
    permissions.insert(Permission::ManageThreads);
    permissions.insert(Permission::BroadcastLibraryComment);
```

(Admin inherits from coach via `permissions.extend(COACH_PERMISSIONS...)`, so no admin edit is needed.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cargo test -p syllabus-tracker coach_and_admin_have_thread_permissions -- --nocapture`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/syllabus-tracker/src/auth/permissions.rs
git commit -m "feat(threads): Add ManageThreads and BroadcastLibraryComment permissions"
```

---

## Task 3: Anchor + visibility types and validation

**Files:**
- Create: `crates/syllabus-tracker/src/db/threads.rs`
- Modify: `crates/syllabus-tracker/src/db/mod.rs`

This task adds the domain types and the pure validation logic, no SQL yet.

- [ ] **Step 1: Create the module with types and a failing unit test**

Create `crates/syllabus-tracker/src/db/threads.rs`:

```rust
//! Threads and comments: anchor-agnostic conversation primitive. Owns the
//! anchor/visibility vocabulary, the (kind, visibility) allow-matrix, and the
//! CRUD SQL. No activity-feed emission here yet (PR5 wires that).

use chrono::NaiveDateTime;
use serde::Serialize;
use sqlx::{Pool, Sqlite};

use crate::error::AppError;

/// The kinds of thing a thread can anchor to. Mirrors the `anchor_kind` CHECK
/// in `config/schema.sql` and (later) the shared frontend EntityRef union.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnchorKind {
    StudentProfile,
    Technique,
    Video,
    VideoTimestamp,
    Sst,
    PinnedTechnique,
}

impl AnchorKind {
    pub fn as_str(self) -> &'static str {
        match self {
            AnchorKind::StudentProfile => "student_profile",
            AnchorKind::Technique => "technique",
            AnchorKind::Video => "video",
            AnchorKind::VideoTimestamp => "video_timestamp",
            AnchorKind::Sst => "sst",
            AnchorKind::PinnedTechnique => "pinned_technique",
        }
    }

    pub fn from_str_kind(s: &str) -> Option<AnchorKind> {
        match s {
            "student_profile" => Some(AnchorKind::StudentProfile),
            "technique" => Some(AnchorKind::Technique),
            "video" => Some(AnchorKind::Video),
            "video_timestamp" => Some(AnchorKind::VideoTimestamp),
            "sst" => Some(AnchorKind::Sst),
            "pinned_technique" => Some(AnchorKind::PinnedTechnique),
            _ => None,
        }
    }

    /// Whether a `broadcast` thread is legal on this anchor (global/library
    /// anchors only). Mirrors the third CHECK in the schema and spec D4.
    pub fn allows_broadcast(self) -> bool {
        matches!(
            self,
            AnchorKind::Technique | AnchorKind::Video | AnchorKind::VideoTimestamp
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ThreadVisibility {
    Broadcast,
    Private,
}

impl ThreadVisibility {
    pub fn as_str(self) -> &'static str {
        match self {
            ThreadVisibility::Broadcast => "broadcast",
            ThreadVisibility::Private => "private",
        }
    }
}

/// A fully-specified anchor: the kind plus the single id that kind addresses
/// (and a seconds offset for `video_timestamp`).
#[derive(Debug, Clone, Copy)]
pub struct Anchor {
    pub kind: AnchorKind,
    /// The id of the anchored entity (student id / technique id / video id /
    /// sst id). For `pinned_technique` this is the technique id; the student is
    /// carried separately in `pinned_student_id`.
    pub id: i64,
    pub video_ts_seconds: Option<i64>,
    /// Only set for `pinned_technique` (its anchor is the (student, technique)
    /// pair, so both ids are needed).
    pub pinned_student_id: Option<i64>,
}

#[cfg(test)]
mod type_tests {
    use super::{AnchorKind, ThreadVisibility};

    #[test]
    fn anchor_kind_str_roundtrips() {
        for kind in [
            AnchorKind::StudentProfile,
            AnchorKind::Technique,
            AnchorKind::Video,
            AnchorKind::VideoTimestamp,
            AnchorKind::Sst,
            AnchorKind::PinnedTechnique,
        ] {
            assert_eq!(AnchorKind::from_str_kind(kind.as_str()), Some(kind));
        }
        assert_eq!(AnchorKind::from_str_kind("nope"), None);
    }

    #[test]
    fn only_global_anchors_allow_broadcast() {
        assert!(AnchorKind::Technique.allows_broadcast());
        assert!(AnchorKind::Video.allows_broadcast());
        assert!(AnchorKind::VideoTimestamp.allows_broadcast());
        assert!(!AnchorKind::StudentProfile.allows_broadcast());
        assert!(!AnchorKind::Sst.allows_broadcast());
        assert!(!AnchorKind::PinnedTechnique.allows_broadcast());
    }

    #[test]
    fn visibility_str() {
        assert_eq!(ThreadVisibility::Broadcast.as_str(), "broadcast");
        assert_eq!(ThreadVisibility::Private.as_str(), "private");
    }
}
```

Add to `crates/syllabus-tracker/src/db/mod.rs` (with the other `pub mod` lines):

```rust
pub mod threads;
```

- [ ] **Step 2: Run the unit tests to verify they pass**

Run: `cargo test -p syllabus-tracker -- threads::type_tests --nocapture`
Expected: PASS (3 tests).

- [ ] **Step 3: Commit**

```bash
git add crates/syllabus-tracker/src/db/threads.rs crates/syllabus-tracker/src/db/mod.rs
git commit -m "feat(threads): Add anchor and visibility domain types"
```

---

## Task 4: `create_thread` (with anchor + allow-matrix validation)

**Files:**
- Modify: `crates/syllabus-tracker/src/db/threads.rs`
- Modify: `crates/syllabus-tracker/src/test/threads.rs`

PR1 implements creation for `StudentProfile` and `Technique` anchors. The other
kinds return a clear "not yet supported" error (later PRs enable them); this is a
tested behaviour, not a placeholder.

- [ ] **Step 1: Write the failing integration test**

Add to the `tests` module in `crates/syllabus-tracker/src/test/threads.rs`:

```rust
use crate::db::threads::{
    create_thread, Anchor, AnchorKind, NewThread, ThreadVisibility,
};
use crate::test::test_utils::create_standard_test_db;

#[rocket::async_test]
async fn create_private_profile_thread_persists_row() {
    let db = create_standard_test_db().await;
    let coach_id = db.user_id("coach_user").unwrap();
    let student_id = db.user_id("student_user").unwrap();

    let id = create_thread(
        &db.pool,
        NewThread {
            author_id: coach_id,
            anchor: Anchor {
                kind: AnchorKind::StudentProfile,
                id: student_id,
                video_ts_seconds: None,
                pinned_student_id: None,
            },
            visibility: ThreadVisibility::Private,
            scope_student_id: Some(student_id),
            body: "Let's plan your next six weeks.".to_string(),
        },
    )
    .await
    .unwrap();

    let row = sqlx::query!(
        r#"SELECT anchor_kind, student_id AS "student_id?: i64",
                  visibility, scope_student_id AS "scope?: i64", body
           FROM threads WHERE id = ?"#,
        id
    )
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(row.anchor_kind, "student_profile");
    assert_eq!(row.student_id, Some(student_id));
    assert_eq!(row.visibility, "private");
    assert_eq!(row.scope, Some(student_id));
}

#[rocket::async_test]
async fn broadcast_on_profile_anchor_is_rejected() {
    let db = create_standard_test_db().await;
    let coach_id = db.user_id("coach_user").unwrap();
    let student_id = db.user_id("student_user").unwrap();

    let result = create_thread(
        &db.pool,
        NewThread {
            author_id: coach_id,
            anchor: Anchor {
                kind: AnchorKind::StudentProfile,
                id: student_id,
                video_ts_seconds: None,
                pinned_student_id: None,
            },
            visibility: ThreadVisibility::Broadcast,
            scope_student_id: None,
            body: "nope".to_string(),
        },
    )
    .await;
    assert!(result.is_err(), "broadcast on a profile anchor must be rejected");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p syllabus-tracker create_private_profile_thread_persists_row -- --nocapture`
Expected: FAIL to compile — `NewThread`, `create_thread` not found.

- [ ] **Step 3: Implement `NewThread` and `create_thread`**

Add to `crates/syllabus-tracker/src/db/threads.rs`:

```rust
use tracing::{info, instrument};

/// Input for creating a thread (the root post).
pub struct NewThread {
    pub author_id: i64,
    pub anchor: Anchor,
    pub visibility: ThreadVisibility,
    /// Required iff `visibility == Private`.
    pub scope_student_id: Option<i64>,
    pub body: String,
}

/// Resolve an `Anchor` into the five typed columns the `threads` table stores.
/// Returns (student_id, technique_id, video_id, video_ts_seconds, sst_id).
fn anchor_columns(
    anchor: &Anchor,
) -> (Option<i64>, Option<i64>, Option<i64>, Option<i64>, Option<i64>) {
    match anchor.kind {
        AnchorKind::StudentProfile => (Some(anchor.id), None, None, None, None),
        AnchorKind::Technique => (None, Some(anchor.id), None, None, None),
        AnchorKind::Video => (None, None, Some(anchor.id), None, None),
        AnchorKind::VideoTimestamp => {
            (None, None, Some(anchor.id), anchor.video_ts_seconds, None)
        }
        AnchorKind::Sst => (None, None, None, None, Some(anchor.id)),
        AnchorKind::PinnedTechnique => {
            (anchor.pinned_student_id, Some(anchor.id), None, None, None)
        }
    }
}

/// Confirm the anchored parent row exists. PR1 supports profile + technique;
/// the remaining kinds are enabled in their surface PRs.
#[instrument(skip(pool))]
async fn validate_anchor(pool: &Pool<Sqlite>, anchor: &Anchor) -> Result<(), AppError> {
    let exists = match anchor.kind {
        AnchorKind::StudentProfile => sqlx::query_scalar!(
            r#"SELECT EXISTS(SELECT 1 FROM users WHERE id = ?) AS "e!: i64""#,
            anchor.id
        )
        .fetch_one(pool)
        .await?,
        AnchorKind::Technique => sqlx::query_scalar!(
            r#"SELECT EXISTS(SELECT 1 FROM techniques WHERE id = ?) AS "e!: i64""#,
            anchor.id
        )
        .fetch_one(pool)
        .await?,
        _ => {
            return Err(AppError::BadRequest(format!(
                "anchor kind {} is not supported yet",
                anchor.kind.as_str()
            )));
        }
    };
    if exists == 0 {
        return Err(AppError::BadRequest(format!(
            "anchor {} #{} does not exist",
            anchor.kind.as_str(),
            anchor.id
        )));
    }
    Ok(())
}

#[instrument(skip(pool, new))]
pub async fn create_thread(pool: &Pool<Sqlite>, new: NewThread) -> Result<i64, AppError> {
    // Allow-matrix: broadcast only on global anchors; private must name a scope.
    if new.visibility == ThreadVisibility::Broadcast && !new.anchor.kind.allows_broadcast() {
        return Err(AppError::BadRequest(
            "broadcast is only allowed on technique/video anchors".to_string(),
        ));
    }
    if new.visibility == ThreadVisibility::Private && new.scope_student_id.is_none() {
        return Err(AppError::BadRequest(
            "a private thread must name a scope student".to_string(),
        ));
    }
    if new.visibility == ThreadVisibility::Broadcast && new.scope_student_id.is_some() {
        return Err(AppError::BadRequest(
            "a broadcast thread must not name a scope student".to_string(),
        ));
    }
    validate_anchor(pool, &new.anchor).await?;

    let (student_id, technique_id, video_id, video_ts, sst_id) = anchor_columns(&new.anchor);
    let kind = new.anchor.kind.as_str();
    let visibility = new.visibility.as_str();

    info!(anchor_kind = kind, "creating thread");
    let id = sqlx::query_scalar!(
        r#"INSERT INTO threads
              (created_by_id, anchor_kind, student_id, technique_id, video_id,
               video_ts_seconds, sst_id, visibility, scope_student_id, body)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           RETURNING id AS "id!: i64""#,
        new.author_id,
        kind,
        student_id,
        technique_id,
        video_id,
        video_ts,
        sst_id,
        visibility,
        new.scope_student_id,
        new.body,
    )
    .fetch_one(pool)
    .await?;
    Ok(id)
}
```

If `AppError` has no `BadRequest` variant, check `crates/syllabus-tracker/src/error.rs` for the existing client-error variant (e.g. `Validation`/`Invalid`) and use that name consistently across this file. Confirm before proceeding:

Run: `grep -n "enum AppError" -A 30 crates/syllabus-tracker/src/error.rs`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p syllabus-tracker -- threads:: --nocapture`
Expected: PASS, including `create_private_profile_thread_persists_row` and `broadcast_on_profile_anchor_is_rejected`.

- [ ] **Step 5: Commit**

```bash
git add crates/syllabus-tracker/src/db/threads.rs crates/syllabus-tracker/src/test/threads.rs
git commit -m "feat(threads): Implement create_thread with anchor validation"
```

---

## Task 5: `create_comment`, `list_threads_for_anchor`, `get_thread`, soft-delete

**Files:**
- Modify: `crates/syllabus-tracker/src/db/threads.rs`
- Modify: `crates/syllabus-tracker/src/test/threads.rs`

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module in `src/test/threads.rs`:

```rust
use crate::db::threads::{
    create_comment, get_thread, list_threads_for_anchor, soft_delete_comment, Viewer,
};

#[rocket::async_test]
async fn comments_and_visibility_round_trip() {
    let db = create_standard_test_db().await;
    let coach_id = db.user_id("coach_user").unwrap();
    let student_id = db.user_id("student_user").unwrap();
    let other_student_id = db.user_id("student2").unwrap();

    let thread_id = create_thread(
        &db.pool,
        NewThread {
            author_id: student_id,
            anchor: Anchor {
                kind: AnchorKind::StudentProfile,
                id: student_id,
                video_ts_seconds: None,
                pinned_student_id: None,
            },
            visibility: ThreadVisibility::Private,
            scope_student_id: Some(student_id),
            body: "question".to_string(),
        },
    )
    .await
    .unwrap();

    create_comment(&db.pool, thread_id, None, coach_id, "answer")
        .await
        .unwrap();

    // Owner sees it.
    let owner_view = get_thread(&db.pool, thread_id, Viewer { user_id: student_id, is_coach: false })
        .await
        .unwrap();
    assert!(owner_view.is_some());
    assert_eq!(owner_view.unwrap().comments.len(), 1);

    // A coach sees it.
    let coach_view = get_thread(&db.pool, thread_id, Viewer { user_id: coach_id, is_coach: true })
        .await
        .unwrap();
    assert!(coach_view.is_some());

    // A different student does NOT.
    let stranger = get_thread(&db.pool, thread_id, Viewer { user_id: other_student_id, is_coach: false })
        .await
        .unwrap();
    assert!(stranger.is_none(), "private thread leaks to another student");
}

#[rocket::async_test]
async fn soft_delete_tombstones_body_keeps_row() {
    let db = create_standard_test_db().await;
    let coach_id = db.user_id("coach_user").unwrap();
    let student_id = db.user_id("student_user").unwrap();

    let thread_id = create_thread(
        &db.pool,
        NewThread {
            author_id: student_id,
            anchor: Anchor { kind: AnchorKind::StudentProfile, id: student_id, video_ts_seconds: None, pinned_student_id: None },
            visibility: ThreadVisibility::Private,
            scope_student_id: Some(student_id),
            body: "q".to_string(),
        },
    ).await.unwrap();
    let comment_id = create_comment(&db.pool, thread_id, None, student_id, "oops").await.unwrap();

    soft_delete_comment(&db.pool, comment_id, coach_id).await.unwrap();

    let view = get_thread(&db.pool, thread_id, Viewer { user_id: coach_id, is_coach: true })
        .await.unwrap().unwrap();
    let c = view.comments.iter().find(|c| c.id == comment_id).unwrap();
    assert!(c.deleted_at.is_some());
    assert!(c.body.is_none(), "deleted comment body must be tombstoned (None)");
}
```

`student2` must exist in the standard test db. Confirm with:
Run: `grep -n "student2\|fn create_standard_test_db" crates/syllabus-tracker/src/test/utils.rs`
If `student2` is not in `create_standard_test_db`, build a local db in these two tests with `TestDbBuilder::new().coach("coach_user", None).student("student_user", None).student("student2", None)` then `setup_test_client`, instead of `create_standard_test_db`.

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p syllabus-tracker comments_and_visibility_round_trip -- --nocapture`
Expected: FAIL to compile — `create_comment`, `get_thread`, `Viewer`, etc. not found.

- [ ] **Step 3: Implement the read/write functions**

Add to `crates/syllabus-tracker/src/db/threads.rs`:

```rust
/// Who is asking. `is_coach` is true for Coach or Admin (gym-global role).
#[derive(Debug, Clone, Copy)]
pub struct Viewer {
    pub user_id: i64,
    pub is_coach: bool,
}

#[derive(Debug, Serialize)]
pub struct CommentView {
    pub id: i64,
    pub thread_id: i64,
    pub parent_comment_id: Option<i64>,
    pub author_id: i64,
    /// `None` when the comment is soft-deleted (tombstoned in the read layer).
    pub body: Option<String>,
    pub created_at: NaiveDateTime,
    pub deleted_at: Option<NaiveDateTime>,
}

#[derive(Debug, Serialize)]
pub struct ThreadView {
    pub id: i64,
    pub anchor_kind: String,
    pub author_id: i64,
    pub visibility: String,
    pub scope_student_id: Option<i64>,
    pub body: Option<String>,
    pub created_at: NaiveDateTime,
    pub deleted_at: Option<NaiveDateTime>,
    pub comments: Vec<CommentView>,
}

/// Insert a comment. `parent_comment_id` enforces one level of nesting: a reply
/// to a reply is rejected (CX-010 / spec D3). Bumps the thread's last_activity_at.
#[instrument(skip(pool, body))]
pub async fn create_comment(
    pool: &Pool<Sqlite>,
    thread_id: i64,
    parent_comment_id: Option<i64>,
    author_id: i64,
    body: &str,
) -> Result<i64, AppError> {
    if let Some(parent_id) = parent_comment_id {
        let parent_is_reply = sqlx::query_scalar!(
            r#"SELECT (parent_comment_id IS NOT NULL) AS "is_reply!: i64"
               FROM thread_comments WHERE id = ? AND thread_id = ?"#,
            parent_id,
            thread_id,
        )
        .fetch_optional(pool)
        .await?;
        match parent_is_reply {
            None => return Err(AppError::BadRequest("parent comment not found".into())),
            Some(1) => {
                return Err(AppError::BadRequest(
                    "cannot reply to a reply (one level of nesting)".into(),
                ));
            }
            _ => {}
        }
    }

    let id = sqlx::query_scalar!(
        r#"INSERT INTO thread_comments (thread_id, parent_comment_id, author_id, body)
           VALUES (?, ?, ?, ?)
           RETURNING id AS "id!: i64""#,
        thread_id,
        parent_comment_id,
        author_id,
        body,
    )
    .fetch_one(pool)
    .await?;

    sqlx::query!(
        "UPDATE threads SET last_activity_at = CURRENT_TIMESTAMP WHERE id = ?",
        thread_id
    )
    .execute(pool)
    .await?;
    Ok(id)
}

/// Visibility predicate (spec §6 read rule): a coach sees everything; a student
/// sees broadcast threads or threads scoped to them.
fn viewer_can_see(viewer: &Viewer, visibility: &str, scope_student_id: Option<i64>) -> bool {
    viewer.is_coach
        || visibility == "broadcast"
        || scope_student_id == Some(viewer.user_id)
}

#[instrument(skip(pool))]
pub async fn get_thread(
    pool: &Pool<Sqlite>,
    thread_id: i64,
    viewer: Viewer,
) -> Result<Option<ThreadView>, AppError> {
    let row = sqlx::query!(
        r#"SELECT id AS "id!: i64", anchor_kind, created_by_id AS "author_id!: i64",
                  visibility, scope_student_id AS "scope?: i64", body,
                  created_at AS "created_at!: NaiveDateTime",
                  deleted_at AS "deleted_at?: NaiveDateTime"
           FROM threads WHERE id = ?"#,
        thread_id
    )
    .fetch_optional(pool)
    .await?;

    let Some(row) = row else { return Ok(None) };
    if !viewer_can_see(&viewer, &row.visibility, row.scope) {
        return Ok(None);
    }

    let comment_rows = sqlx::query!(
        r#"SELECT id AS "id!: i64", thread_id AS "thread_id!: i64",
                  parent_comment_id AS "parent_comment_id?: i64",
                  author_id AS "author_id!: i64", body,
                  created_at AS "created_at!: NaiveDateTime",
                  deleted_at AS "deleted_at?: NaiveDateTime"
           FROM thread_comments WHERE thread_id = ? ORDER BY created_at, id"#,
        thread_id
    )
    .fetch_all(pool)
    .await?;

    let comments = comment_rows
        .into_iter()
        .map(|c| CommentView {
            id: c.id,
            thread_id: c.thread_id,
            parent_comment_id: c.parent_comment_id,
            author_id: c.author_id,
            body: if c.deleted_at.is_some() { None } else { Some(c.body) },
            created_at: c.created_at,
            deleted_at: c.deleted_at,
        })
        .collect();

    Ok(Some(ThreadView {
        id: row.id,
        anchor_kind: row.anchor_kind,
        author_id: row.author_id,
        visibility: row.visibility,
        scope_student_id: row.scope,
        body: if row.deleted_at.is_some() { None } else { Some(row.body) },
        created_at: row.created_at,
        deleted_at: row.deleted_at,
        comments,
    }))
}

/// List the live (non-deleted) threads on an anchor that the viewer may see.
/// PR1 supports the `student_profile` and `technique` anchors.
#[instrument(skip(pool))]
pub async fn list_threads_for_anchor(
    pool: &Pool<Sqlite>,
    anchor: Anchor,
    viewer: Viewer,
) -> Result<Vec<ThreadView>, AppError> {
    let (student_id, technique_id, _v, _ts, _sst) = anchor_columns(&anchor);
    let ids: Vec<i64> = match anchor.kind {
        AnchorKind::StudentProfile => sqlx::query_scalar!(
            r#"SELECT id AS "id!: i64" FROM threads
               WHERE anchor_kind = 'student_profile' AND student_id = ? AND deleted_at IS NULL
               ORDER BY last_activity_at DESC"#,
            student_id
        )
        .fetch_all(pool)
        .await?,
        AnchorKind::Technique => sqlx::query_scalar!(
            r#"SELECT id AS "id!: i64" FROM threads
               WHERE anchor_kind = 'technique' AND technique_id = ? AND deleted_at IS NULL
               ORDER BY last_activity_at DESC"#,
            technique_id
        )
        .fetch_all(pool)
        .await?,
        _ => {
            return Err(AppError::BadRequest(format!(
                "anchor kind {} is not supported yet",
                anchor.kind.as_str()
            )));
        }
    };

    let mut out = Vec::new();
    for id in ids {
        if let Some(view) = get_thread(pool, id, viewer).await? {
            out.push(view);
        }
    }
    Ok(out)
}

#[instrument(skip(pool))]
pub async fn soft_delete_comment(
    pool: &Pool<Sqlite>,
    comment_id: i64,
    actor_id: i64,
) -> Result<(), AppError> {
    sqlx::query!(
        "UPDATE thread_comments SET deleted_at = CURRENT_TIMESTAMP, deleted_by_id = ?
         WHERE id = ? AND deleted_at IS NULL",
        actor_id,
        comment_id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[instrument(skip(pool))]
pub async fn soft_delete_thread(
    pool: &Pool<Sqlite>,
    thread_id: i64,
    actor_id: i64,
) -> Result<(), AppError> {
    sqlx::query!(
        "UPDATE threads SET deleted_at = CURRENT_TIMESTAMP, deleted_by_id = ?
         WHERE id = ? AND deleted_at IS NULL",
        actor_id,
        thread_id,
    )
    .execute(pool)
    .await?;
    Ok(())
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p syllabus-tracker -- threads:: --nocapture`
Expected: PASS (all thread tests, including visibility and tombstone).

- [ ] **Step 5: Commit**

```bash
git add crates/syllabus-tracker/src/db/threads.rs crates/syllabus-tracker/src/test/threads.rs
git commit -m "feat(threads): Add comment create, thread read with visibility, soft-delete"
```

---

## Task 6: Re-export the db functions

**Files:**
- Modify: `crates/syllabus-tracker/src/db/mod.rs`

- [ ] **Step 1: Re-export the public API**

In `crates/syllabus-tracker/src/db/mod.rs`, alongside the existing `pub use` lines, add:

```rust
pub use threads::{
    create_comment, create_thread, get_thread, list_threads_for_anchor, soft_delete_comment,
    soft_delete_thread, Anchor, AnchorKind, NewThread, ThreadVisibility, ThreadView, Viewer,
};
```

- [ ] **Step 2: Verify it compiles**

Run: `cargo build -p syllabus-tracker`
Expected: builds with no errors.

- [ ] **Step 3: Commit**

```bash
git add crates/syllabus-tracker/src/db/mod.rs
git commit -m "feat(threads): Re-export thread db functions from db module"
```

---

## Task 7: Route module + mount + endpoint tests

**Files:**
- Create: `crates/syllabus-tracker/src/threads/mod.rs`
- Create: `crates/syllabus-tracker/src/threads/routes.rs`
- Modify: `crates/syllabus-tracker/src/lib.rs`
- Modify: `crates/syllabus-tracker/src/main.rs`
- Modify: `crates/syllabus-tracker/src/test/threads.rs`

- [ ] **Step 1: Create the route module**

Create `crates/syllabus-tracker/src/threads/mod.rs`:

```rust
pub mod routes;
pub use routes::*;
```

Create `crates/syllabus-tracker/src/threads/routes.rs`:

```rust
use rocket::State;
use rocket::http::Status;
use rocket::serde::{Deserialize, Serialize, json::Json};
use sqlx::{Pool, Sqlite};
use tracing::instrument;

use crate::auth::{Permission, User};
use crate::db::threads::{
    create_comment, create_thread, get_thread, list_threads_for_anchor, soft_delete_comment,
    soft_delete_thread, Anchor, AnchorKind, NewThread, ThreadVisibility, ThreadView, Viewer,
};

fn viewer_for(user: &User) -> Viewer {
    Viewer {
        user_id: user.id,
        is_coach: user.has_permission(Permission::ViewAllStudents),
    }
}

#[derive(Deserialize)]
pub struct CreateThreadRequest {
    pub anchor_kind: String,
    pub anchor_id: i64,
    pub video_ts_seconds: Option<i64>,
    /// Only for the `pinned_technique` anchor; the student half of the pair.
    pub pinned_student_id: Option<i64>,
    pub visibility: String, // "private" | "broadcast"
    pub scope_student_id: Option<i64>,
    pub body: String,
}

#[derive(Serialize)]
pub struct CreatedResponse {
    pub id: i64,
}

#[derive(Serialize)]
pub struct ThreadListResponse {
    pub threads: Vec<ThreadView>,
}

#[derive(Deserialize)]
pub struct CreateCommentRequest {
    pub parent_comment_id: Option<i64>,
    pub body: String,
}

fn parse_kind(s: &str) -> Result<AnchorKind, Status> {
    AnchorKind::from_str_kind(s).ok_or(Status::BadRequest)
}

fn parse_visibility(s: &str) -> Result<ThreadVisibility, Status> {
    match s {
        "private" => Ok(ThreadVisibility::Private),
        "broadcast" => Ok(ThreadVisibility::Broadcast),
        _ => Err(Status::BadRequest),
    }
}

#[instrument(skip(req, pool, user))]
#[post("/threads", data = "<req>")]
pub async fn api_create_thread(
    user: User,
    req: Json<CreateThreadRequest>,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<CreatedResponse>, Status> {
    let kind = parse_kind(&req.anchor_kind)?;
    let visibility = parse_visibility(&req.visibility)?;

    // Broadcast requires the BroadcastLibraryComment permission (spec §6).
    if visibility == ThreadVisibility::Broadcast {
        user.require_permission(Permission::BroadcastLibraryComment)
            .map_err(|_| Status::Forbidden)?;
    }

    // Students may only post in contexts they own. A student creating a
    // profile thread may only do so on their own profile; a private thread
    // they author is scoped to themselves. Coaches are unrestricted.
    let is_coach = user.has_permission(Permission::ViewAllStudents);
    if !is_coach {
        let own_profile = kind == AnchorKind::StudentProfile && req.anchor_id == user.id;
        let own_scope = visibility == ThreadVisibility::Private
            && req.scope_student_id == Some(user.id);
        let global_anchor = kind.allows_broadcast(); // technique/video are browseable
        if !(own_profile || (global_anchor && own_scope)) {
            return Err(Status::Forbidden);
        }
    }

    let id = create_thread(
        pool,
        NewThread {
            author_id: user.id,
            anchor: Anchor {
                kind,
                id: req.anchor_id,
                video_ts_seconds: req.video_ts_seconds,
                pinned_student_id: req.pinned_student_id,
            },
            visibility,
            scope_student_id: req.scope_student_id,
            body: req.body.clone(),
        },
    )
    .await
    .map_err(|_| Status::BadRequest)?;
    Ok(Json(CreatedResponse { id }))
}

#[instrument(skip(pool, user))]
#[get("/threads?<anchor_kind>&<anchor_id>")]
pub async fn api_list_threads(
    user: User,
    anchor_kind: String,
    anchor_id: i64,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<ThreadListResponse>, Status> {
    let kind = parse_kind(&anchor_kind)?;
    let threads = list_threads_for_anchor(
        pool,
        Anchor { kind, id: anchor_id, video_ts_seconds: None, pinned_student_id: None },
        viewer_for(&user),
    )
    .await
    .map_err(|_| Status::BadRequest)?;
    Ok(Json(ThreadListResponse { threads }))
}

#[instrument(skip(req, pool, user))]
#[post("/threads/<id>/comments", data = "<req>")]
pub async fn api_create_comment(
    id: i64,
    user: User,
    req: Json<CreateCommentRequest>,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<CreatedResponse>, Status> {
    // Author must be able to see the thread to reply to it.
    let visible = get_thread(pool, id, viewer_for(&user))
        .await
        .map_err(|_| Status::InternalServerError)?;
    if visible.is_none() {
        return Err(Status::NotFound);
    }
    let comment_id = create_comment(pool, id, req.parent_comment_id, user.id, &req.body)
        .await
        .map_err(|_| Status::BadRequest)?;
    Ok(Json(CreatedResponse { id: comment_id }))
}

#[instrument(skip(pool, user))]
#[delete("/threads/<id>")]
pub async fn api_delete_thread(
    id: i64,
    user: User,
    pool: &State<Pool<Sqlite>>,
) -> Result<Status, Status> {
    // Author may delete their own; coaches/admins may moderate any.
    let thread = get_thread(pool, id, viewer_for(&user))
        .await
        .map_err(|_| Status::InternalServerError)?
        .ok_or(Status::NotFound)?;
    let is_author = thread.author_id == user.id;
    let can_moderate = user.has_permission(Permission::ManageThreads);
    if !is_author && !can_moderate {
        return Err(Status::Forbidden);
    }
    soft_delete_thread(pool, id, user.id)
        .await
        .map_err(|_| Status::InternalServerError)?;
    Ok(Status::NoContent)
}

#[instrument(skip(pool, user))]
#[delete("/comments/<id>")]
pub async fn api_delete_comment(
    id: i64,
    user: User,
    pool: &State<Pool<Sqlite>>,
) -> Result<Status, Status> {
    // Look up the comment's author + thread to authorize.
    let row = sqlx::query!(
        r#"SELECT author_id AS "author_id!: i64", thread_id AS "thread_id!: i64"
           FROM thread_comments WHERE id = ?"#,
        id
    )
    .fetch_optional(pool.inner())
    .await
    .map_err(|_| Status::InternalServerError)?
    .ok_or(Status::NotFound)?;

    let is_author = row.author_id == user.id;
    let can_moderate = user.has_permission(Permission::ManageThreads);
    if !is_author && !can_moderate {
        return Err(Status::Forbidden);
    }
    soft_delete_comment(pool, id, user.id)
        .await
        .map_err(|_| Status::InternalServerError)?;
    Ok(Status::NoContent)
}
```

Note: confirm the `User` guard exposes `id` and `has_permission`/`require_permission`. Check:
Run: `grep -n "pub fn has_permission\|pub fn require_permission\|pub id" crates/syllabus-tracker/src/auth/user.rs`
Adjust the field/method access to match (e.g. `user.id` vs `user.id()`), keeping it consistent across all handlers.

- [ ] **Step 2: Register the module and mount the handlers**

In `crates/syllabus-tracker/src/lib.rs`, add alongside the other `pub mod` lines:

```rust
pub mod threads;
```

In `crates/syllabus-tracker/src/main.rs`, import the handlers near the other `use crate::...` route imports:

```rust
use crate::threads::{
    api_create_comment, api_create_thread, api_delete_comment, api_delete_thread,
    api_list_threads,
};
```

and add them to the `routes![]` list inside the `.mount("/api", routes![ ... ])` block:

```rust
            api_create_thread,
            api_list_threads,
            api_create_comment,
            api_delete_thread,
            api_delete_comment,
```

(If `main.rs` imports route handlers via a glob like `use crate::api::*;`, follow that style instead, add a `use crate::threads::*;` and the bare handler names in `routes![]`.)

- [ ] **Step 3: Write the failing endpoint tests**

Add to the `tests` module in `src/test/threads.rs` (these use the Rocket local client + cookie auth):

```rust
use crate::test::test_utils::{login_test_user, setup_test_client, TestDbBuilder};
use rocket::http::{ContentType, Status};
use serde_json::{json, Value};

async fn client_with_users() -> (rocket::local::asynchronous::Client, crate::test::test_utils::TestDb) {
    let db = TestDbBuilder::new()
        .coach("coach_user", Some("Coach"))
        .student("student_user", Some("Sam"))
        .student("student2", Some("Mia"))
        .build()
        .await
        .unwrap();
    setup_test_client(db).await
}

#[rocket::async_test]
async fn coach_creates_profile_thread_student_replies() {
    let (client, db) = client_with_users().await;
    let student_id = db.user_id("student_user").unwrap();

    login_test_user(&client, "coach_user", "password123").await;
    let create = client
        .post("/api/threads")
        .header(ContentType::JSON)
        .body(json!({
            "anchor_kind": "student_profile",
            "anchor_id": student_id,
            "visibility": "private",
            "scope_student_id": student_id,
            "body": "Let's plan your next six weeks."
        }).to_string())
        .dispatch()
        .await;
    assert_eq!(create.status(), Status::Ok);
    let thread_id = create.into_json::<Value>().await.unwrap()["id"].as_i64().unwrap();

    login_test_user(&client, "student_user", "password123").await;
    let reply = client
        .post(format!("/api/threads/{thread_id}/comments"))
        .header(ContentType::JSON)
        .body(json!({ "body": "Sounds good." }).to_string())
        .dispatch()
        .await;
    assert_eq!(reply.status(), Status::Ok);
}

#[rocket::async_test]
async fn student_cannot_post_on_another_students_profile() {
    let (client, db) = client_with_users().await;
    let victim_id = db.user_id("student2").unwrap();

    login_test_user(&client, "student_user", "password123").await;
    let res = client
        .post("/api/threads")
        .header(ContentType::JSON)
        .body(json!({
            "anchor_kind": "student_profile",
            "anchor_id": victim_id,
            "visibility": "private",
            "scope_student_id": victim_id,
            "body": "intrusion"
        }).to_string())
        .dispatch()
        .await;
    assert_eq!(res.status(), Status::Forbidden);
}

#[rocket::async_test]
async fn student_cannot_broadcast() {
    let (client, db) = client_with_users().await;
    let technique_id = db.technique_id("Armbar").unwrap_or(1);

    login_test_user(&client, "student_user", "password123").await;
    let res = client
        .post("/api/threads")
        .header(ContentType::JSON)
        .body(json!({
            "anchor_kind": "technique",
            "anchor_id": technique_id,
            "visibility": "broadcast",
            "body": "everyone look"
        }).to_string())
        .dispatch()
        .await;
    assert_eq!(res.status(), Status::Forbidden);
}
```

`client_with_users` builds its own users, so the techniques map may be empty; `student_cannot_broadcast` falls back to technique id `1` and only asserts the permission rejection (which fires before anchor validation), so it passes regardless of whether technique `1` exists.

- [ ] **Step 4: Run the endpoint tests**

Run: `cargo test -p syllabus-tracker -- threads:: --nocapture`
Expected: PASS for all three endpoint tests plus the earlier db tests.

- [ ] **Step 5: Commit**

```bash
git add crates/syllabus-tracker/src/threads crates/syllabus-tracker/src/lib.rs crates/syllabus-tracker/src/main.rs crates/syllabus-tracker/src/test/threads.rs
git commit -m "feat(threads): Add thread/comment CRUD endpoints with auth"
```

---

## Task 8: Regenerate the sqlx cache and run the full suite

**Files:**
- Modify: `.sqlx/` (generated)

- [ ] **Step 1: Regenerate the offline query cache against a seeded DB**

This repo's `.sqlx` cache type-info is data-dependent and CI runs `cargo sqlx prepare --check` against a seeded DB (see project memory `project-sqlx-check-seed-dependency`). Regenerate using the project's documented procedure:

Run: `just sqlx-prepare` (from repo root).
If no such recipe exists, run: `grep -n "sqlx" justfile` and follow the `sqlx-prepare`/`sqlx-check` recipe shown there.

Expected: `.sqlx/` gains query files for the new `threads`/`thread_comments` queries; `git status` shows new `.sqlx/query-*.json` files.

- [ ] **Step 2: Run the full backend suite**

Run: `cargo test -p syllabus-tracker`
Expected: the whole suite passes, including the new `threads::` tests.

- [ ] **Step 3: Run lint**

Run: `cargo clippy -p syllabus-tracker --all-targets -- -D warnings`
Expected: no warnings. Fix any (commonly: an unused import, or a `needless_return`).

- [ ] **Step 4: Commit**

```bash
git add .sqlx
git commit -m "chore(sqlx): Regenerate cache for threads queries"
```

---

## Self-review notes (for the implementer)

- **Spec coverage for PR1:** schema §4 (Task 1), permissions §6 (Task 2), anchor/visibility types D2/D4 (Task 3), allow-matrix + create §4/§6 (Task 4), comments/visibility read/soft-delete §6/D3 (Task 5), endpoints + auth §6 (Task 7). Out of PR1 by design: activity emission (PR5), the video/sst/pinned anchors and their surfaces (PR2-4), `@`-mentions (Phase B), frontend (later).
- **`AppError` variant:** Task 4 Step 3 flags that `BadRequest` may be named differently; resolve it once and use the same name throughout `db/threads.rs`.
- **`User` guard surface:** Task 7 Step 1 flags confirming `user.id` / `has_permission` / `require_permission` shapes against `auth/user.rs`; keep consistent.
- **`student2` in the standard db:** Task 5 Step 1 flags using a local `TestDbBuilder` if `create_standard_test_db` lacks a second student.
- **One level of nesting** (CX-010) is enforced in `create_comment` (Task 5), not the DDL.
- **`&State<Pool>` vs `&Pool`:** the db functions take `&Pool<Sqlite>` but handlers receive `pool: &State<Pool<Sqlite>>`. If the compiler complains, bind `let pool = pool.inner();` at the top of each handler (or pass `pool.inner()` / `&**pool` at the call site). Apply the same idiom in every handler for consistency; match whatever the existing `videos/routes.rs` handlers do.
