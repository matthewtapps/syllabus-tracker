# Thread Video Replies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any thread carry video replies (upload or external link) interleaved with text comments, where a text comment can reference a specific video reply at an optional timestamp.

**Architecture:** A video reply is a standalone `videos` row with `parent_kind='thread'` (the `VideoParent::Thread` foundation already exists). Text comments gain two nullable columns to reference a reply clip + timestamp. The `ThreadView` read returns comments and video replies as separate lists; the frontend merges them by `created_at`. A new `VideoReplyPosted` activity verb feeds the activity stream. A security fix closes a playback leak on private thread replies.

**Tech Stack:** Rust (Rocket + sqlx/SQLite, declarative migration engine), React 19 + Vite + TanStack Query + shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-06-20-thread-video-replies-design.md`

**Conventions used throughout:**
- Backend tests run with `SQLX_OFFLINE=true cargo nextest run --workspace --all-features` (alias `just test-backend`). The sqlx offline cache is the build gate.
- After adding or changing ANY `sqlx::query!`/`query_scalar!`/`query_as!` macro, regenerate the offline cache with `nix develop .#ci --command just sqlx-prepare`. NEVER run bare `cargo sqlx prepare` on the dev DB.
- Frontend `.test.tsx` only runs in CI (Chromium); do not attempt to run it on this box. Type-check with `cd frontend && npx tsc --noEmit`.
- Commit messages: imperative, scoped, NO `Co-Authored-By` trailer (repo convention). Example `feat(threads): ...`.
- No em-dashes in any UI copy.

---

## PHASE 1 — Backend

### Task 1: Add reference columns to `thread_comments`

**Files:**
- Modify: `config/schema.sql:515-525` (the `thread_comments` table)
- Test: `crates/syllabus-tracker/src/test/threads.rs`

The declarative migration engine diffs `config/schema.sql` against the live DB and synthesizes the migration; there is no separate migration file to write.

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `crates/syllabus-tracker/src/test/threads.rs`:

```rust
#[rocket::async_test]
async fn thread_comments_has_reference_columns() {
    let db = create_standard_test_db().await;
    let cols: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM pragma_table_info('thread_comments') \
         WHERE name IN ('references_video_id','ref_ts_seconds') ORDER BY name",
    )
    .fetch_all(&db.pool)
    .await
    .unwrap();
    assert_eq!(cols, vec!["ref_ts_seconds", "references_video_id"]);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `SQLX_OFFLINE=true cargo nextest run -p syllabus-tracker thread_comments_has_reference_columns`
Expected: FAIL (columns absent).

- [ ] **Step 3: Add the columns**

In `config/schema.sql`, edit the `thread_comments` table to add the two columns and a CHECK. The new table body:

```sql
CREATE TABLE IF NOT EXISTS thread_comments (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id         INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    parent_comment_id INTEGER REFERENCES thread_comments(id) ON DELETE CASCADE,
    author_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body              TEXT NOT NULL,
    references_video_id INTEGER REFERENCES videos(id),
    ref_ts_seconds    INTEGER,
    created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    edited_at         TIMESTAMP,
    deleted_at        TIMESTAMP,
    deleted_by_id     INTEGER REFERENCES users(id),
    CHECK (ref_ts_seconds IS NULL OR references_video_id IS NOT NULL)
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `SQLX_OFFLINE=true cargo nextest run -p syllabus-tracker thread_comments_has_reference_columns`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add config/schema.sql crates/syllabus-tracker/src/test/threads.rs
git commit -m "feat(threads): add comment video-reference columns to schema"
```

---

### Task 2: Add the `VideoReplyPosted` activity verb

**Files:**
- Modify: `crates/syllabus-tracker/src/db/activity.rs` (the `Verb` enum + its impls)
- Test: same file's `#[cfg(test)]` module (or add a standalone test in the impl block)

- [ ] **Step 1: Write the failing test**

Find the existing test module at the bottom of `activity.rs` and add:

```rust
#[test]
fn video_reply_posted_roundtrips_and_is_non_coalescing() {
    assert_eq!(Verb::from_str_verb("video_reply_posted"), Some(Verb::VideoReplyPosted));
    assert_eq!(Verb::VideoReplyPosted.as_str(), "video_reply_posted");
    assert!(!Verb::VideoReplyPosted.coalesces());
    assert!(Verb::VideoReplyPosted.notifiable());
    assert_eq!(Verb::VideoReplyPosted.primary_entity(), EntityKind::Thread);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `SQLX_OFFLINE=true cargo nextest run -p syllabus-tracker video_reply_posted_roundtrips`
Expected: FAIL to compile (`Verb::VideoReplyPosted` undefined).

- [ ] **Step 3: Add the variant across every Verb impl**

In `crates/syllabus-tracker/src/db/activity.rs`:

1. Add `VideoReplyPosted,` to `enum Verb` (after `ThreadCommentPosted,` at line ~51).
2. Add `Verb::VideoReplyPosted,` to the `ALL` array and bump its length `[Verb; 24]` to `[Verb; 25]`.
3. Add to `as_str`: `Verb::VideoReplyPosted => "video_reply_posted",`.
4. Add to the `coalesces` negated `matches!` list (so it is non-coalescing, like `ThreadCommentPosted`):

```rust
    pub fn coalesces(self) -> bool {
        !matches!(
            self,
            Verb::ThreadCommentPosted
                | Verb::VideoReplyPosted
                | Verb::CampCreated
                | Verb::CampTechniqueAdded
                | Verb::CampArchived
        )
    }
```

5. Add to `primary_entity` the arm `Verb::VideoReplyPosted => EntityKind::Thread,` (group it with `Verb::ThreadCommentPosted`).
6. Leave `notifiable` alone (default true is correct for a reply).

- [ ] **Step 4: Build to surface any other exhaustive `Verb` matches**

Run: `SQLX_OFFLINE=true cargo build -p syllabus-tracker`
Expected: compiler errors point at any other non-exhaustive `match` on `Verb` (e.g. read-layer label/entity mapping). Add a `Verb::VideoReplyPosted` arm to each, mirroring `Verb::ThreadCommentPosted`'s behaviour (thread entity, deep-links to the thread). Repeat until it builds.

- [ ] **Step 5: Run test to verify it passes**

Run: `SQLX_OFFLINE=true cargo nextest run -p syllabus-tracker video_reply_posted_roundtrips`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/syllabus-tracker/src/db/activity.rs
git commit -m "feat(activity): add VideoReplyPosted verb"
```

---

### Task 3: Read model — return video replies and comment references in `ThreadView`

**Files:**
- Modify: `crates/syllabus-tracker/src/db/threads.rs` (`CommentView`, `ThreadView`, `get_thread`)
- Test: `crates/syllabus-tracker/src/test/threads.rs`

- [ ] **Step 1: Write the failing test**

Add to `crates/syllabus-tracker/src/test/threads.rs`. This seeds a thread, inserts a `parent_kind='thread'` video reply directly, and a comment that references it, then asserts `get_thread` surfaces both.

```rust
#[rocket::async_test]
async fn get_thread_returns_video_replies_and_comment_refs() {
    let db = db_with_coach_and_student().await;
    let coach_id = db.user_id("coach_user").unwrap();
    let student_id = db.user_id("student_user").unwrap();

    // A broadcast technique thread (so both viewers can see it). Seed a
    // technique row first.
    sqlx::query("INSERT INTO techniques (id, name) VALUES (1, 'Armbar')")
        .execute(&db.pool).await.unwrap();
    let thread_id = create_thread(&db.pool, NewThread {
        author_id: coach_id,
        anchor: Anchor { kind: AnchorKind::Technique, id: 1, video_ts_seconds: None,
                         pinned_student_id: None, camp_id: None },
        visibility: ThreadVisibility::Broadcast,
        scope_student_id: None,
        body: "thoughts?".to_string(),
    }).await.unwrap();

    // Insert a video reply row directly (the create route is Task 6).
    let video_id: i64 = sqlx::query_scalar(
        "INSERT INTO videos (parent_kind, thread_id, title, description, position, kind, \
            processing_status, uploaded_by_id) \
         VALUES ('thread', ?, '', 'nice grip', 0, 'native', 'ready', ?) RETURNING id")
        .bind(thread_id).bind(student_id)
        .fetch_one(&db.pool).await.unwrap();

    // A comment referencing that reply at 0:32.
    sqlx::query(
        "INSERT INTO thread_comments (thread_id, author_id, body, references_video_id, ref_ts_seconds) \
         VALUES (?, ?, 'see 0:32', ?, 32)")
        .bind(thread_id).bind(coach_id).bind(video_id)
        .execute(&db.pool).await.unwrap();

    let view = get_thread(&db.pool, thread_id,
        Viewer { user_id: coach_id, is_coach: true }).await.unwrap().unwrap();

    assert_eq!(view.video_replies.len(), 1);
    assert_eq!(view.video_replies[0].id, video_id);
    assert_eq!(view.video_replies[0].caption.as_deref(), Some("nice grip"));
    assert_eq!(view.comments.len(), 1);
    assert_eq!(view.comments[0].references_video_id, Some(video_id));
    assert_eq!(view.comments[0].ref_ts_seconds, Some(32));
    assert_eq!(view.comments[0].referenced_caption.as_deref(), Some("nice grip"));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `SQLX_OFFLINE=true cargo nextest run -p syllabus-tracker get_thread_returns_video_replies`
Expected: FAIL to compile (`video_replies` / `references_video_id` fields absent).

- [ ] **Step 3: Add the view types and extend `get_thread`**

In `crates/syllabus-tracker/src/db/threads.rs`:

1. Import the `Video` model and the parent reader at the top:

```rust
use crate::models::Video;
```

2. Add the `VideoReplyView` struct near `CommentView`:

```rust
#[derive(Debug, Serialize)]
pub struct VideoReplyView {
    pub id: i64,
    pub author_id: i64,
    pub author_name: String,
    /// The reply's caption (videos.description); `None` when soft-deleted.
    pub caption: Option<String>,
    pub created_at: NaiveDateTime,
    pub deleted_at: Option<NaiveDateTime>,
    /// The full video payload; `None` when soft-deleted (tombstoned).
    pub video: Option<Video>,
}
```

3. Add three fields to `CommentView`:

```rust
    pub references_video_id: Option<i64>,
    pub ref_ts_seconds: Option<i64>,
    /// Denormalized caption of the referenced reply, for the chip label.
    pub referenced_caption: Option<String>,
```

4. Add `pub video_replies: Vec<VideoReplyView>,` to `ThreadView`.

5. In `get_thread`, extend the comments query to select the new columns plus the referenced reply's caption via a LEFT JOIN, and map them:

```rust
    let comments = sqlx::query!(
        r#"SELECT c.id AS "id!: i64",
                  c.thread_id AS "thread_id!: i64",
                  c.parent_comment_id AS "parent_comment_id?: i64",
                  c.author_id AS "author_id!: i64",
                  COALESCE(u.display_name, u.username, '?') AS "author_name!: String",
                  c.body,
                  c.references_video_id AS "references_video_id?: i64",
                  c.ref_ts_seconds AS "ref_ts_seconds?: i64",
                  rv.description AS "referenced_caption?: String",
                  c.created_at AS "created_at!: NaiveDateTime",
                  c.deleted_at AS "deleted_at?: NaiveDateTime"
           FROM thread_comments c
           JOIN users u ON u.id = c.author_id
           LEFT JOIN videos rv ON rv.id = c.references_video_id
           WHERE c.thread_id = ?
           ORDER BY c.created_at, c.id"#,
        thread_id
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|c| CommentView {
        id: c.id,
        thread_id: c.thread_id,
        parent_comment_id: c.parent_comment_id,
        author_id: c.author_id,
        author_name: c.author_name,
        body: if c.deleted_at.is_some() { None } else { Some(c.body) },
        references_video_id: c.references_video_id,
        ref_ts_seconds: c.ref_ts_seconds,
        referenced_caption: c.referenced_caption,
        created_at: c.created_at,
        deleted_at: c.deleted_at,
    })
    .collect();
```

6. After the comments block, read the thread's video replies. Use a runtime query (kept out of the offline cache, like the other thread runtime queries) and map to `VideoReplyView`:

```rust
    let reply_rows = crate::db::videos::list_videos_for_parent_global_visible(
        pool, crate::db::videos::VideoParent::Thread(row.id),
    ).await?;
    // list_videos_for_parent_global_visible already filters deleted + hidden;
    // we still need author names and to expose tombstones for deleted ones, so
    // join names here. Since deleted replies are filtered out by that reader,
    // every row maps to a live VideoReplyView (deleted_at = None, video = Some).
    let mut video_replies = Vec::with_capacity(reply_rows.len());
    for v in reply_rows {
        let author_name: String = sqlx::query_scalar::<_, String>(
            "SELECT COALESCE(display_name, username, '?') FROM users WHERE id = ?")
            .bind(v.uploaded_by_id)
            .fetch_one(pool)
            .await?;
        video_replies.push(VideoReplyView {
            id: v.id,
            author_id: v.uploaded_by_id,
            author_name,
            caption: v.description.clone(),
            created_at: v.created_at,
            deleted_at: None,
            video: Some(v),
        });
    }
```

> Note: `list_videos_for_parent_global_visible` filters out deleted/hidden replies, so a deleted reply simply disappears from `video_replies`. A comment that referenced it keeps its `referenced_caption` from the LEFT JOIN even if the reply is gone; the frontend renders the chip in a "clip removed" state when the referenced reply is not present in `video_replies`. Remove the `#[allow(dead_code)]` attribute on `list_videos_for_parent_global_visible` now that it has a caller.

7. Add `video_replies,` to the returned `ThreadView { ... }`.

8. Confirm `Video` derives `Clone` (it is cloned into `caption`); if `v.description.clone()` plus moving `v` into `video` conflicts, clone `description` before the move as shown.

- [ ] **Step 4: Regenerate sqlx cache (comments query changed)**

Run: `nix develop .#ci --command just sqlx-prepare`
Expected: updates files under `.sqlx/`.

- [ ] **Step 5: Run test to verify it passes**

Run: `SQLX_OFFLINE=true cargo nextest run -p syllabus-tracker get_thread_returns_video_replies`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/syllabus-tracker/src/db/threads.rs crates/syllabus-tracker/src/test/threads.rs .sqlx
git commit -m "feat(threads): surface video replies and comment references in ThreadView"
```

---

### Task 4: Validate and store comment references in `create_comment`

**Files:**
- Modify: `crates/syllabus-tracker/src/db/threads.rs` (`create_comment`)
- Test: `crates/syllabus-tracker/src/test/threads.rs`

- [ ] **Step 1: Write the failing tests**

Add to `crates/syllabus-tracker/src/test/threads.rs`. First update the import line to include the new `create_comment` signature usage. Add:

```rust
#[rocket::async_test]
async fn comment_reference_must_point_at_a_reply_in_this_thread() {
    let db = db_with_coach_and_student().await;
    let coach_id = db.user_id("coach_user").unwrap();
    let student_id = db.user_id("student_user").unwrap();
    sqlx::query("INSERT INTO techniques (id, name) VALUES (1, 'Armbar')")
        .execute(&db.pool).await.unwrap();

    let thread_a = create_thread(&db.pool, NewThread {
        author_id: coach_id,
        anchor: Anchor { kind: AnchorKind::Technique, id: 1, video_ts_seconds: None,
                         pinned_student_id: None, camp_id: None },
        visibility: ThreadVisibility::Broadcast, scope_student_id: None,
        body: "a".to_string(),
    }).await.unwrap();
    let thread_b = create_thread(&db.pool, NewThread {
        author_id: coach_id,
        anchor: Anchor { kind: AnchorKind::Technique, id: 1, video_ts_seconds: None,
                         pinned_student_id: None, camp_id: None },
        visibility: ThreadVisibility::Broadcast, scope_student_id: None,
        body: "b".to_string(),
    }).await.unwrap();

    // A reply belonging to thread_b.
    let reply_in_b: i64 = sqlx::query_scalar(
        "INSERT INTO videos (parent_kind, thread_id, title, position, kind, \
            processing_status, uploaded_by_id) \
         VALUES ('thread', ?, '', 0, 'native', 'ready', ?) RETURNING id")
        .bind(thread_b).bind(student_id)
        .fetch_one(&db.pool).await.unwrap();

    // Referencing thread_b's reply from a comment on thread_a must be rejected.
    let err = create_comment(&db.pool, thread_a, None, coach_id, "x",
        Some(reply_in_b), Some(10)).await;
    assert!(err.is_err(), "cross-thread reference must be rejected");

    // A ts with no referenced video must be rejected.
    let err2 = create_comment(&db.pool, thread_a, None, coach_id, "x", None, Some(10)).await;
    assert!(err2.is_err(), "timestamp without a reference must be rejected");
}

#[rocket::async_test]
async fn comment_reference_to_same_thread_reply_is_stored() {
    let db = db_with_coach_and_student().await;
    let coach_id = db.user_id("coach_user").unwrap();
    let student_id = db.user_id("student_user").unwrap();
    sqlx::query("INSERT INTO techniques (id, name) VALUES (1, 'Armbar')")
        .execute(&db.pool).await.unwrap();
    let thread_id = create_thread(&db.pool, NewThread {
        author_id: coach_id,
        anchor: Anchor { kind: AnchorKind::Technique, id: 1, video_ts_seconds: None,
                         pinned_student_id: None, camp_id: None },
        visibility: ThreadVisibility::Broadcast, scope_student_id: None,
        body: "a".to_string(),
    }).await.unwrap();
    let reply: i64 = sqlx::query_scalar(
        "INSERT INTO videos (parent_kind, thread_id, title, position, kind, \
            processing_status, uploaded_by_id) \
         VALUES ('thread', ?, '', 0, 'native', 'ready', ?) RETURNING id")
        .bind(thread_id).bind(student_id)
        .fetch_one(&db.pool).await.unwrap();

    let cid = create_comment(&db.pool, thread_id, None, coach_id, "see it",
        Some(reply), Some(32)).await.unwrap();
    let row = sqlx::query!(
        r#"SELECT references_video_id AS "r?: i64", ref_ts_seconds AS "t?: i64"
           FROM thread_comments WHERE id = ?"#, cid)
        .fetch_one(&db.pool).await.unwrap();
    assert_eq!(row.r, Some(reply));
    assert_eq!(row.t, Some(32));
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `SQLX_OFFLINE=true cargo nextest run -p syllabus-tracker comment_reference`
Expected: FAIL to compile (`create_comment` takes 4 args, not 6).

- [ ] **Step 3: Extend `create_comment`**

In `crates/syllabus-tracker/src/db/threads.rs`, change the signature and add validation + persistence:

```rust
#[instrument(skip(pool, body))]
pub async fn create_comment(
    pool: &Pool<Sqlite>,
    thread_id: i64,
    parent_comment_id: Option<i64>,
    author_id: i64,
    body: &str,
    references_video_id: Option<i64>,
    ref_ts_seconds: Option<i64>,
) -> Result<i64, AppError> {
```

After the existing thread-liveness fetch and the parent-nesting check, before `let mut tx`, add reference validation:

```rust
    // A timestamp is meaningless without a referenced clip.
    if ref_ts_seconds.is_some() && references_video_id.is_none() {
        return Err(AppError::Validation(
            "ref_ts_seconds requires references_video_id".to_string(),
        ));
    }
    // A referenced clip must be a live video reply ON THIS thread.
    if let Some(ref_id) = references_video_id {
        let ok = sqlx::query_scalar!(
            r#"SELECT EXISTS(
                  SELECT 1 FROM videos
                  WHERE id = ? AND thread_id = ? AND parent_kind = 'thread'
                    AND deleted_at IS NULL
               ) AS "e!: i64""#,
            ref_id, thread_id,
        )
        .fetch_one(pool)
        .await?;
        if ok == 0 {
            return Err(AppError::Validation(
                "referenced video is not a reply on this thread".to_string(),
            ));
        }
    }
```

Then change the INSERT to include the two columns:

```rust
    let comment_id = sqlx::query_scalar!(
        r#"INSERT INTO thread_comments
              (thread_id, parent_comment_id, author_id, body, references_video_id, ref_ts_seconds)
           VALUES (?, ?, ?, ?, ?, ?)
           RETURNING id AS "id!: i64""#,
        thread_id,
        parent_comment_id,
        author_id,
        body,
        references_video_id,
        ref_ts_seconds,
    )
    .fetch_one(&mut *tx)
    .await?;
```

- [ ] **Step 4: Update the existing `create_comment` caller**

In `crates/syllabus-tracker/src/threads/routes.rs`, `api_create_comment` calls `create_comment(pool, id, req.parent_comment_id, user.id, &req.body)`. Update it to pass the new args (the request fields are added in Task 6; for now pass `None, None` and a `// TODO Task 6` is NOT allowed, so add the request fields now):

In `CreateCommentRequest` add:

```rust
    pub references_video_id: Option<i64>,
    pub ref_ts_seconds: Option<i64>,
```

And the call:

```rust
    let comment_id = create_comment(
        pool, id, req.parent_comment_id, user.id, &req.body,
        req.references_video_id, req.ref_ts_seconds,
    )
    .await.map_err(|_| Status::BadRequest)?;
```

Also fix any other `create_comment(...)` call sites the compiler flags (e.g. seed, other tests) by appending `, None, None`.

- [ ] **Step 5: Regenerate sqlx cache**

Run: `nix develop .#ci --command just sqlx-prepare`

- [ ] **Step 6: Run tests to verify they pass**

Run: `SQLX_OFFLINE=true cargo nextest run -p syllabus-tracker comment_reference`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add crates/syllabus-tracker/src/db/threads.rs crates/syllabus-tracker/src/threads/routes.rs crates/syllabus-tracker/src/test/threads.rs .sqlx
git commit -m "feat(threads): validate and store comment video references"
```

---

### Task 5: DB helper to record a thread video reply (last_activity + VideoReplyPosted)

**Files:**
- Modify: `crates/syllabus-tracker/src/db/threads.rs` (new `record_thread_video_reply`)
- Test: `crates/syllabus-tracker/src/test/threads.rs`

This bumps `last_activity_at` and emits the feed event after a reply video row exists. Targeting mirrors `create_comment`: private thread targets the scope student, broadcast targets none.

- [ ] **Step 1: Write the failing test**

```rust
#[rocket::async_test]
async fn recording_a_video_reply_emits_activity_and_bumps_thread() {
    let db = db_with_coach_and_student().await;
    let coach_id = db.user_id("coach_user").unwrap();
    let student_id = db.user_id("student_user").unwrap();

    let thread_id = create_thread(&db.pool, NewThread {
        author_id: coach_id,
        anchor: Anchor { kind: AnchorKind::StudentProfile, id: student_id,
                         video_ts_seconds: None, pinned_student_id: None, camp_id: None },
        visibility: ThreadVisibility::Private, scope_student_id: Some(student_id),
        body: "hi".to_string(),
    }).await.unwrap();
    let video_id: i64 = sqlx::query_scalar(
        "INSERT INTO videos (parent_kind, thread_id, title, position, kind, \
            processing_status, uploaded_by_id) \
         VALUES ('thread', ?, '', 0, 'native', 'ready', ?) RETURNING id")
        .bind(thread_id).bind(student_id)
        .fetch_one(&db.pool).await.unwrap();

    crate::db::threads::record_thread_video_reply(&db.pool, thread_id, video_id, student_id)
        .await.unwrap();

    let act = sqlx::query!(
        r#"SELECT verb, target_student_id AS "t?: i64", thread_id AS "th?: i64",
                  video_id AS "v?: i64"
           FROM activity WHERE verb = 'video_reply_posted'"#)
        .fetch_one(&db.pool).await.unwrap();
    assert_eq!(act.t, Some(student_id));
    assert_eq!(act.th, Some(thread_id));
    assert_eq!(act.v, Some(video_id));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `SQLX_OFFLINE=true cargo nextest run -p syllabus-tracker recording_a_video_reply`
Expected: FAIL to compile (`record_thread_video_reply` undefined).

- [ ] **Step 3: Implement `record_thread_video_reply`**

In `crates/syllabus-tracker/src/db/threads.rs`:

```rust
/// Bumps the thread's `last_activity_at` and emits a `VideoReplyPosted` feed
/// event after a video-reply row (parent_kind='thread') has been created for
/// `thread_id`. Targeting mirrors `create_comment`: a private thread targets
/// its scope student; a broadcast thread targets none (coach-only feed).
#[instrument(skip(pool))]
pub async fn record_thread_video_reply(
    pool: &Pool<Sqlite>,
    thread_id: i64,
    video_id: i64,
    author_id: i64,
) -> Result<(), AppError> {
    let thread_row = sqlx::query!(
        r#"SELECT visibility,
                  scope_student_id AS "scope_student_id?: i64",
                  technique_id     AS "technique_id?: i64",
                  video_id         AS "video_id?: i64",
                  sst_id           AS "sst_id?: i64",
                  camp_id          AS "camp_id?: i64"
           FROM threads WHERE id = ? AND deleted_at IS NULL"#,
        thread_id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("thread #{thread_id} not found")))?;

    let mut tx = pool.begin().await?;
    sqlx::query!(
        "UPDATE threads SET last_activity_at = CURRENT_TIMESTAMP WHERE id = ?",
        thread_id
    )
    .execute(&mut *tx)
    .await?;

    let target = if thread_row.visibility == "private" {
        thread_row.scope_student_id
    } else {
        None
    };
    let mut ev = NewActivity::new(Verb::VideoReplyPosted, author_id)
        .thread(thread_id)
        .video(video_id);
    if let Some(t) = target {
        ev = ev.target_student(t);
    }
    let mut ev = apply_thread_anchor_context(
        &mut tx, ev,
        thread_row.technique_id, thread_row.video_id, thread_row.sst_id,
    ).await?;
    if let Some(camp_id) = thread_row.camp_id {
        ev = ev.camp(camp_id).context_kind("camp");
    }
    emit(&mut tx, ev).await?;
    tx.commit().await?;
    Ok(())
}
```

(`emit`, `NewActivity`, `Verb`, `apply_thread_anchor_context` are already in scope in this module.)

- [ ] **Step 4: Regenerate sqlx cache**

Run: `nix develop .#ci --command just sqlx-prepare`

- [ ] **Step 5: Run test to verify it passes**

Run: `SQLX_OFFLINE=true cargo nextest run -p syllabus-tracker recording_a_video_reply`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/syllabus-tracker/src/db/threads.rs crates/syllabus-tracker/src/test/threads.rs .sqlx
git commit -m "feat(threads): record thread video reply activity"
```

---

### Task 6: Routes to post a video reply (upload + link)

**Files:**
- Modify: `crates/syllabus-tracker/src/videos/routes.rs` (add two handlers)
- Modify: `crates/syllabus-tracker/src/main.rs` (mount them)
- Test: `crates/syllabus-tracker/src/test/api.rs` (HTTP-level) or `videos.rs` (db-level). Use db-level here for the link path (no multipart needed).

Authorization: the caller must pass the existing `get_thread` visibility gate. Reuse `db::create_processing_video` / `db::create_external_video` with `VideoParent::Thread`, then `db::threads::record_thread_video_reply`. Thread replies allow an EMPTY title (replies have no title; caption goes to `description`).

- [ ] **Step 1: Write the failing test (db-level link path)**

Add to `crates/syllabus-tracker/src/test/videos.rs` a test that drives the link helper + record through a small inline function mirroring the route body. Simpler: test the building blocks compose. Add:

```rust
#[rocket::async_test]
async fn thread_video_reply_link_creates_reply_and_activity() {
    use crate::db;
    let db = crate::test::test_utils::TestDbBuilder::new()
        .coach("coach_user", Some("Coach"))
        .student("student_user", Some("Sam"))
        .build().await.unwrap();
    let coach_id = db.user_id("coach_user").unwrap();
    let student_id = db.user_id("student_user").unwrap();
    sqlx::query("INSERT INTO techniques (id, name) VALUES (1, 'Armbar')")
        .execute(&db.pool).await.unwrap();
    let thread_id = db::threads::create_thread(&db.pool, db::threads::NewThread {
        author_id: coach_id,
        anchor: db::threads::Anchor { kind: db::threads::AnchorKind::StudentProfile,
            id: student_id, video_ts_seconds: None, pinned_student_id: None, camp_id: None },
        visibility: db::threads::ThreadVisibility::Private,
        scope_student_id: Some(student_id), body: "hi".to_string(),
    }).await.unwrap();

    let vid = db::create_external_video(&db.pool, db::NewExternalVideo {
        parent: db::VideoParent::Thread(thread_id),
        title: "", description: Some("my reply"),
        uploaded_by_id: student_id, kind: crate::models::VideoKind::Youtube,
        external_url: "https://youtu.be/abc", external_host: Some("youtube"),
        external_video_id: Some("abc"),
    }).await.unwrap();
    db::threads::record_thread_video_reply(&db.pool, thread_id, vid, student_id)
        .await.unwrap();

    let row = sqlx::query!(
        r#"SELECT parent_kind, thread_id AS "th?: i64", description
           FROM videos WHERE id = ?"#, vid)
        .fetch_one(&db.pool).await.unwrap();
    assert_eq!(row.parent_kind, "thread");
    assert_eq!(row.th, Some(thread_id));
    assert_eq!(row.description.as_deref(), Some("my reply"));
}
```

- [ ] **Step 2: Run test to verify it fails / passes-by-composition**

Run: `SQLX_OFFLINE=true cargo nextest run -p syllabus-tracker thread_video_reply_link_creates_reply`
Expected: PASS already IF Tasks 2/5 landed (this test only exercises existing db helpers + Task 5). If `VideoKind::Youtube` differs, fix the variant name from `crate::models::VideoKind` (check the enum). This test guards the composition the route depends on.

- [ ] **Step 3: Add the two route handlers**

In `crates/syllabus-tracker/src/videos/routes.rs`, add a small helper and two handlers. Place near `api_video_link`:

```rust
/// Shared gate: the caller must be able to see the thread (coach, broadcast,
/// or the scope student). Returns the thread id on success.
async fn require_thread_visible(
    pool: &Pool<Sqlite>,
    user: &User,
    thread_id: i64,
) -> Result<(), Status> {
    let viewer = db::threads::Viewer {
        user_id: user.id,
        is_coach: user.has_permission(Permission::ViewAllStudents),
    };
    let visible = db::threads::get_thread(pool, thread_id, viewer)
        .await
        .map_err(Status::from)?;
    if visible.is_none() {
        return Err(Status::NotFound);
    }
    Ok(())
}

#[instrument(skip(form, pool, processor))]
#[post("/threads/<thread_id>/videos/upload", data = "<form>")]
pub async fn api_thread_video_reply_upload(
    thread_id: i64,
    user: User,
    form: Result<Form<UploadForm<'_>>, FormErrors<'_>>,
    pool: &State<Pool<Sqlite>>,
    processor: &State<DynVideoProcessor>,
) -> Result<Json<UploadResponse>, Status> {
    let pool = pool.inner();
    require_thread_visible(pool, &user, thread_id).await?;

    let mut form = form.map_err(|errs| {
        error!(thread_id, errors = %errs, "thread video reply form failed to parse");
        Status::BadRequest
    })?;
    let metrics = video_metrics();
    if !is_mp4(form.file.content_type()) {
        metrics.uploads_total.add(1, &[kv("result", "fail_format")]);
        return Err(Status::UnsupportedMediaType);
    }
    if form.file.len() > max_video_bytes() as u64 {
        metrics.uploads_total.add(1, &[kv("result", "fail_size")]);
        return Err(Status::PayloadTooLarge);
    }
    tokio::fs::create_dir_all(pipeline::temp_dir()).await.map_err(|e| {
        error!(thread_id, error = %e, "failed to create video temp dir for thread reply");
        Status::InternalServerError
    })?;
    let mut dest = pipeline::temp_dir();
    dest.push(format!("{}.mp4", Uuid::new_v4()));
    form.file.persist_to(&dest).await.map_err(|e| {
        error!(thread_id, dest = ?dest, error = %e, "failed to persist thread reply upload");
        Status::InternalServerError
    })?;

    // Thread replies have no title; the caption lives in description.
    let video_id = db::create_processing_video(
        pool,
        db::VideoParent::Thread(thread_id),
        "",
        form.description.as_deref(),
        user.id,
    )
    .await
    .map_err(Status::from)?;
    db::threads::record_thread_video_reply(pool, thread_id, video_id, user.id)
        .await
        .map_err(Status::from)?;

    processor.start(HostJob { video_id, parent_id: thread_id, original_temp_path: dest }).await;

    Ok(Json(UploadResponse {
        video_id,
        processing_status: ProcessingStatus::Processing.as_str().to_string(),
    }))
}

#[instrument(skip(body, pool))]
#[post("/threads/<thread_id>/videos/link", data = "<body>")]
pub async fn api_thread_video_reply_link(
    thread_id: i64,
    user: User,
    body: Json<LinkVideoRequest>,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<Video>, Status> {
    let pool = pool.inner();
    require_thread_visible(pool, &user, thread_id).await?;
    let req = body.into_inner();
    if req.url.trim().is_empty() {
        return Err(Status::UnprocessableEntity);
    }
    let parsed = embeds::parse(&req.url);
    let id = db::create_external_video(pool, db::NewExternalVideo {
        parent: db::VideoParent::Thread(thread_id),
        title: "",
        description: req.description.as_deref(),
        uploaded_by_id: user.id,
        kind: parsed.kind,
        external_url: &parsed.canonical_url,
        external_host: Some(parsed.host.as_str()),
        external_video_id: parsed.video_id.as_deref(),
    })
    .await
    .map_err(Status::from)?;
    db::threads::record_thread_video_reply(pool, thread_id, id, user.id)
        .await
        .map_err(Status::from)?;
    let video = db::get_video(pool, id).await.map_err(Status::from)?
        .ok_or(Status::InternalServerError)?;
    Ok(Json(video))
}
```

- [ ] **Step 4: Mount the routes**

In `crates/syllabus-tracker/src/main.rs`, find the `routes![ ... ]` list that mounts `api_video_link` / `api_video_upload` and add `api_thread_video_reply_upload, api_thread_video_reply_link,` alongside them. Ensure they are imported via the existing `videos::routes::...` import group.

- [ ] **Step 5: Build + run test**

Run: `SQLX_OFFLINE=true cargo build -p syllabus-tracker && SQLX_OFFLINE=true cargo nextest run -p syllabus-tracker thread_video_reply_link_creates_reply`
Expected: builds, PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/syllabus-tracker/src/videos/routes.rs crates/syllabus-tracker/src/main.rs crates/syllabus-tracker/src/test/videos.rs
git commit -m "feat(videos): add thread video reply upload and link routes"
```

---

### Task 7: Security fix — gate playback/download of private thread replies

**Files:**
- Modify: `crates/syllabus-tracker/src/db/videos.rs` (`video_visible_to_student_anywhere`)
- Test: `crates/syllabus-tracker/src/test/videos.rs`

The current non-syllabus fallback uses only the global `hidden_at`, so any student could play another student's private thread reply by id. For `parent_kind='thread'`, resolve the parent thread and apply the thread visibility rule.

- [ ] **Step 1: Write the failing test**

```rust
#[rocket::async_test]
async fn private_thread_reply_not_playable_by_other_student() {
    use crate::db;
    let tdb = crate::test::test_utils::TestDbBuilder::new()
        .coach("coach_user", Some("Coach"))
        .student("sam", Some("Sam"))
        .student("pat", Some("Pat"))
        .build().await.unwrap();
    let coach_id = tdb.user_id("coach_user").unwrap();
    let sam = tdb.user_id("sam").unwrap();
    let pat = tdb.user_id("pat").unwrap();

    // A private thread scoped to Sam.
    let thread_id = db::threads::create_thread(&tdb.pool, db::threads::NewThread {
        author_id: coach_id,
        anchor: db::threads::Anchor { kind: db::threads::AnchorKind::StudentProfile,
            id: sam, video_ts_seconds: None, pinned_student_id: None, camp_id: None },
        visibility: db::threads::ThreadVisibility::Private,
        scope_student_id: Some(sam), body: "hi".to_string(),
    }).await.unwrap();
    let vid: i64 = sqlx::query_scalar(
        "INSERT INTO videos (parent_kind, thread_id, title, position, kind, \
            processing_status, uploaded_by_id) \
         VALUES ('thread', ?, '', 0, 'native', 'ready', ?) RETURNING id")
        .bind(thread_id).bind(sam).fetch_one(&tdb.pool).await.unwrap();

    assert!(db::video_visible_to_student_anywhere(&tdb.pool, vid, sam).await.unwrap(),
        "scope student can play");
    assert!(!db::video_visible_to_student_anywhere(&tdb.pool, vid, pat).await.unwrap(),
        "other student cannot play a private thread reply");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `SQLX_OFFLINE=true cargo nextest run -p syllabus-tracker private_thread_reply_not_playable`
Expected: FAIL (Pat currently sees it via the global fallback).

- [ ] **Step 3: Add the thread branch**

In `video_visible_to_student_anywhere`, the block that handles non-syllabus parents currently returns the global `hidden_at` rule. Before that fallback, special-case `thread`:

```rust
    // Thread replies are scoped by their parent thread's visibility, NOT the
    // naive global hide. A student may play a reply only if they could see the
    // thread (broadcast, or they are its scope student).
    if parent_kind == "thread" {
        let row = sqlx::query!(
            r#"SELECT t.visibility,
                      t.scope_student_id AS "scope?: i64",
                      (v.hidden_at IS NULL) AS "not_hidden!: i64"
               FROM videos v
               JOIN threads t ON t.id = v.thread_id
               WHERE v.id = ? AND t.deleted_at IS NULL"#,
            video_id,
        )
        .fetch_optional(pool)
        .await?;
        let Some(row) = row else { return Ok(false); };
        let can_see = row.visibility == "broadcast" || row.scope == Some(student_id);
        return Ok(can_see && row.not_hidden != 0);
    }
```

(The existing student-visibility guard at the call site already lets coaches bypass this function; this branch governs students.)

- [ ] **Step 4: Regenerate sqlx cache + run test**

Run: `nix develop .#ci --command just sqlx-prepare && SQLX_OFFLINE=true cargo nextest run -p syllabus-tracker private_thread_reply_not_playable`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/syllabus-tracker/src/db/videos.rs crates/syllabus-tracker/src/test/videos.rs .sqlx
git commit -m "fix(videos): scope thread reply playback to thread visibility"
```

---

### Task 8: Backend gate — full verify

- [ ] **Step 1: Run the full backend suite + lint**

Run: `SQLX_OFFLINE=true cargo nextest run --workspace --all-features` then `nix develop .#ci --command just lint`
Expected: all green. Fix any fallout (most likely additional `create_comment` call sites or `Verb` match arms).

- [ ] **Step 2: Commit any fixes**

```bash
git add -A
git commit -m "test(threads): fix call sites after video reply changes"
```

---

## PHASE 2 — Frontend

### Task 9: API client types + functions

**Files:**
- Modify: `frontend/src/lib/api.ts` (`CommentView`, `ThreadView`, `createComment`, new upload/link funcs)
- Test: type-check only

- [ ] **Step 1: Extend the types and functions**

In `frontend/src/lib/api.ts`:

1. Add to `CommentView`:

```ts
  references_video_id: number | null;
  ref_ts_seconds: number | null;
  referenced_caption: string | null;
```

2. Add a `VideoReplyView` interface and `video_replies` to `ThreadView`:

```ts
export interface VideoReplyView {
  id: number;
  author_id: number;
  author_name: string;
  caption: string | null;
  created_at: string;
  deleted_at: string | null;
  video: Video | null;
}
```

In `ThreadView`, add `video_replies: VideoReplyView[];`.

3. Extend `createComment` to forward the optional reference:

```ts
export async function createComment(
  threadId: number,
  body: string,
  parentCommentId?: number | null,
  ref?: { videoId: number; tsSeconds: number | null },
): Promise<Response> {
  return fetch(`/api/threads/${threadId}/comments`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      body,
      parent_comment_id: parentCommentId ?? null,
      references_video_id: ref?.videoId ?? null,
      ref_ts_seconds: ref?.tsSeconds ?? null,
    }),
  });
}
```

4. Add the two reply-create functions (mirror the existing `uploadVideo`/`linkVideo` shapes; find those for the exact `FormData`/fetch pattern):

```ts
export async function uploadThreadVideoReply(
  threadId: number,
  file: File,
  caption: string | null,
  onProgress?: (pct: number) => void,
): Promise<{ video_id: number; processing_status: string }> {
  const form = new FormData();
  form.append("file", file);
  form.append("title", "");
  if (caption) form.append("description", caption);
  // Reuse the same XHR-with-progress helper the technique upload uses; if the
  // existing uploadVideo() exposes it, call that helper with this URL instead.
  const res = await fetch(`/api/threads/${threadId}/videos/upload`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.statusText}`);
  return res.json();
}

export async function linkThreadVideoReply(
  threadId: number,
  url: string,
  caption: string | null,
): Promise<Video> {
  const res = await fetch(`/api/threads/${threadId}/videos/link`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "", url, description: caption }),
  });
  if (!res.ok) throw new Error(`Link failed: ${res.statusText}`);
  return res.json();
}
```

> If `uploadVideo()` in this file already wraps an XHR progress helper, refactor `uploadThreadVideoReply` to call that shared helper with the thread URL rather than duplicating the bare `fetch`, to keep the progress UX. Inspect `uploadVideo` before writing this.

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS (consumers updated in later tasks may surface errors; fix forward).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(api): thread video reply client types and functions"
```

---

### Task 10: Mutations + query invalidation

**Files:**
- Modify: `frontend/src/lib/mutations.ts` (`useCreateComment`, new `useCreateThreadVideoReply`)
- Test: type-check

- [ ] **Step 1: Extend `useCreateComment` to accept a reference**

In `frontend/src/lib/mutations.ts`, `useCreateComment`'s mutation variable object currently is `{ threadId, body, parentCommentId }`. Add an optional `ref`:

```ts
    mutationFn: async (v: {
      threadId: number;
      body: string;
      parentCommentId?: number | null;
      ref?: { videoId: number; tsSeconds: number | null };
    }) => unwrap(await createComment(v.threadId, v.body, v.parentCommentId, v.ref)),
```

- [ ] **Step 2: Add `useCreateThreadVideoReply`**

Mirror `useCreateComment`'s invalidation (it invalidates `qk.threads(anchorKind, anchorId, keyCampId)` and, for video anchors, `qk.threads("video", anchorId)`). Add:

```ts
export function useCreateThreadVideoReply(
  anchorKind: string,
  anchorId: number,
  campId?: number,
) {
  const qc = useQueryClient();
  const keyCampId = anchorKind === "camp_technique" ? campId : undefined;
  return useMutation({
    mutationFn: async (v:
      | { threadId: number; kind: "upload"; file: File; caption: string | null }
      | { threadId: number; kind: "link"; url: string; caption: string | null },
    ) => {
      if (v.kind === "upload") {
        return uploadThreadVideoReply(v.threadId, v.file, v.caption);
      }
      return linkThreadVideoReply(v.threadId, v.url, v.caption);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.threads(anchorKind, anchorId, keyCampId) });
      if (anchorKind === "video") {
        qc.invalidateQueries({ queryKey: qk.threads("video", anchorId) });
      }
    },
  });
}
```

Add the imports for `uploadThreadVideoReply`, `linkThreadVideoReply` from `@/lib/api`.

- [ ] **Step 3: Type-check + commit**

Run: `cd frontend && npx tsc --noEmit`

```bash
git add frontend/src/lib/mutations.ts
git commit -m "feat(mutations): thread video reply mutation and comment refs"
```

---

### Task 11: Render the merged timeline + video replies in `thread-view.tsx`

**Files:**
- Modify: `frontend/src/components/threads/thread-view.tsx`
- Reference (read first): `frontend/src/components/videos/video-row.tsx` (how a single video renders), `frontend/src/components/videos/player-context.tsx` (`usePlayerController().seekTo`).
- Test: `frontend/src/components/threads/thread-view.test.tsx` (CI-only; stub `window.fetch`, see `references/vitest-browser-fetch-stub` pattern in the repo)

- [ ] **Step 1: Build the merged timeline**

In `thread-view.tsx`, replace the "Replies" block. Merge comments and video replies into one array sorted by `created_at`, then render each:

```tsx
type TimelineEntry =
  | { kind: "comment"; at: string; comment: CommentView }
  | { kind: "video"; at: string; reply: VideoReplyView };

const entries: TimelineEntry[] = [
  ...thread.comments.map((c) => ({ kind: "comment" as const, at: c.created_at, comment: c })),
  ...thread.video_replies.map((r) => ({ kind: "video" as const, at: r.created_at, reply: r })),
].sort((a, b) => a.at.localeCompare(b.at));
```

Render:

```tsx
{entries.length > 0 && (
  <div className="space-y-3 border-l-2 border-border pl-3">
    {entries.map((e) =>
      e.kind === "comment" ? (
        <CommentItem
          key={`c${e.comment.id}`}
          comment={e.comment}
          authorName={e.comment.author_name}
          videoReplies={thread.video_replies}
        />
      ) : (
        <VideoReplyItem key={`v${e.reply.id}`} reply={e.reply} />
      ),
    )}
  </div>
)}
```

Import `CommentView`, `VideoReplyView` types from `@/lib/api`.

- [ ] **Step 2: Create `VideoReplyItem`**

Create `frontend/src/components/threads/video-reply-item.tsx`. Render the author row (mirror the `CommentItem` header), the caption, and the video. Reuse `VideoRow` (or the player component `VideoRow` uses) for the clip. Critically, a thread reply clip must NOT render a "start thread" / comment-count affordance: pass whatever prop `VideoRow` exposes to hide comments, or render the lower-level player directly. Inspect `VideoRow`'s props first.

```tsx
import { StudentAvatar } from "@/components/student-avatar";
import { formatRelativeShort } from "@/lib/dates";
import { VideoRow } from "@/components/videos/video-row";
import type { VideoReplyView } from "@/lib/api";

export function VideoReplyItem({ reply }: { reply: VideoReplyView }) {
  if (!reply.video) {
    return <p className="text-sm italic text-muted-foreground">clip removed</p>;
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2.5">
        <StudentAvatar id={reply.author_id} name={reply.author_name} size="sm" />
        <span className="text-sm font-medium">{reply.author_name}</span>
        <span className="text-xs text-muted-foreground">
          {formatRelativeShort(reply.created_at)}
        </span>
      </div>
      <VideoRow video={reply.video} disableComments />
      {reply.caption && <p className="text-sm text-muted-foreground">{reply.caption}</p>}
    </div>
  );
}
```

> `disableComments` is illustrative. If `VideoRow` does not have such a prop, either add one (default false, preserving existing call sites) or render the inner player component directly. Choose the lower-risk option after reading `VideoRow`.

- [ ] **Step 3: Type-check + commit**

Run: `cd frontend && npx tsc --noEmit`

```bash
git add frontend/src/components/threads/thread-view.tsx frontend/src/components/threads/video-reply-item.tsx frontend/src/components/videos/video-row.tsx
git commit -m "feat(threads): render video replies in the thread timeline"
```

---

### Task 12: Reference chip + clip seek in `CommentItem`

**Files:**
- Modify: `frontend/src/components/threads/comment-item.tsx`
- Test: CI-only `.test.tsx`

- [ ] **Step 1: Render the chip**

`CommentItem` now receives `videoReplies: VideoReplyView[]` (passed in Task 11). When `comment.references_video_id` is set, render a chip above the body. Clicking it should seek the matching reply's player. Use `usePlayerController().seekTo` if the referenced reply's player is mounted in the same tree; otherwise scroll the reply into view and seek.

```tsx
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePlayerController } from "@/components/videos/player-context";

// inside CommentItem, before the body <p>:
{comment.references_video_id && (
  <ReferenceChip
    refId={comment.references_video_id}
    tsSeconds={comment.ref_ts_seconds}
    caption={comment.referenced_caption}
    videoReplies={videoReplies}
  />
)}
```

Add `ReferenceChip` (same file or a sibling). It formats the timestamp `mm:ss`, labels the chip with the caption (or "clip"), and seeks on click:

```tsx
function ReferenceChip({ refId, tsSeconds, caption, videoReplies }: {
  refId: number; tsSeconds: number | null; caption: string | null;
  videoReplies: VideoReplyView[];
}) {
  const player = usePlayerController();
  const exists = videoReplies.some((r) => r.id === refId && r.video);
  const label = caption ?? "clip";
  const ts = tsSeconds != null
    ? ` @${Math.floor(tsSeconds / 60)}:${String(tsSeconds % 60).padStart(2, "0")}`
    : "";
  if (!exists) {
    return <span className="text-xs italic text-muted-foreground">replying to a removed clip</span>;
  }
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className="h-6 gap-1 text-xs"
      onClick={() => {
        document.getElementById(`reply-${refId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        if (tsSeconds != null) player.seekTo(tsSeconds);
      }}
    >
      <Play className="h-3 w-3" />
      {label}{ts}
    </Button>
  );
}
```

Add `id={`reply-${reply.id}`}` to the `VideoReplyItem` wrapping `div` (Task 11) so the scroll target exists.

> Player coupling: `usePlayerController` requires a `PlayerControllerProvider` ancestor. Confirm `thread-view` is rendered within one (the video player surfaces provide it). If not, the simplest reliable behaviour is scroll-into-view + autoplay-from-ts handled by `VideoRow` via a prop; pick the approach that matches how `VideoRow` already seeks elsewhere.

- [ ] **Step 2: Type-check + commit**

Run: `cd frontend && npx tsc --noEmit`

```bash
git add frontend/src/components/threads/comment-item.tsx frontend/src/components/threads/video-reply-item.tsx
git commit -m "feat(threads): comment reference chip seeks the referenced clip"
```

---

### Task 13: Video reply composer + clip picker in the reply box

**Files:**
- Create: `frontend/src/components/threads/video-reply-composer.tsx`
- Modify: `frontend/src/components/threads/thread-view.tsx` (wire the composer + pass refs into the text composer)
- Modify: `frontend/src/components/threads/thread-composer.tsx` (optional "refer to a clip" picker)
- Reference: `frontend/src/components/videos/add-video-button.tsx` (the two-tab Sheet pattern)

- [ ] **Step 1: Build `VideoReplyComposer`**

Mirror `AddVideoButton`'s two-tab Sheet (`Upload file` / `Paste link`) but post via `useCreateThreadVideoReply`. It needs `threadId`, `anchorKind`, `anchorId`, optional `campId`. Tabs collect a file (+ optional caption) or a URL (+ optional caption), call the mutation, and close on success. Keep the form minimal: caption is a single optional input. Use the existing upload progress pattern from `UploadVideoForm` if you reuse its helper.

```tsx
import { useState } from "react";
import { VideoIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCreateThreadVideoReply } from "@/lib/mutations";

export function VideoReplyComposer({ threadId, anchorKind, anchorId, campId }: {
  threadId: number; anchorKind: string; anchorId: number; campId?: number;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"upload" | "link">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");
  const mutate = useCreateThreadVideoReply(anchorKind, anchorId, campId);

  async function submit() {
    try {
      if (tab === "upload") {
        if (!file) return;
        await mutate.mutateAsync({ threadId, kind: "upload", file, caption: caption || null });
      } else {
        if (!url.trim()) return;
        await mutate.mutateAsync({ threadId, kind: "link", url: url.trim(), caption: caption || null });
      }
      setOpen(false); setFile(null); setUrl(""); setCaption("");
    } catch {
      toast.error("Failed to post video reply. Please try again.");
    }
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <VideoIcon className="mr-1.5 h-4 w-4" aria-hidden />
        Video reply
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-4 overflow-y-auto p-4 sm:max-w-md sm:p-6">
          <SheetHeader className="space-y-1 p-0 text-left">
            <SheetTitle>Video reply</SheetTitle>
            <SheetDescription>Upload a clip or paste a link.</SheetDescription>
          </SheetHeader>
          <Tabs value={tab} onValueChange={(v) => setTab(v as "upload" | "link")}>
            <TabsList className="w-full">
              <TabsTrigger value="upload" className="flex-1">Upload file</TabsTrigger>
              <TabsTrigger value="link" className="flex-1">Paste link</TabsTrigger>
            </TabsList>
            <TabsContent value="upload" className="pt-4">
              <Input type="file" accept="video/mp4"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </TabsContent>
            <TabsContent value="link" className="pt-4">
              <Input placeholder="YouTube / Vimeo / Drive URL"
                value={url} onChange={(e) => setUrl(e.target.value)} />
            </TabsContent>
          </Tabs>
          <Input placeholder="Caption (optional)"
            value={caption} onChange={(e) => setCaption(e.target.value)} />
          <Button type="button" onClick={submit} disabled={mutate.isPending}>
            {mutate.isPending ? "Posting…" : "Post reply"}
          </Button>
        </SheetContent>
      </Sheet>
    </>
  );
}
```

> If `UploadVideoForm` exposes a reusable inner field set or progress helper, prefer reusing it over the bare `Input type=file` for parity (mp4 validation, size limit messaging). Inspect it first; the above is the minimal correct version.

- [ ] **Step 2: Wire into `thread-view.tsx`**

Place `<VideoReplyComposer threadId={thread.id} anchorKind={anchorKind} anchorId={anchorId} campId={campId} />` next to the existing `ThreadComposer` reply box.

- [ ] **Step 3: Clip picker in `thread-composer.tsx`**

Give `ThreadComposer` an optional `videoReplies?: VideoReplyView[]` prop and an optional `onSubmit` that can carry a `ref`. When replies exist, render a small "refer to a clip" control: a select of the thread's replies (label by caption or "clip by <author>") plus an optional `mm:ss` text input. On submit, pass `{ videoId, tsSeconds }` up through `handleReply`. In `thread-view.tsx`, `handleReply` then calls `createComment.mutateAsync({ threadId, body, ref })`. Keep it optional so existing call sites (which pass no `videoReplies`) are unchanged.

Minimal control:

```tsx
{videoReplies && videoReplies.length > 0 && (
  <div className="flex items-center gap-2">
    <select value={refId ?? ""} onChange={(e) => setRefId(e.target.value ? Number(e.target.value) : null)}
      className="rounded border px-2 py-1 text-xs">
      <option value="">No clip reference</option>
      {videoReplies.filter((r) => r.video).map((r) => (
        <option key={r.id} value={r.id}>{r.caption ?? `clip by ${r.author_name}`}</option>
      ))}
    </select>
    {refId != null && (
      <Input className="h-7 w-20 text-xs" placeholder="m:ss"
        value={tsText} onChange={(e) => setTsText(e.target.value)} />
    )}
  </div>
)}
```

Parse `m:ss` (or plain seconds) into `tsSeconds` on submit; if empty leave null.

- [ ] **Step 4: Type-check + commit**

Run: `cd frontend && npx tsc --noEmit`

```bash
git add frontend/src/components/threads/
git commit -m "feat(threads): video reply composer and clip reference picker"
```

---

### Task 14: Frontend verify + manual smoke

- [ ] **Step 1: Type-check + build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 2: Manual smoke (use the `run` skill or `just` dev target)**

Verify end to end against a local instance:
1. Open a thread, post a video reply via upload and via link; both appear interleaved by time.
2. Post a text comment referencing the reply at a timestamp; the chip appears and seeks on click.
3. As a different student, confirm a private thread's reply clip is not reachable.
4. Confirm a reply clip shows no "start thread" / comment affordance.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix(threads): video reply UI smoke-test fixes"
```

---

## Self-review notes (for the implementer)

- **Spec coverage:** Req 1 (video replies) = Tasks 1,3,5,6,11,13. Req 2 (no thread on a reply clip) = already enforced server-side (CX-010 in `validate_anchor`) + UI suppression in Task 11. Req 3 (reference + timestamp) = Tasks 1,3,4,9,12,13. Caption-in-description = Tasks 3,6. New verb = Task 2. Security fix = Task 7. Empty title for replies = Task 6.
- **`VideoKind` variant name:** Task 6's test uses `VideoKind::Youtube`; confirm the exact variant in `crates/syllabus-tracker/src/models.rs` and adjust.
- **`Video` model fields:** Task 3 reads `v.description`, `v.created_at`, `v.uploaded_by_id`, `v.id`. Confirm these exist on the `Video` struct (they back the `videos` columns).
- **`VideoRow` comment suppression (Task 11) and `PlayerControllerProvider` presence (Task 12)** are the two frontend unknowns; both have a stated fallback. Read those components before writing, per the inline notes.
- **sqlx cache:** regenerate after Tasks 3, 4, 5, 7 (each adds/changes a macro query). The offline build is the gate.
