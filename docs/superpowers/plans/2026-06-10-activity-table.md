# Activity Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single append-only `activity` event log written inline from every live write path (PR 1), then a read side with per-viewer unread tracking, a redesigned coach dashboard, and a rebuilt student "recent activity" surface on top of it (PR 2).

**Architecture:** A new `db/activity.rs` leaf module owns the row shape (`NewActivity`), a code-side verb registry (verb -> primary entity column + `notifiable`), typed payload constructors, an `emit` helper that coalesces within a 30s window, and an `emit_fanout` helper plus affected-student resolvers. Every instrumented write path opens (or reuses) a transaction and calls `emit`/`emit_fanout` inside it so the activity row is atomic with the event. PR 2 adds `activity_cursors` + `activity_seen_overrides`, a keyset-paginated feed query, an `unread_count` query, cursor operations, and the frontend surfaces.

**Tech Stack:** Rust + Rocket + sqlx (SQLite, compile-time-checked queries, offline `.sqlx/` cache), declarative migration engine reconciling `config/schema.sql`, chrono, serde/serde_json. Frontend: Vite + React 19 + shadcn/ui + Tailwind v4 + TanStack Query + Vitest Browser Mode.

**Critical conventions (read before starting):**
- Schema changes: edit `config/schema.sql` only. `just migrate` reconciles a live DB; tests reconcile the same file declaratively via `SCHEMA_PATH`. There are no numbered migration files.
- After ANY change that adds or edits a `sqlx::query!` / `query_scalar!` / `query_as!`, run `just sqlx-prepare` and commit the regenerated `.sqlx/` in the SAME commit. `just sqlx-check` (part of `just verify`) fails CI otherwise.
- Per-commit gate (run `just verify`): `cargo build -p syllabus-tracker`, `cargo test -p syllabus-tracker`, `cargo sqlx prepare --check`, `pnpm -C frontend lint`, `pnpm -C frontend build`, `pnpm -C frontend test`.
- No em-dashes in any UI copy or comments (commas / periods / parens instead).
- DB module convention (`db/mod.rs`): one file per domain; composite writes own the outer transaction and fan out one-way to leaf modules; each submodule re-exports through `mod.rs`.
- Backend tests: `#[rocket::async_test]`, build a DB with `TestDbBuilder`, call db functions with `&db.pool`. See `crates/syllabus-tracker/src/test/pinned.rs` for the canonical shape.

---

## File Structure

**PR 1 creates:**
- `crates/syllabus-tracker/src/db/activity.rs` — the whole event-log write side: `Verb` enum + registry, `EntityKind`, `NewActivity`, payload constructor fns, `emit`, `emit_fanout`, `affected_students_for_technique`, `affected_students_for_syllabus`. One focused file; it is the only new module.
- `crates/syllabus-tracker/src/bin/backfill_activity.rs` — one-shot idempotent historical backfill.
- `crates/syllabus-tracker/src/test/activity.rs` — emit-site, fan-out, coalescing, and backfill tests.

**PR 1 modifies:**
- `config/schema.sql` — add `activity` table + 5 indexes.
- `crates/syllabus-tracker/src/db/mod.rs` — `mod activity; pub use activity::*;`.
- `crates/syllabus-tracker/src/test/mod.rs` — `mod activity;`.
- Emit sites: `db/pinned.rs`, `db/syllabus_attempts.rs`, `db/student_syllabus_techniques.rs`, `db/syllabus_assignments.rs`, `db/syllabi.rs`, `db/videos.rs`, `db/techniques.rs`, `db/watch.rs`.
- `justfile` — a `backfill-activity` recipe.

**PR 2 creates:**
- `crates/syllabus-tracker/src/db/activity_read.rs` — feed query, unread-count query, cursor operations, typed payload deserialization, the read-side `ActivityRow` shape.
- `crates/syllabus-tracker/src/bin/init_activity_cursors.rs` — one-shot cursor seeding at deploy.
- `crates/syllabus-tracker/src/test/activity_read.rs` — cursor/unread/feed/pagination tests.
- `frontend/src/lib/activity-line.ts(x)` — the shared per-verb renderer (verb + joined names + payload -> display line).
- `frontend/src/lib/activity-line.test.tsx` — renderer unit tests.

**PR 2 modifies:**
- `config/schema.sql` — add `activity_cursors` + `activity_seen_overrides` tables + index.
- `crates/syllabus-tracker/src/db/mod.rs`, `src/test/mod.rs` — register the new modules.
- `crates/syllabus-tracker/src/api.rs` — feed / unread-count / mark routes; coach dashboard read swap.
- Frontend dashboard + student recent-activity components, query keys, queries, mutations, navbar badge.

---

# PR 1: Activity event log

## Task 1: Create the `activity` table

**Files:**
- Modify: `config/schema.sql` (append after the `student_syllabus_video_visibility` block, before the `_litestream_lock` line)

- [ ] **Step 1: Add the table and indexes to `config/schema.sql`**

Insert this block immediately before the `CREATE TABLE IF NOT EXISTS _litestream_lock` line:

```sql
CREATE TABLE IF NOT EXISTS activity (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    occurred_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    verb              TEXT    NOT NULL,
    actor_user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_student_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    technique_id      INTEGER REFERENCES techniques(id) ON DELETE SET NULL,
    syllabus_id       INTEGER REFERENCES syllabi(id)    ON DELETE SET NULL,
    sst_id            INTEGER REFERENCES student_syllabus_techniques(id) ON DELETE SET NULL,
    video_id          INTEGER REFERENCES videos(id)     ON DELETE SET NULL,
    payload_json      TEXT
);

CREATE INDEX IF NOT EXISTS idx_activity_student
    ON activity (target_student_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_activity_syllabus
    ON activity (syllabus_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_activity_technique
    ON activity (technique_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_activity_recent
    ON activity (occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_activity_coalesce
    ON activity (actor_user_id, verb, occurred_at DESC);
```

Note the FK target is `syllabi` (the table was renamed from `syllabuses`; confirm with `grep "CREATE TABLE IF NOT EXISTS syllabi" config/schema.sql`).

- [ ] **Step 2: Apply the schema to the local dev DB**

Run: `just migrate`
Expected: completes without error; the engine reports adding the `activity` table.

- [ ] **Step 3: Verify the table exists**

Run: `sqlite3 data/sqlite.db ".schema activity"`
Expected: prints the `CREATE TABLE activity` statement and the five indexes.

- [ ] **Step 4: Commit**

```bash
git add config/schema.sql
git commit -m "feat(activity): add activity event-log table and indexes"
```

---

## Task 2: Verb registry (enum + static metadata)

**Files:**
- Create: `crates/syllabus-tracker/src/db/activity.rs`
- Modify: `crates/syllabus-tracker/src/db/mod.rs`

- [ ] **Step 1: Write the failing test**

Create `crates/syllabus-tracker/src/db/activity.rs` with only the test module for now:

```rust
//! Activity event-log write side. Owns the row shape, the code-side verb
//! registry (verb -> primary entity column + notifiable flag), typed payload
//! constructors, and the `emit` / `emit_fanout` helpers. Every live write path
//! calls into here inside its own transaction so the activity row is atomic
//! with the event it records. This module never deserialises payloads; the
//! typed read side lands in PR 2 (`db/activity_read.rs`).

#[cfg(test)]
mod registry_tests {
    use super::{EntityKind, Verb};

    #[test]
    fn verb_str_roundtrips() {
        for verb in Verb::ALL {
            assert_eq!(Verb::from_str_verb(verb.as_str()), Some(verb));
        }
    }

    #[test]
    fn non_notifiable_set_is_exact() {
        let non_notifiable: Vec<&str> = Verb::ALL
            .iter()
            .filter(|v| !v.notifiable())
            .map(|v| v.as_str())
            .collect();
        let mut got = non_notifiable.clone();
        got.sort_unstable();
        let mut want = vec![
            "attempt_deleted",
            "technique_unpinned",
            "syllabus_unassigned",
            "sst_hidden",
            "sst_unhidden",
            "syllabus_technique_removed",
            "video_visibility_set",
        ];
        want.sort_unstable();
        assert_eq!(got, want);
    }

    #[test]
    fn primary_entity_for_sst_verbs_is_sst() {
        assert_eq!(Verb::SstStatusChanged.primary_entity(), EntityKind::Sst);
        assert_eq!(Verb::AttemptLogged.primary_entity(), EntityKind::Sst);
    }

    #[test]
    fn primary_entity_for_fanout_verbs() {
        assert_eq!(
            Verb::SyllabusTechniqueAdded.primary_entity(),
            EntityKind::Syllabus
        );
        assert_eq!(Verb::TechniqueEdited.primary_entity(), EntityKind::Technique);
        assert_eq!(Verb::VideoAdded.primary_entity(), EntityKind::Video);
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p syllabus-tracker --lib db::activity::registry_tests`
Expected: FAIL to compile, `cannot find type Verb` / `EntityKind`.

- [ ] **Step 3: Implement the registry**

Add above the test module in `crates/syllabus-tracker/src/db/activity.rs`:

```rust
use chrono::{NaiveDateTime, Utc};
use serde::Serialize;
use serde_json::json;
use sqlx::{Sqlite, Transaction};

use crate::error::AppError;

/// Which real FK column a verb treats as its "primary entity" for coalescing.
/// The coalesce key is (actor_user_id, verb, <this column>, target_student_id).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntityKind {
    Technique,
    Syllabus,
    Sst,
    Video,
}

/// The activity verbs. Named `<target>_<past_tense>`. Each carries static
/// metadata (`notifiable`, `primary_entity`) read by the write side now and
/// the unread rule in PR 2. This is the registry; there is no DB column for it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verb {
    VideoWatched,
    AttemptLogged,
    AttemptEdited,
    AttemptDeleted,
    SstStatusChanged,
    SstStudentNotesEdited,
    SstCoachNotesEdited,
    TechniquePinned,
    TechniqueUnpinned,
    SyllabusAssigned,
    SyllabusUnassigned,
    SyllabusGraduated,
    SstAdded,
    SstHidden,
    SstUnhidden,
    SyllabusTechniqueAdded,
    SyllabusTechniqueRemoved,
    VideoAdded,
    VideoVisibilitySet,
    TechniqueEdited,
}

impl Verb {
    pub const ALL: [Verb; 20] = [
        Verb::VideoWatched,
        Verb::AttemptLogged,
        Verb::AttemptEdited,
        Verb::AttemptDeleted,
        Verb::SstStatusChanged,
        Verb::SstStudentNotesEdited,
        Verb::SstCoachNotesEdited,
        Verb::TechniquePinned,
        Verb::TechniqueUnpinned,
        Verb::SyllabusAssigned,
        Verb::SyllabusUnassigned,
        Verb::SyllabusGraduated,
        Verb::SstAdded,
        Verb::SstHidden,
        Verb::SstUnhidden,
        Verb::SyllabusTechniqueAdded,
        Verb::SyllabusTechniqueRemoved,
        Verb::VideoAdded,
        Verb::VideoVisibilitySet,
        Verb::TechniqueEdited,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Verb::VideoWatched => "video_watched",
            Verb::AttemptLogged => "attempt_logged",
            Verb::AttemptEdited => "attempt_edited",
            Verb::AttemptDeleted => "attempt_deleted",
            Verb::SstStatusChanged => "sst_status_changed",
            Verb::SstStudentNotesEdited => "sst_student_notes_edited",
            Verb::SstCoachNotesEdited => "sst_coach_notes_edited",
            Verb::TechniquePinned => "technique_pinned",
            Verb::TechniqueUnpinned => "technique_unpinned",
            Verb::SyllabusAssigned => "syllabus_assigned",
            Verb::SyllabusUnassigned => "syllabus_unassigned",
            Verb::SyllabusGraduated => "syllabus_graduated",
            Verb::SstAdded => "sst_added",
            Verb::SstHidden => "sst_hidden",
            Verb::SstUnhidden => "sst_unhidden",
            Verb::SyllabusTechniqueAdded => "syllabus_technique_added",
            Verb::SyllabusTechniqueRemoved => "syllabus_technique_removed",
            Verb::VideoAdded => "video_added",
            Verb::VideoVisibilitySet => "video_visibility_set",
            Verb::TechniqueEdited => "technique_edited",
        }
    }

    pub fn from_str_verb(s: &str) -> Option<Verb> {
        Verb::ALL.into_iter().find(|v| v.as_str() == s)
    }

    /// Whether a row of this verb can ever drive an unread badge. The
    /// delete / remove / hide / un-* verbs are history-only. Viewer-relative
    /// conditions are applied on the read side (PR 2).
    pub fn notifiable(self) -> bool {
        !matches!(
            self,
            Verb::AttemptDeleted
                | Verb::TechniqueUnpinned
                | Verb::SyllabusUnassigned
                | Verb::SstHidden
                | Verb::SstUnhidden
                | Verb::SyllabusTechniqueRemoved
                | Verb::VideoVisibilitySet
        )
    }

    /// The column the coalesce key uses to identify "the same thing happening
    /// again." sst_* verbs also denormalise technique_id / syllabus_id onto the
    /// row, but coalesce on the sst_id.
    pub fn primary_entity(self) -> EntityKind {
        match self {
            Verb::VideoWatched | Verb::VideoAdded | Verb::VideoVisibilitySet => EntityKind::Video,
            Verb::AttemptLogged
            | Verb::AttemptEdited
            | Verb::AttemptDeleted
            | Verb::SstStatusChanged
            | Verb::SstStudentNotesEdited
            | Verb::SstCoachNotesEdited
            | Verb::SstAdded
            | Verb::SstHidden
            | Verb::SstUnhidden => EntityKind::Sst,
            Verb::TechniquePinned | Verb::TechniqueUnpinned | Verb::TechniqueEdited => {
                EntityKind::Technique
            }
            Verb::SyllabusAssigned
            | Verb::SyllabusUnassigned
            | Verb::SyllabusGraduated
            | Verb::SyllabusTechniqueAdded
            | Verb::SyllabusTechniqueRemoved => EntityKind::Syllabus,
        }
    }
}
```

- [ ] **Step 4: Register the module**

In `crates/syllabus-tracker/src/db/mod.rs`, add `mod activity;` (alphabetical, before `mod attempts;`) and `pub use activity::*;` (before `pub use attempts::*;`).

- [ ] **Step 5: Run the test to verify it passes**

Run: `cargo test -p syllabus-tracker --lib db::activity::registry_tests`
Expected: PASS (4 tests). Warnings about unused imports (`NaiveDateTime`, `Utc`, `Serialize`, `json`, sqlx types, `AppError`) are fine; the next tasks use them.

- [ ] **Step 6: Commit**

```bash
git add crates/syllabus-tracker/src/db/activity.rs crates/syllabus-tracker/src/db/mod.rs
git commit -m "feat(activity): add verb registry with notifiable + primary-entity metadata"
```

---

## Task 3: `NewActivity` struct and typed payload constructors

**Files:**
- Modify: `crates/syllabus-tracker/src/db/activity.rs`

- [ ] **Step 1: Write the failing test**

Add a second test module at the bottom of `activity.rs`:

```rust
#[cfg(test)]
mod payload_tests {
    use super::{payload, NewActivity, Verb};

    #[test]
    fn status_change_payload_shape() {
        let p = payload::status_changed("red", "green");
        let v: serde_json::Value = serde_json::from_str(&p).unwrap();
        assert_eq!(v["from"], "red");
        assert_eq!(v["to"], "green");
    }

    #[test]
    fn video_watched_payload_shape() {
        let p = payload::video_watched(12, 60);
        let v: serde_json::Value = serde_json::from_str(&p).unwrap();
        assert_eq!(v["cumulative_seconds"], 12);
        assert_eq!(v["duration_seconds"], 60);
    }

    #[test]
    fn new_activity_builder_defaults_entities_to_none() {
        let ev = NewActivity::new(Verb::TechniquePinned, 7).target_student(7).technique(3);
        assert_eq!(ev.actor_user_id, 7);
        assert_eq!(ev.target_student_id, Some(7));
        assert_eq!(ev.technique_id, Some(3));
        assert_eq!(ev.syllabus_id, None);
        assert_eq!(ev.sst_id, None);
        assert_eq!(ev.video_id, None);
        assert!(ev.payload_json.is_none());
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p syllabus-tracker --lib db::activity::payload_tests`
Expected: FAIL to compile, `cannot find ... NewActivity` / `payload`.

- [ ] **Step 3: Implement `NewActivity` and the `payload` module**

Add to `activity.rs` (after the `impl Verb` block):

```rust
/// A row to be written to `activity`. Built with the fluent setters; entity
/// ids default to None. `occurred_at` is server-set inside `emit`.
#[derive(Debug, Clone)]
pub struct NewActivity {
    pub verb: Verb,
    pub actor_user_id: i64,
    pub target_student_id: Option<i64>,
    pub technique_id: Option<i64>,
    pub syllabus_id: Option<i64>,
    pub sst_id: Option<i64>,
    pub video_id: Option<i64>,
    pub payload_json: Option<String>,
}

impl NewActivity {
    pub fn new(verb: Verb, actor_user_id: i64) -> Self {
        NewActivity {
            verb,
            actor_user_id,
            target_student_id: None,
            technique_id: None,
            syllabus_id: None,
            sst_id: None,
            video_id: None,
            payload_json: None,
        }
    }

    pub fn target_student(mut self, id: i64) -> Self {
        self.target_student_id = Some(id);
        self
    }
    pub fn technique(mut self, id: i64) -> Self {
        self.technique_id = Some(id);
        self
    }
    pub fn syllabus(mut self, id: i64) -> Self {
        self.syllabus_id = Some(id);
        self
    }
    pub fn sst(mut self, id: i64) -> Self {
        self.sst_id = Some(id);
        self
    }
    pub fn video(mut self, id: i64) -> Self {
        self.video_id = Some(id);
        self
    }
    pub fn payload(mut self, json: String) -> Self {
        self.payload_json = Some(json);
        self
    }

    /// The value of the primary-entity column for this row, used by coalescing.
    pub(crate) fn primary_entity_id(&self) -> Option<i64> {
        match self.verb.primary_entity() {
            EntityKind::Technique => self.technique_id,
            EntityKind::Syllabus => self.syllabus_id,
            EntityKind::Sst => self.sst_id,
            EntityKind::Video => self.video_id,
        }
    }
}

/// Typed per-verb payload constructors. Each returns serialised JSON text.
/// PR 1 only writes these; the typed read side deserialises them in PR 2.
pub mod payload {
    use serde_json::json;

    pub fn video_watched(cumulative_seconds: i64, duration_seconds: i64) -> String {
        json!({
            "cumulative_seconds": cumulative_seconds,
            "duration_seconds": duration_seconds
        })
        .to_string()
    }

    pub fn status_changed(from: &str, to: &str) -> String {
        json!({ "from": from, "to": to }).to_string()
    }

    pub fn video_visibility_set(scope: &str, visible: bool) -> String {
        json!({ "scope": scope, "visible": visible }).to_string()
    }

    pub fn attempt_pointer(attempt_id: i64) -> String {
        json!({ "attempt_id": attempt_id }).to_string()
    }

    /// `technique_edited` delta. Pass which fields changed; tags carry the
    /// added / removed name lists.
    pub fn technique_edited(
        name_changed: bool,
        description_changed: bool,
        tags_added: &[String],
        tags_removed: &[String],
    ) -> String {
        let mut fields = serde_json::Map::new();
        if name_changed {
            fields.insert("name".into(), json!(true));
        }
        if description_changed {
            fields.insert("description".into(), json!(true));
        }
        if !tags_added.is_empty() || !tags_removed.is_empty() {
            fields.insert(
                "tags".into(),
                json!({ "added": tags_added, "removed": tags_removed }),
            );
        }
        json!({ "fields": fields }).to_string()
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test -p syllabus-tracker --lib db::activity::payload_tests`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add crates/syllabus-tracker/src/db/activity.rs
git commit -m "feat(activity): add NewActivity builder and typed payload constructors"
```

---

## Task 4: `emit` (plain insert, no coalescing yet)

**Files:**
- Modify: `crates/syllabus-tracker/src/db/activity.rs`
- Create: `crates/syllabus-tracker/src/test/activity.rs`
- Modify: `crates/syllabus-tracker/src/test/mod.rs`

- [ ] **Step 1: Write the failing test**

Create `crates/syllabus-tracker/src/test/activity.rs`:

```rust
#[cfg(test)]
mod tests {
    use crate::db::activity::{emit, NewActivity, Verb};
    use crate::test::test_utils::TestDbBuilder;

    #[rocket::async_test]
    async fn emit_inserts_one_row() {
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();

        let mut tx = db.pool.begin().await.unwrap();
        emit(
            &mut tx,
            NewActivity::new(Verb::SyllabusAssigned, coach).target_student(alice),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let row = sqlx::query!(
            r#"SELECT verb AS "verb!: String",
                      actor_user_id AS "actor_user_id!: i64",
                      target_student_id AS "target_student_id?: i64"
               FROM activity"#
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(row.verb, "syllabus_assigned");
        assert_eq!(row.actor_user_id, coach);
        assert_eq!(row.target_student_id, Some(alice));
    }
}
```

Register it: in `crates/syllabus-tracker/src/test/mod.rs` add `mod activity;` (alphabetical).

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p syllabus-tracker --lib test::activity`
Expected: FAIL to compile, `cannot find function emit`.

- [ ] **Step 3: Implement `emit` (insert only)**

Add to `activity.rs`:

```rust
/// 30-second coalescing window (see Task 5). Constant, tunable later.
const COALESCE_WINDOW_SECS: i64 = 30;

/// Insert (or coalesce, Task 5) an activity row inside the caller's
/// transaction. Atomic with the event being recorded.
pub async fn emit(
    tx: &mut Transaction<'_, Sqlite>,
    ev: NewActivity,
) -> Result<(), AppError> {
    let now = Utc::now().naive_utc();
    let verb = ev.verb.as_str();
    sqlx::query!(
        "INSERT INTO activity
            (occurred_at, verb, actor_user_id, target_student_id,
             technique_id, syllabus_id, sst_id, video_id, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        now,
        verb,
        ev.actor_user_id,
        ev.target_student_id,
        ev.technique_id,
        ev.syllabus_id,
        ev.sst_id,
        ev.video_id,
        ev.payload_json,
    )
    .execute(&mut **tx)
    .await?;
    Ok(())
}
```

(`COALESCE_WINDOW_SECS` is unused until Task 5; add `#[allow(dead_code)]` above it for this commit only, removed in Task 5.)

- [ ] **Step 4: Regenerate the sqlx cache**

Run: `just sqlx-prepare`
Expected: writes new files under `.sqlx/` for the INSERT and the test SELECT.

- [ ] **Step 5: Run to verify it passes**

Run: `cargo test -p syllabus-tracker --lib test::activity`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/syllabus-tracker/src/db/activity.rs crates/syllabus-tracker/src/test/activity.rs crates/syllabus-tracker/src/test/mod.rs .sqlx/
git commit -m "feat(activity): add emit helper that inserts an activity row in-tx"
```

---

## Task 5: Coalescing inside `emit`

**Files:**
- Modify: `crates/syllabus-tracker/src/db/activity.rs`
- Modify: `crates/syllabus-tracker/src/test/activity.rs`

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module in `test/activity.rs`:

```rust
    #[rocket::async_test]
    async fn two_same_key_emits_within_window_coalesce_to_one_row() {
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .technique("Armbar", "", Some("coach"))
            .build()
            .await
            .unwrap();
        let alice = db.user_id("alice").unwrap();
        let armbar = db.technique_id("Armbar").unwrap();

        for _ in 0..2 {
            let mut tx = db.pool.begin().await.unwrap();
            emit(
                &mut tx,
                NewActivity::new(Verb::TechniquePinned, alice)
                    .target_student(alice)
                    .technique(armbar),
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();
        }

        let count = sqlx::query_scalar!(r#"SELECT COUNT(*) AS "c!: i64" FROM activity"#)
            .fetch_one(&db.pool)
            .await
            .unwrap();
        assert_eq!(count, 1, "same-key emits within 30s coalesce");
    }

    #[rocket::async_test]
    async fn different_target_does_not_coalesce() {
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .student("bob", None)
            .technique("Armbar", "", Some("coach"))
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();
        let bob = db.user_id("bob").unwrap();
        let armbar = db.technique_id("Armbar").unwrap();

        for student in [alice, bob] {
            let mut tx = db.pool.begin().await.unwrap();
            emit(
                &mut tx,
                NewActivity::new(Verb::TechniqueEdited, coach)
                    .target_student(student)
                    .technique(armbar),
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();
        }

        let count = sqlx::query_scalar!(r#"SELECT COUNT(*) AS "c!: i64" FROM activity"#)
            .fetch_one(&db.pool)
            .await
            .unwrap();
        assert_eq!(count, 2, "different target_student_id does not coalesce");
    }

    #[rocket::async_test]
    async fn status_change_coalesce_keeps_original_from_takes_latest_to() {
        use crate::db::activity::payload;
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .technique("Armbar", "", Some("coach"))
            .build()
            .await
            .unwrap();
        let alice = db.user_id("alice").unwrap();

        // Seed an SST to reference. Minimal direct insert: a syllabus + assignment + sst.
        let coach = db.user_id("coach").unwrap();
        let sid = crate::db::create_syllabus(&db.pool, "S", None, coach).await.unwrap();
        let aid = crate::db::assign(&db.pool, coach, alice, sid).await.unwrap();
        let armbar = db.technique_id("Armbar").unwrap();
        let sst_id = crate::db::add_technique_to_assignment(&db.pool, aid, armbar)
            .await
            .unwrap();

        for (from, to) in [("red", "amber"), ("amber", "green")] {
            let mut tx = db.pool.begin().await.unwrap();
            emit(
                &mut tx,
                NewActivity::new(Verb::SstStatusChanged, alice)
                    .target_student(alice)
                    .sst(sst_id)
                    .payload(payload::status_changed(from, to)),
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();
        }

        let row = sqlx::query!(
            r#"SELECT payload_json FROM activity WHERE verb = 'sst_status_changed'"#
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        let v: serde_json::Value = serde_json::from_str(&row.payload_json.unwrap()).unwrap();
        assert_eq!(v["from"], "red", "keeps original from");
        assert_eq!(v["to"], "green", "takes latest to");
    }
```

Note: `add_technique_to_assignment` will itself emit `sst_added` after Task 9; that is fine, the assertions filter by verb. If executing this task before Task 9, the helper does not emit yet.

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p syllabus-tracker --lib test::activity::tests::two_same_key`
Expected: FAIL (count is 2, expected 1).

- [ ] **Step 3: Implement coalescing in `emit`**

Replace the body of `emit` with a coalesce-then-insert. Remove the `#[allow(dead_code)]` from `COALESCE_WINDOW_SECS`.

```rust
pub async fn emit(
    tx: &mut Transaction<'_, Sqlite>,
    ev: NewActivity,
) -> Result<(), AppError> {
    let now = Utc::now().naive_utc();
    let window_start = now - chrono::Duration::seconds(COALESCE_WINDOW_SECS);
    let verb = ev.verb.as_str();

    // Find the most recent same-key row within the window. The key is
    // (actor, verb, primary entity col, target_student_id). The primary entity
    // column varies by verb, so branch on its kind.
    let existing_id = find_coalesce_target(tx, &ev, verb, window_start).await?;

    if let Some(id) = existing_id {
        // Merge: bump occurred_at, and for sst_status_changed keep the original
        // `from` while taking the new `to`.
        let merged_payload = merge_payload(tx, id, &ev).await?;
        sqlx::query!(
            "UPDATE activity SET occurred_at = ?, payload_json = ? WHERE id = ?",
            now,
            merged_payload,
            id,
        )
        .execute(&mut **tx)
        .await?;
        return Ok(());
    }

    sqlx::query!(
        "INSERT INTO activity
            (occurred_at, verb, actor_user_id, target_student_id,
             technique_id, syllabus_id, sst_id, video_id, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        now,
        verb,
        ev.actor_user_id,
        ev.target_student_id,
        ev.technique_id,
        ev.syllabus_id,
        ev.sst_id,
        ev.video_id,
        ev.payload_json,
    )
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Look up a coalesce target. SQLite NULL never equals NULL, so the
/// target_student_id match is written as `(target_student_id IS ? OR
/// target_student_id = ?)` collapsed via `IS`. We pass the value twice and use
/// `IS` semantics by comparing with `coalesce`-safe predicates per branch.
async fn find_coalesce_target(
    tx: &mut Transaction<'_, Sqlite>,
    ev: &NewActivity,
    verb: &str,
    window_start: NaiveDateTime,
) -> Result<Option<i64>, AppError> {
    let entity_id = match ev.primary_entity_id() {
        Some(id) => id,
        // No primary entity value (should not happen for real verbs); never
        // coalesce.
        None => return Ok(None),
    };
    let target = ev.target_student_id;
    let id = match ev.verb.primary_entity() {
        EntityKind::Technique => {
            sqlx::query_scalar!(
                r#"SELECT id AS "id!: i64" FROM activity
                   WHERE actor_user_id = ? AND verb = ? AND occurred_at >= ?
                     AND technique_id = ?
                     AND target_student_id IS ?
                   ORDER BY occurred_at DESC, id DESC LIMIT 1"#,
                ev.actor_user_id, verb, window_start, entity_id, target,
            )
            .fetch_optional(&mut **tx)
            .await?
        }
        EntityKind::Syllabus => {
            sqlx::query_scalar!(
                r#"SELECT id AS "id!: i64" FROM activity
                   WHERE actor_user_id = ? AND verb = ? AND occurred_at >= ?
                     AND syllabus_id = ?
                     AND target_student_id IS ?
                   ORDER BY occurred_at DESC, id DESC LIMIT 1"#,
                ev.actor_user_id, verb, window_start, entity_id, target,
            )
            .fetch_optional(&mut **tx)
            .await?
        }
        EntityKind::Sst => {
            sqlx::query_scalar!(
                r#"SELECT id AS "id!: i64" FROM activity
                   WHERE actor_user_id = ? AND verb = ? AND occurred_at >= ?
                     AND sst_id = ?
                     AND target_student_id IS ?
                   ORDER BY occurred_at DESC, id DESC LIMIT 1"#,
                ev.actor_user_id, verb, window_start, entity_id, target,
            )
            .fetch_optional(&mut **tx)
            .await?
        }
        EntityKind::Video => {
            sqlx::query_scalar!(
                r#"SELECT id AS "id!: i64" FROM activity
                   WHERE actor_user_id = ? AND verb = ? AND occurred_at >= ?
                     AND video_id = ?
                     AND target_student_id IS ?
                   ORDER BY occurred_at DESC, id DESC LIMIT 1"#,
                ev.actor_user_id, verb, window_start, entity_id, target,
            )
            .fetch_optional(&mut **tx)
            .await?
        }
    };
    Ok(id)
}

/// For sst_status_changed, keep the existing row's `from` and take the new
/// `to`. All other verbs take the new payload as-is.
async fn merge_payload(
    tx: &mut Transaction<'_, Sqlite>,
    existing_id: i64,
    ev: &NewActivity,
) -> Result<Option<String>, AppError> {
    if ev.verb != Verb::SstStatusChanged {
        return Ok(ev.payload_json.clone());
    }
    let existing = sqlx::query_scalar!(
        r#"SELECT payload_json FROM activity WHERE id = ?"#,
        existing_id
    )
    .fetch_one(&mut **tx)
    .await?;
    let (Some(old), Some(new)) = (existing, ev.payload_json.as_ref()) else {
        return Ok(ev.payload_json.clone());
    };
    let old_v: serde_json::Value = serde_json::from_str(&old).unwrap_or(json!({}));
    let new_v: serde_json::Value = serde_json::from_str(new).unwrap_or(json!({}));
    Ok(Some(
        json!({ "from": old_v["from"], "to": new_v["to"] }).to_string(),
    ))
}
```

- [ ] **Step 4: Regenerate the sqlx cache**

Run: `just sqlx-prepare`

- [ ] **Step 5: Run to verify it passes**

Run: `cargo test -p syllabus-tracker --lib test::activity`
Expected: PASS (all coalescing tests green).

- [ ] **Step 6: Commit**

```bash
git add crates/syllabus-tracker/src/db/activity.rs crates/syllabus-tracker/src/test/activity.rs .sqlx/
git commit -m "feat(activity): coalesce same-key emits within a 30s window"
```

---

## Task 6: `emit_fanout` and affected-student resolvers

**Files:**
- Modify: `crates/syllabus-tracker/src/db/activity.rs`
- Modify: `crates/syllabus-tracker/src/test/activity.rs`

- [ ] **Step 1: Write the failing test**

Add to `test/activity.rs`:

```rust
    #[rocket::async_test]
    async fn fanout_writes_one_row_per_active_assignment_for_syllabus() {
        use crate::db::activity::{emit_fanout, affected_students_for_syllabus, NewActivity, Verb};
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .student("bob", None)
            .technique("Armbar", "", Some("coach"))
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();
        let bob = db.user_id("bob").unwrap();
        let armbar = db.technique_id("Armbar").unwrap();

        let sid = crate::db::create_syllabus(&db.pool, "S", None, coach).await.unwrap();
        crate::db::add_technique_to_syllabus(
            &db.pool, sid, armbar, coach, crate::db::PropagationMode::SyllabusOnly,
        )
        .await
        .unwrap();
        crate::db::assign(&db.pool, coach, alice, sid).await.unwrap();
        crate::db::assign(&db.pool, coach, bob, sid).await.unwrap();

        let mut tx = db.pool.begin().await.unwrap();
        let affected = affected_students_for_syllabus(&mut tx, sid).await.unwrap();
        emit_fanout(
            &mut tx,
            NewActivity::new(Verb::SyllabusTechniqueAdded, coach).syllabus(sid),
            &affected,
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let rows = sqlx::query!(
            r#"SELECT target_student_id AS "t?: i64" FROM activity
               WHERE verb = 'syllabus_technique_added' ORDER BY target_student_id"#
        )
        .fetch_all(&db.pool)
        .await
        .unwrap();
        let targets: Vec<Option<i64>> = rows.into_iter().map(|r| r.t).collect();
        assert_eq!(targets, vec![Some(alice), Some(bob)]);
    }

    #[rocket::async_test]
    async fn fanout_empty_set_writes_one_coach_only_null_row() {
        use crate::db::activity::{emit_fanout, NewActivity, Verb};
        let db = TestDbBuilder::new().coach("coach", None).build().await.unwrap();
        let coach = db.user_id("coach").unwrap();

        let mut tx = db.pool.begin().await.unwrap();
        emit_fanout(
            &mut tx,
            NewActivity::new(Verb::SyllabusTechniqueAdded, coach).syllabus(1),
            &[],
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let row = sqlx::query!(
            r#"SELECT target_student_id AS "t?: i64" FROM activity"#
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(row.t, None, "empty fan-out writes a single coach-only row");
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p syllabus-tracker --lib test::activity::tests::fanout`
Expected: FAIL to compile, missing `emit_fanout` / `affected_students_for_syllabus`.

- [ ] **Step 3: Implement fan-out and resolvers**

Add to `activity.rs`:

```rust
/// Write one activity row per affected student, reusing `ev` as a template
/// (its `target_student_id` is overwritten per student). Each per-student row
/// coalesces independently. If `affected` is empty, write a single coach-only
/// row with `target_student_id = NULL` so the coach view still records it.
pub async fn emit_fanout(
    tx: &mut Transaction<'_, Sqlite>,
    ev: NewActivity,
    affected: &[i64],
) -> Result<(), AppError> {
    if affected.is_empty() {
        let mut coach_only = ev;
        coach_only.target_student_id = None;
        return emit(tx, coach_only).await;
    }
    for &student_id in affected {
        let mut row = ev.clone();
        row.target_student_id = Some(student_id);
        emit(tx, row).await?;
    }
    Ok(())
}

/// Students with an active (unassigned_at IS NULL) assignment to this syllabus.
pub async fn affected_students_for_syllabus(
    tx: &mut Transaction<'_, Sqlite>,
    syllabus_id: i64,
) -> Result<Vec<i64>, AppError> {
    let ids = sqlx::query_scalar!(
        r#"SELECT DISTINCT student_id AS "id!: i64"
           FROM syllabus_assignments
           WHERE syllabus_id = ? AND unassigned_at IS NULL
           ORDER BY student_id"#,
        syllabus_id,
    )
    .fetch_all(&mut **tx)
    .await?;
    Ok(ids)
}

/// Union of {students with this technique in an active assigned syllabus} and
/// {students who pinned this technique}.
pub async fn affected_students_for_technique(
    tx: &mut Transaction<'_, Sqlite>,
    technique_id: i64,
) -> Result<Vec<i64>, AppError> {
    let ids = sqlx::query_scalar!(
        r#"SELECT student_id AS "id!: i64" FROM (
               SELECT a.student_id
               FROM syllabus_assignments a
               JOIN student_syllabus_techniques sst ON sst.assignment_id = a.id
               WHERE a.unassigned_at IS NULL
                 AND sst.technique_id = ?
                 AND sst.hidden_at IS NULL
               UNION
               SELECT student_id
               FROM student_pinned_techniques
               WHERE technique_id = ?
           )
           ORDER BY student_id"#,
        technique_id,
        technique_id,
    )
    .fetch_all(&mut **tx)
    .await?;
    Ok(ids)
}
```

- [ ] **Step 4: Regenerate the sqlx cache**

Run: `just sqlx-prepare`

- [ ] **Step 5: Run to verify it passes**

Run: `cargo test -p syllabus-tracker --lib test::activity`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/syllabus-tracker/src/db/activity.rs crates/syllabus-tracker/src/test/activity.rs .sqlx/
git commit -m "feat(activity): add emit_fanout and affected-student resolvers"
```

---

## Emit-site wiring — the standard pattern

Tasks 7-16 wire `emit` / `emit_fanout` into each live write path. Two shapes recur:

**Shape A — function already owns a `tx`** (`assign`, `add_technique_to_syllabus`, `remove_technique_from_syllabus`, `add_technique_to_assignment`, `ingest_watch_events`): add the `emit` call after the last write and before `tx.commit()`. Pull any ids you need (e.g. `target_student_id`) from values already in scope or a `query_scalar!` against `&mut *tx`.

**Shape B — function takes `&Pool` and runs single statements** (`pin_technique`, `unpin_technique`, `create_syllabus_attempt`, `update_sst`, `set_hidden`, `unassign`, `graduate`, `create_external_video`/`create_processing_video`, `set_video_hidden_globally`, `set_video_syllabus_visibility`, `update_technique`): convert it to open a transaction. The mechanical transform is:

```rust
// before
sqlx::query!(...).execute(pool).await?;
Ok(())

// after
let mut tx = pool.begin().await?;
sqlx::query!(...).execute(&mut *tx).await?;
emit(&mut tx, NewActivity::new(Verb::X, actor_id) /* ...setters... */).await?;
tx.commit().await?;
Ok(())
```

Each task below states the exact `NewActivity` to build and any extra lookups. Add `use crate::db::activity::{emit, NewActivity, Verb};` (and `emit_fanout`, `payload`, resolvers where used) to each module's imports. After every task: `just sqlx-prepare` if queries changed, then `cargo test -p syllabus-tracker`, then commit including `.sqlx/`.

---

## Task 7: Pinned techniques emit

**Files:**
- Modify: `crates/syllabus-tracker/src/db/pinned.rs:125-157`
- Modify: `crates/syllabus-tracker/src/test/activity.rs`

- [ ] **Step 1: Write the failing test** — add to `test/activity.rs`:

```rust
    #[rocket::async_test]
    async fn pin_emits_technique_pinned() {
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .technique("Armbar", "", Some("coach"))
            .build()
            .await
            .unwrap();
        let alice = db.user_id("alice").unwrap();
        let armbar = db.technique_id("Armbar").unwrap();

        crate::db::pin_technique(&db.pool, alice, armbar).await.unwrap();

        let row = sqlx::query!(
            r#"SELECT verb AS "v!: String", actor_user_id AS "a!: i64",
                      target_student_id AS "t?: i64", technique_id AS "tech?: i64"
               FROM activity"#
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(row.v, "technique_pinned");
        assert_eq!(row.a, alice);
        assert_eq!(row.t, Some(alice));
        assert_eq!(row.tech, Some(armbar));
    }
```

- [ ] **Step 2: Run to verify it fails** — `cargo test -p syllabus-tracker --lib test::activity::tests::pin_emits` → FAIL (no row).

- [ ] **Step 3: Implement.** Convert `pin_technique` (Shape B). The actor is the student (students pin for themselves). Build:

```rust
emit(
    &mut tx,
    NewActivity::new(Verb::TechniquePinned, student_id)
        .target_student(student_id)
        .technique(technique_id),
)
.await?;
```

Convert `unpin_technique` the same way with `Verb::TechniqueUnpinned`. Keep the `INSERT OR IGNORE` / `DELETE` on `&mut *tx`.

- [ ] **Step 4:** `just sqlx-prepare`
- [ ] **Step 5:** `cargo test -p syllabus-tracker --lib test::activity::tests::pin_emits` → PASS
- [ ] **Step 6: Commit**

```bash
git add crates/syllabus-tracker/src/db/pinned.rs crates/syllabus-tracker/src/test/activity.rs .sqlx/
git commit -m "feat(activity): emit technique_pinned / technique_unpinned"
```

---

## Task 8: Syllabus-attempt emit (logged / edited / deleted)

**Files:**
- Modify: `crates/syllabus-tracker/src/db/syllabus_attempts.rs` (`create_syllabus_attempt`, `update_syllabus_attempt`, `delete_syllabus_attempt`)
- Modify: `crates/syllabus-tracker/src/test/activity.rs`

The sst_* / attempt rows must denormalise `technique_id` and `syllabus_id`. Inside each function, resolve them from the sst id via:

```rust
let owner = sqlx::query!(
    r#"SELECT a.student_id AS "student_id!: i64",
              a.syllabus_id AS "syllabus_id!: i64",
              sst.technique_id AS "technique_id!: i64"
       FROM student_syllabus_techniques sst
       JOIN syllabus_assignments a ON a.id = sst.assignment_id
       WHERE sst.id = ?"#,
    sst_id,
)
.fetch_one(&mut *tx)
.await?;
```

- [ ] **Step 1: Write the failing test** — add `attempt_log_emits_attempt_logged` asserting that after `create_syllabus_attempt`, an `attempt_logged` row exists with `sst_id`, denormalised `technique_id`/`syllabus_id`, `target_student_id = student`, and `payload_json` containing `attempt_id`. (Build the SST via `create_syllabus / assign / add_technique_to_assignment` as in Task 5.)

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement.**

`create_syllabus_attempt` (Shape B): wrap in tx, keep the INSERT on `&mut *tx`, capture `let attempt_id = res.last_insert_rowid();`, resolve owner, then:

```rust
emit(
    &mut tx,
    NewActivity::new(Verb::AttemptLogged, actor.id)
        .target_student(owner.student_id)
        .sst(sst_id)
        .technique(owner.technique_id)
        .syllabus(owner.syllabus_id)
        .payload(payload::attempt_pointer(attempt_id)),
)
.await?;
```

`update_syllabus_attempt` (Shape B): the attempt id maps to its sst via `get_syllabus_attempt_sst_id`-style lookup; resolve sst then owner inside the tx. Emit `Verb::AttemptEdited` with the same fields and `payload::attempt_pointer(attempt_id)`. `actor.id` is the editor.

`delete_syllabus_attempt` (Shape B): resolve sst + owner BEFORE the DELETE (the row is about to vanish). Emit `Verb::AttemptDeleted` (non-notifiable) with `sst`, `technique`, `syllabus`, `target_student`, and `payload::attempt_pointer(attempt_id)`. Note: `delete_syllabus_attempt` currently takes only `(pool, attempt_id)`; add an `actor: &User` parameter and update the single call site in `api.rs` (find with `grep -n delete_syllabus_attempt crates/syllabus-tracker/src/api.rs`).

- [ ] **Step 4:** `just sqlx-prepare`
- [ ] **Step 5:** `cargo test -p syllabus-tracker` → PASS
- [ ] **Step 6: Commit**

```bash
git add crates/syllabus-tracker/src/db/syllabus_attempts.rs crates/syllabus-tracker/src/api.rs crates/syllabus-tracker/src/test/activity.rs .sqlx/
git commit -m "feat(activity): emit attempt_logged / attempt_edited / attempt_deleted"
```

---

## Task 9: SST update + curation emit (status / notes / hidden / added)

**Files:**
- Modify: `crates/syllabus-tracker/src/db/student_syllabus_techniques.rs` (`update_sst`, `set_hidden`, `add_technique_to_assignment`)
- Modify: `crates/syllabus-tracker/src/test/activity.rs`

`update_sst` emits up to 3 rows from one call, one per present field, each coalescing independently:
- `status` present -> `Verb::SstStatusChanged` with `payload::status_changed(old, new)`. Read the OLD status before the UPDATE.
- `student_notes` present -> `Verb::SstStudentNotesEdited` (actor is student).
- `coach_notes` present -> `Verb::SstCoachNotesEdited` (actor is coach).

All three denormalise `technique_id` + `syllabus_id` (resolve owner as in Task 8) and set `target_student(owner.student_id)`, `sst(sst_id)`.

- [ ] **Step 1: Write the failing tests** — `update_sst_status_emits_status_changed_with_from_to` (assert payload `from`/`to`), and `update_sst_multiple_fields_emits_one_row_per_field` (set status + student_notes in one call as a student, assert exactly 2 rows: `sst_status_changed` and `sst_student_notes_edited`).

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement.**

`update_sst` is Shape B with multiple statements. Convert to a single `tx`. Before applying the status UPDATE, capture the old status:

```rust
let owner = /* the owner query from Task 8, on &mut *tx */;
let old_status = sqlx::query_scalar!(
    r#"SELECT status AS "status!: String" FROM student_syllabus_techniques WHERE id = ?"#,
    sst_id
).fetch_one(&mut *tx).await?;
```

Run the existing bookkeeping + per-field UPDATEs on `&mut *tx`. Then emit per present field. Example for status:

```rust
if let Some(ref status) = update.status {
    emit(
        &mut tx,
        NewActivity::new(Verb::SstStatusChanged, actor.id)
            .target_student(owner.student_id)
            .sst(sst_id)
            .technique(owner.technique_id)
            .syllabus(owner.syllabus_id)
            .payload(payload::status_changed(&old_status, status)),
    )
    .await?;
}
```

For `student_notes` -> `Verb::SstStudentNotesEdited` (no payload), for `coach_notes` -> `Verb::SstCoachNotesEdited` (no payload). `tx.commit()` at the end.

`set_hidden` (Shape B): resolve owner, emit `Verb::SstHidden` when `hidden == true`, `Verb::SstUnhidden` when false (both non-notifiable), actor = `coach_id`.

`add_technique_to_assignment` (Shape A, already has tx): after computing `id`, resolve the assignment's `student_id` + `syllabus_id`, and emit `Verb::SstAdded` (actor = the coach). This function currently takes `(pool, assignment_id, technique_id)` with no actor; add a `coach_id: i64` parameter and thread it from the call site (`grep -n add_technique_to_assignment crates/syllabus-tracker/src/api.rs`). Build:

```rust
emit(
    &mut tx,
    NewActivity::new(Verb::SstAdded, coach_id)
        .target_student(student_id)
        .sst(id)
        .technique(technique_id)
        .syllabus(syllabus_id),
)
.await?;
```

- [ ] **Step 4:** `just sqlx-prepare`
- [ ] **Step 5:** `cargo test -p syllabus-tracker` → PASS
- [ ] **Step 6: Commit**

```bash
git add crates/syllabus-tracker/src/db/student_syllabus_techniques.rs crates/syllabus-tracker/src/api.rs crates/syllabus-tracker/src/test/activity.rs .sqlx/
git commit -m "feat(activity): emit sst status/notes/hidden/added verbs"
```

---

## Task 10: Assignment lifecycle emit (assigned / unassigned / graduated)

**Files:**
- Modify: `crates/syllabus-tracker/src/db/syllabus_assignments.rs` (`assign`, `unassign`, `graduate`)
- Modify: `crates/syllabus-tracker/src/test/activity.rs`

- [ ] **Step 1: Write the failing test** — `assign_emits_syllabus_assigned` asserting a `syllabus_assigned` row with `actor = coach`, `target_student = student`, `syllabus_id = sid`.

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement.**

`assign` (Shape A): after the SST eager-fill loop, before `tx.commit()`:

```rust
emit(
    &mut tx,
    NewActivity::new(Verb::SyllabusAssigned, coach_id)
        .target_student(student_id)
        .syllabus(syllabus_id),
)
.await?;
```

`unassign` (Shape B): the function takes `assignment_id`; resolve `student_id` + `syllabus_id` from `syllabus_assignments` inside the tx, then emit `Verb::SyllabusUnassigned` (non-notifiable), actor = `coach_id`.

`graduate` (Shape B): same resolve, emit `Verb::SyllabusGraduated`, actor = `coach_id`. (`ungraduate` emits nothing; clearing graduation is not an activity verb.)

- [ ] **Step 4:** `just sqlx-prepare`
- [ ] **Step 5:** `cargo test -p syllabus-tracker` → PASS
- [ ] **Step 6: Commit**

```bash
git add crates/syllabus-tracker/src/db/syllabus_assignments.rs crates/syllabus-tracker/src/test/activity.rs .sqlx/
git commit -m "feat(activity): emit syllabus_assigned / unassigned / graduated"
```

---

## Task 11: Syllabus-technique fan-out emit (added / removed)

**Files:**
- Modify: `crates/syllabus-tracker/src/db/syllabi.rs` (`add_technique_to_syllabus`, `remove_technique_from_syllabus`)
- Modify: `crates/syllabus-tracker/src/test/activity.rs`

These are fan-out verbs. Affected set = `affected_students_for_syllabus(&mut tx, syllabus_id)`.

- [ ] **Step 1: Write the failing test** — `syllabus_technique_added_fans_out_to_active_assignments`: create syllabus, assign to alice + bob, call `add_technique_to_syllabus(..., Cascade)`, assert two `syllabus_technique_added` rows targeting alice and bob.

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement.** Both functions are Shape A (already have tx). After the existing writes, before `tx.commit()`:

`add_technique_to_syllabus`:
```rust
let affected = affected_students_for_syllabus(&mut tx, syllabus_id).await?;
emit_fanout(
    &mut tx,
    NewActivity::new(Verb::SyllabusTechniqueAdded, coach_id)
        .syllabus(syllabus_id)
        .technique(technique_id),
    &affected,
)
.await?;
```

`remove_technique_from_syllabus`: identical but `Verb::SyllabusTechniqueRemoved` (non-notifiable). Resolve `affected` BEFORE the `DELETE FROM syllabus_techniques` only matters for the technique row; affected students come from `syllabus_assignments`, which the delete does not touch, so order is not critical. Keep it before commit.

Note the affected set uses active assignments regardless of `propagation` mode; the spec records the coach action on the syllabus for every active student even when `SyllabusOnly` skips SST materialisation. (If you prefer to only fan out on `Cascade`, the spec's fan-out table is unconditional on propagation, so keep it unconditional.)

- [ ] **Step 4:** `just sqlx-prepare`
- [ ] **Step 5:** `cargo test -p syllabus-tracker` → PASS
- [ ] **Step 6: Commit**

```bash
git add crates/syllabus-tracker/src/db/syllabi.rs crates/syllabus-tracker/src/test/activity.rs .sqlx/
git commit -m "feat(activity): fan out syllabus_technique_added / removed to active students"
```

---

## Task 12: Video add fan-out emit

**Files:**
- Modify: `crates/syllabus-tracker/src/db/videos.rs` (`create_processing_video`, `create_external_video`)
- Modify: `crates/syllabus-tracker/src/test/activity.rs`

`video_added` fans out over `affected_students_for_technique(&mut tx, technique_id)`.

- [ ] **Step 1: Write the failing test** — `video_added_fans_out_to_union_of_assigned_and_pinned`: one student has the technique via an assigned syllabus, another has it pinned; add a video; assert two `video_added` rows targeting both, plus the empty-set case writing one NULL-target row.

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement.** Both `create_*_video` are Shape B. Convert to a tx, keep the INSERT on `&mut *tx`, capture `let video_id = res.last_insert_rowid();`, then:

```rust
let affected = affected_students_for_technique(&mut tx, technique_id).await?;
emit_fanout(
    &mut tx,
    NewActivity::new(Verb::VideoAdded, uploaded_by_id)
        .video(video_id)
        .technique(technique_id),
    &affected,
)
.await?;
```

(`create_external_video` reads `input.technique_id` / `input.uploaded_by_id`.) `next_video_position` currently runs on `pool`; call it before opening the tx (it is a read) to avoid borrow juggling.

- [ ] **Step 4:** `just sqlx-prepare`
- [ ] **Step 5:** `cargo test -p syllabus-tracker` → PASS
- [ ] **Step 6: Commit**

```bash
git add crates/syllabus-tracker/src/db/videos.rs crates/syllabus-tracker/src/test/activity.rs .sqlx/
git commit -m "feat(activity): fan out video_added to assigned + pinned students"
```

---

## Task 13: Video visibility emit (global fan-out + per-student)

**Files:**
- Modify: `crates/syllabus-tracker/src/db/videos.rs` (`set_video_hidden_globally`, `set_video_syllabus_visibility`)
- Modify: `crates/syllabus-tracker/src/test/activity.rs`

`video_visibility_set` (non-notifiable, merged). `payload::video_visibility_set(scope, visible)`.
- Global hide/show (`set_video_hidden_globally`): `scope = "global"`, `visible = !hidden`. Fan out over `affected_students_for_technique(&mut tx, technique_id)` (resolve the video's `technique_id` first).
- Per-student override (`set_video_syllabus_visibility`): `scope = "student"`, single row targeting that student. `visible` reflects the override value; if clearing (`None`), use `visible = true` (treat "fall back to global" as visible for display, the row is history-only).

- [ ] **Step 1: Write the failing test** — `global_hide_fans_out_visibility_set` asserting a `video_visibility_set` row per affected student with `payload.scope == "global"` and `payload.visible == false`.

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement.**

`set_video_hidden_globally` (Shape B): convert to tx; resolve `technique_id` from `videos` for the `video_id`; keep the UPDATE; then:
```rust
let affected = affected_students_for_technique(&mut tx, technique_id).await?;
emit_fanout(
    &mut tx,
    NewActivity::new(Verb::VideoVisibilitySet, actor_id)
        .video(video_id)
        .technique(technique_id)
        .payload(payload::video_visibility_set("global", !hidden)),
    &affected,
)
.await?;
```
`set_video_hidden_globally` currently has no actor parameter; add `actor_id: i64` and thread from the call site (`grep -n set_video_hidden_globally crates/syllabus-tracker/src/api.rs`).

`set_video_syllabus_visibility` (Shape B): convert to tx; keep the upsert/delete; emit a single (non-fanout) `Verb::VideoVisibilitySet` row with `.target_student(student_id).video(video_id)` and `payload::video_visibility_set("student", visible.unwrap_or(true))`. Actor = `by_user_id`.

- [ ] **Step 4:** `just sqlx-prepare`
- [ ] **Step 5:** `cargo test -p syllabus-tracker` → PASS
- [ ] **Step 6: Commit**

```bash
git add crates/syllabus-tracker/src/db/videos.rs crates/syllabus-tracker/src/api.rs crates/syllabus-tracker/src/test/activity.rs .sqlx/
git commit -m "feat(activity): emit video_visibility_set (global fan-out + per-student)"
```

---

## Task 14: Technique-edited fan-out emit

**Files:**
- Modify: `crates/syllabus-tracker/src/db/techniques.rs` (`update_technique`) and the tag add/remove functions (`grep -n "technique_tags" crates/syllabus-tracker/src/db/tags.rs`)
- Modify: `crates/syllabus-tracker/src/test/activity.rs`

`technique_edited` is merged: name + description + tag changes in one verb with a delta payload. It fans out over `affected_students_for_technique`.

- [ ] **Step 1: Write the failing test** — `update_technique_emits_technique_edited_with_field_delta`: a student has the technique pinned; rename it; assert one `technique_edited` row targeting the student with `payload.fields.name == true`.

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement.** `update_technique` (Shape B, two UPDATEs). Read the old name + description before updating to compute which fields changed:

```rust
let old = sqlx::query!(
    r#"SELECT name AS "name!: String", description FROM techniques WHERE id = ?"#,
    technique_id
).fetch_one(&mut *tx).await?;
let name_changed = old.name != name;
let description_changed = old.description.unwrap_or_default() != description;
```

Keep both existing UPDATEs on `&mut *tx`. Then (only if something changed):

```rust
if name_changed || description_changed {
    let affected = affected_students_for_technique(&mut tx, technique_id).await?;
    emit_fanout(
        &mut tx,
        NewActivity::new(Verb::TechniqueEdited, actor_id)
            .technique(technique_id)
            .payload(payload::technique_edited(name_changed, description_changed, &[], &[])),
        &affected,
    )
    .await?;
}
```

`update_technique` has no actor parameter today; add `actor_id: i64` and thread from the call site (`grep -n update_technique crates/syllabus-tracker/src/api.rs`).

Tag changes: the tag add/remove helpers in `db/tags.rs` (`grep -n "pub async fn" crates/syllabus-tracker/src/db/tags.rs`) each emit a `technique_edited` row with `payload::technique_edited(false, false, &[added_name], &[])` (or `&[removed_name]`). These coalesce with a name/description edit within 30s into one row only if the payload merge keeps both; since `technique_edited` is not the status verb, the merge takes the latest payload (per `merge_payload`), so a rename then tag-add in the same window would lose the name flag. To avoid that, give `technique_edited` a custom merge: in `merge_payload`, add a branch for `Verb::TechniqueEdited` that deep-merges the `fields` maps and concatenates tag add/remove arrays. Add this branch and a unit test `technique_edited_merge_unions_fields`.

- [ ] **Step 4:** `just sqlx-prepare`
- [ ] **Step 5:** `cargo test -p syllabus-tracker` → PASS
- [ ] **Step 6: Commit**

```bash
git add crates/syllabus-tracker/src/db/techniques.rs crates/syllabus-tracker/src/db/tags.rs crates/syllabus-tracker/src/db/activity.rs crates/syllabus-tracker/src/api.rs crates/syllabus-tracker/src/test/activity.rs .sqlx/
git commit -m "feat(activity): fan out technique_edited with merged field delta"
```

---

## Task 15: Video-watched threshold emit

**Files:**
- Modify: `crates/syllabus-tracker/src/db/watch.rs` (`ingest_watch_events`)
- Modify: `crates/syllabus-tracker/src/test/activity.rs`

Emit `video_watched` (actor = student, no fan-out) when the watch crosses `min(10s, 20% of duration)` for the FIRST time. The threshold check uses the cumulative seconds before vs after this batch. Payload: `payload::video_watched(cumulative_seconds, duration_seconds)`.

- [ ] **Step 1: Write the failing test** — `crossing_watch_threshold_emits_video_watched_once`: ingest events that push cumulative seconds from 0 past the threshold; assert one `video_watched` row; ingest more; assert still one row (coalesce + already-crossed both keep it at one).

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement.** `ingest_watch_events` is Shape A. It already computes `prior_max_seconds` and `batch_max_seconds`. Fetch the video's `duration_seconds` inside the tx:

```rust
let duration_seconds = sqlx::query_scalar!(
    r#"SELECT COALESCE(duration_seconds, 0) AS "d!: i64" FROM videos WHERE id = ?"#,
    video_id
).fetch_one(&mut *tx).await?;
let threshold = std::cmp::min(10, (duration_seconds as f64 * 0.2).ceil() as i64).max(1);
let new_cumulative = prior_max_seconds.max(batch_max_seconds);
let crossed_now = prior_max_seconds < threshold && new_cumulative >= threshold;
```

After the aggregate upsert, before `tx.commit()`:

```rust
if crossed_now {
    emit(
        &mut tx,
        NewActivity::new(Verb::VideoWatched, user_id)
            .target_student(user_id)
            .video(video_id)
            .payload(payload::video_watched(new_cumulative, duration_seconds)),
    )
    .await?;
}
```

- [ ] **Step 4:** `just sqlx-prepare`
- [ ] **Step 5:** `cargo test -p syllabus-tracker` → PASS
- [ ] **Step 6: Commit**

```bash
git add crates/syllabus-tracker/src/db/watch.rs crates/syllabus-tracker/src/test/activity.rs .sqlx/
git commit -m "feat(activity): emit video_watched on crossing the watch threshold"
```

---

## Task 16: Historical backfill bin

**Files:**
- Create: `crates/syllabus-tracker/src/bin/backfill_activity.rs`
- Modify: `justfile`
- Modify: `crates/syllabus-tracker/src/test/activity.rs`

The backfill seeds rows from existing tables so read surfaces are not blank. Idempotent via an "only if `activity` is empty" guard. Source -> verb -> occurred_at:

| Source | Verb | occurred_at |
|--------|------|-------------|
| `syllabus_attempts` | `attempt_logged` | `created_at` |
| `student_syllabus_techniques.last_student_update_at` | `sst_student_notes_edited` | that column |
| `student_syllabus_techniques.last_coach_update_at` | `sst_coach_notes_edited` | that column |
| `video_watch_aggregates` | `video_watched` | `first_watched_at` |
| `syllabus_assignments` | `syllabus_assigned` (+ `syllabus_graduated` if graduated) | `assigned_at` / `graduated_at` |
| `student_pinned_techniques` | `technique_pinned` | `pinned_at` |

Backfill writes directly with INSERTs that set `occurred_at` explicitly (it must NOT go through `emit`, which stamps `now` and coalesces). Resolve actor/target/entity columns per source. For attempts the actor is `recorded_by_id`, target/technique/syllabus via the SST join. For pins actor=target=student. For assignments actor=`assigned_by_id` (fallback to a system id if NULL — use the student id when `assigned_by_id IS NULL`).

- [ ] **Step 1: Write the failing test** — in `test/activity.rs`, add `backfill_is_idempotent_and_seeds_expected_counts`: seed a DB with one attempt, one pin, one assignment via the real db helpers; TRUNCATE the activity rows those helpers emitted (`DELETE FROM activity`); call the backfill entrypoint function (factor the body into `pub async fn run_backfill(pool: &Pool<Sqlite>) -> Result<BackfillCounts, AppError>` so it is testable without the binary wrapper); assert the expected counts; call it again; assert the second run is a no-op (guard sees non-empty activity).

- [ ] **Step 2: Run to verify it fails** → FAIL to compile (`run_backfill` missing).

- [ ] **Step 3: Implement.** Put `run_backfill` (and `BackfillCounts`) in `db/activity.rs` (so tests can call it without a `bin` dependency) and have the bin be a thin `main` that connects a pool (mirroring `bin/seed.rs` connection setup: `SqliteConnectOptions::from_str` + `SqlitePool`, env via `syllabus_tracker::env`) and calls `run_backfill`.

`run_backfill` body:
```rust
pub struct BackfillCounts {
    pub attempts: i64,
    pub student_notes: i64,
    pub coach_notes: i64,
    pub watches: i64,
    pub assignments: i64,
    pub graduations: i64,
    pub pins: i64,
}

pub async fn run_backfill(pool: &Pool<Sqlite>) -> Result<BackfillCounts, AppError> {
    let existing = sqlx::query_scalar!(r#"SELECT COUNT(*) AS "c!: i64" FROM activity"#)
        .fetch_one(pool).await?;
    if existing > 0 {
        return Ok(BackfillCounts::default()); // idempotent no-op
    }
    let mut tx = pool.begin().await?;
    // ... one INSERT ... SELECT per source, setting occurred_at from the source
    // column and verb literal. Count rows affected per statement.
    tx.commit().await?;
    Ok(counts)
}
```

Write each source as an `INSERT INTO activity (occurred_at, verb, actor_user_id, target_student_id, technique_id, syllabus_id, sst_id, video_id, payload_json) SELECT ...`. Example (pins):
```sql
INSERT INTO activity (occurred_at, verb, actor_user_id, target_student_id, technique_id)
SELECT pinned_at, 'technique_pinned', student_id, student_id, technique_id
FROM student_pinned_techniques;
```
Use `.execute(&mut *tx).await?.rows_affected() as i64` for the count. (`Pool<Sqlite>` import: add `use sqlx::Pool;` to `activity.rs`.)

Add the justfile recipe after the `seed` recipe:
```
# One-shot idempotent historical activity backfill. Run once at deploy.
backfill-activity: migrate
    cargo run -p syllabus-tracker --bin backfill_activity
```

- [ ] **Step 4:** `just sqlx-prepare`
- [ ] **Step 5:** `cargo test -p syllabus-tracker --lib test::activity::tests::backfill` → PASS
- [ ] **Step 6: Commit**

```bash
git add crates/syllabus-tracker/src/db/activity.rs crates/syllabus-tracker/src/bin/backfill_activity.rs justfile crates/syllabus-tracker/src/test/activity.rs .sqlx/
git commit -m "feat(activity): add idempotent historical backfill bin"
```

---

## Task 17: PR 1 full verification

- [ ] **Step 1: Run the whole gate**

Run: `just verify`
Expected: lint, all backend tests, `sqlx-check`, frontend lint/build/test all pass. (PR 1 touches no frontend, so the frontend steps are unchanged baseline.)

- [ ] **Step 2: Manual smoke (optional but recommended)**

Run `just seed`, then exercise a pin, an attempt, a status change, and a video add through the running app; confirm `sqlite3 data/sqlite.db "SELECT verb, count(*) FROM activity GROUP BY verb"` shows the expected verbs and that rapid repeats coalesce.

- [ ] **Step 3: Open the PR**

```bash
git push -u origin HEAD
gh pr create --title "Activity event log (PR 1)" --body "Implements the append-only activity table, verb registry, emit/coalesce/fan-out helpers wired into every live write path, and the historical backfill. Read side is PR 2."
```

---

# PR 2: Read side, unread, and dashboard

> Branch off PR 1 once merged (or stack on it). All backend tasks follow the same prepare/test/commit cadence.

## Task 18: Read-side tables

**Files:**
- Modify: `config/schema.sql`

- [ ] **Step 1: Add the tables** before the `_litestream_lock` line:

```sql
CREATE TABLE IF NOT EXISTS activity_cursors (
    viewer_user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    max_seen_id    INTEGER NOT NULL DEFAULT 0,
    updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS activity_seen_overrides (
    viewer_user_id INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    activity_id    INTEGER NOT NULL REFERENCES activity(id) ON DELETE CASCADE,
    seen           BOOLEAN NOT NULL,
    PRIMARY KEY (viewer_user_id, activity_id)
);
CREATE INDEX IF NOT EXISTS idx_aso_viewer ON activity_seen_overrides (viewer_user_id);
```

- [ ] **Step 2:** `just migrate` → succeeds.
- [ ] **Step 3:** `sqlite3 data/sqlite.db ".schema activity_cursors"` shows the table.
- [ ] **Step 4: Commit**

```bash
git add config/schema.sql
git commit -m "feat(activity): add activity_cursors and activity_seen_overrides tables"
```

---

## Task 19: Read module scaffold + typed payload + `notifies` rule

**Files:**
- Create: `crates/syllabus-tracker/src/db/activity_read.rs`
- Modify: `crates/syllabus-tracker/src/db/mod.rs`
- Create: `crates/syllabus-tracker/src/test/activity_read.rs`
- Modify: `crates/syllabus-tracker/src/test/mod.rs`

- [ ] **Step 1: Write the failing test** — in `test/activity_read.rs`, a pure unit test of the `notifies` rule:

```rust
#[cfg(test)]
mod tests {
    use crate::db::activity_read::notifies;
    use crate::db::activity::Verb;

    #[test]
    fn own_action_never_notifies() {
        // actor == viewer => false even for a notifiable verb in the feed.
        assert!(!notifies(Verb::AttemptLogged.as_str(), 5, 5, true));
    }

    #[test]
    fn non_notifiable_verb_never_notifies() {
        assert!(!notifies(Verb::AttemptDeleted.as_str(), 9, 5, true));
    }

    #[test]
    fn notifiable_other_actor_in_feed_notifies() {
        assert!(notifies(Verb::AttemptLogged.as_str(), 9, 5, true));
    }

    #[test]
    fn not_in_feed_never_notifies() {
        assert!(!notifies(Verb::AttemptLogged.as_str(), 9, 5, false));
    }
}
```

Register `mod activity_read;` in `db/mod.rs` (with `pub use activity_read::*;`) and `mod activity_read;` in `test/mod.rs`.

- [ ] **Step 2: Run to verify it fails** → FAIL to compile.

- [ ] **Step 3: Implement** the rule plus the read-row shape in `activity_read.rs`:

```rust
use chrono::NaiveDateTime;
use serde::Serialize;
use sqlx::{Pool, Sqlite};

use crate::db::activity::Verb;
use crate::error::AppError;

/// The PR-1 derived notify rule, viewer-relative. `in_feed` is supplied by the
/// feed query (target_student_id = viewer for a student; actor != viewer for a
/// coach). Unknown verbs are treated as non-notifiable.
pub fn notifies(verb: &str, actor_user_id: i64, viewer_id: i64, in_feed: bool) -> bool {
    let notifiable = Verb::from_str_verb(verb).map(|v| v.notifiable()).unwrap_or(false);
    notifiable && actor_user_id != viewer_id && in_feed
}

/// One row rendered into a feed. Joined names are nullable because the entity
/// FK may have been SET NULL by a deletion (greyed history).
#[derive(Debug, Serialize)]
pub struct ActivityRow {
    pub id: i64,
    pub occurred_at: String,
    pub verb: String,
    pub actor_user_id: i64,
    pub actor_name: Option<String>,
    pub target_student_id: Option<i64>,
    pub technique_id: Option<i64>,
    pub technique_name: Option<String>,
    pub syllabus_id: Option<i64>,
    pub syllabus_name: Option<String>,
    pub sst_id: Option<i64>,
    pub video_id: Option<i64>,
    pub video_title: Option<String>,
    pub payload_json: Option<String>,
    pub unread: bool,
}
```

- [ ] **Step 4: Run to verify it passes** — `cargo test -p syllabus-tracker --lib test::activity_read` → PASS.
- [ ] **Step 5: Commit**

```bash
git add crates/syllabus-tracker/src/db/activity_read.rs crates/syllabus-tracker/src/db/mod.rs crates/syllabus-tracker/src/test/activity_read.rs crates/syllabus-tracker/src/test/mod.rs
git commit -m "feat(activity): add read module scaffold, ActivityRow, notifies rule"
```

---

## Task 20: Cursor operations (advance + GC, mark-all, mark-one, unmark)

**Files:**
- Modify: `crates/syllabus-tracker/src/db/activity_read.rs`
- Modify: `crates/syllabus-tracker/src/test/activity_read.rs`

Operations (from the spec):
- `feed_max_id(pool, viewer) -> i64`: `MAX(id)` over the viewer's feed (used by view-advance).
- `advance_cursor_to(pool, viewer, max_id)`: upsert `activity_cursors`, set `max_seen_id = MAX(max_seen_id, max_id)`, then GC `seen=1` overrides at/below the new cursor.
- `mark_all_read(pool, viewer)`: `advance_cursor_to(viewer, current global MAX(id))` then GC.
- `mark_one_read(pool, viewer, activity_id)`: upsert override `(viewer, activity_id, seen=1)`.
- `mark_one_unread(pool, viewer, activity_id)`: if the row is already unread (`activity_id > max_seen_id` and no `seen=1` override) it is a no-op; else upsert `(viewer, activity_id, seen=0)`.

- [ ] **Step 1: Write the failing tests** covering the spec's PR-2 assertions:
  - `cursor_advance_on_view_sets_max_seen_to_snapshot_top_id`
  - `mark_one_read_keeps_older_unread`
  - `mark_one_unread_on_below_cursor_row_makes_it_unread`
  - `gc_deletes_redundant_seen1_overrides_keeps_seen0`
  - `mark_one_unread_above_cursor_is_noop` (no override row written)

  Build activity rows by emitting via PR-1 helpers, then drive the cursor ops and assert against `activity_cursors` / `activity_seen_overrides`.

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement** each function. GC (run inside `advance_cursor_to` after the upsert):

```rust
sqlx::query!(
    "DELETE FROM activity_seen_overrides
     WHERE viewer_user_id = ? AND seen = 1 AND activity_id <= ?",
    viewer, max_seen_id_after,
).execute(pool).await?;
```

`advance_cursor_to` upsert:
```rust
sqlx::query!(
    "INSERT INTO activity_cursors (viewer_user_id, max_seen_id, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (viewer_user_id) DO UPDATE SET
        max_seen_id = MAX(max_seen_id, excluded.max_seen_id),
        updated_at = CURRENT_TIMESTAMP",
    viewer, new_max,
).execute(pool).await?;
```

`mark_one_unread` no-op guard:
```rust
let cursor = current_max_seen(pool, viewer).await?; // 0 if no cursor row
let has_seen1 = /* SELECT 1 FROM overrides WHERE viewer=? AND activity_id=? AND seen=1 */;
if activity_id > cursor && !has_seen1 {
    return Ok(()); // already unread via the cursor; a seen=0 here would never GC
}
// else upsert seen=0
```

- [ ] **Step 4:** `just sqlx-prepare`
- [ ] **Step 5:** `cargo test -p syllabus-tracker --lib test::activity_read` → PASS
- [ ] **Step 6: Commit**

```bash
git add crates/syllabus-tracker/src/db/activity_read.rs crates/syllabus-tracker/src/test/activity_read.rs .sqlx/
git commit -m "feat(activity): cursor advance/GC, mark-all/one read, mark-one unread"
```

---

## Task 21: Feed query (keyset paginated) + unread count

**Files:**
- Modify: `crates/syllabus-tracker/src/db/activity_read.rs`
- Modify: `crates/syllabus-tracker/src/test/activity_read.rs`

`feed(pool, viewer, role, before: Option<(NaiveDateTime, i64)>, limit) -> Vec<ActivityRow>`:
- Student viewer: `WHERE target_student_id = viewer`.
- Coach viewer: `WHERE actor_user_id != viewer` (all gym activity except the coach's own).
- Order `occurred_at DESC, id DESC`; keyset on `(occurred_at, id) < before` when supplied.
- LEFT JOIN `users` (actor_name = display_name), `techniques`, `syllabi`, `videos` for render names.
- Annotate `unread` per the unread rule: `notifies(verb, actor, viewer, in_feed=true)` AND NOT seen, where seen = `(id <= cursor AND no override) OR override.seen=1`, and explicitly unseen = `id <= cursor AND override.seen=0`.

`unread_count(pool, viewer, role) -> i64`: same feed predicate, restricted to notifiable verbs and `actor != viewer`, counting rows that are unread by the cursor/override logic.

- [ ] **Step 1: Write the failing tests**:
  - `notifies_excludes_own_and_non_notifiable_from_count_but_feed_lists_them`
  - `keyset_pagination_returns_stable_non_overlapping_pages`
  - `coach_feed_excludes_own_rows_includes_other_actors`
  - `student_feed_only_targets_self`

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement.** Because the viewer predicate differs by role and keyset is optional, write two query variants (student / coach) each with an optional `before`. To keep sqlx compile-time checks, pass the cursor via a LEFT JOIN to `activity_cursors` and compute `unread` in SQL:

```sql
SELECT act.id, act.occurred_at, act.verb, act.actor_user_id,
       u.display_name AS actor_name,
       act.target_student_id, act.technique_id, t.name AS technique_name,
       act.syllabus_id, s.name AS syllabus_name, act.sst_id,
       act.video_id, v.title AS video_title, act.payload_json,
       CASE
         WHEN ov.seen = 1 THEN 0
         WHEN ov.seen = 0 THEN 1
         WHEN act.id <= COALESCE(c.max_seen_id, 0) THEN 0
         ELSE 1
       END AS is_after_cursor
FROM activity act
LEFT JOIN users u ON u.id = act.actor_user_id
LEFT JOIN techniques t ON t.id = act.technique_id
LEFT JOIN syllabi s ON s.id = act.syllabus_id
LEFT JOIN videos v ON v.id = act.video_id
LEFT JOIN activity_cursors c ON c.viewer_user_id = ?viewer
LEFT JOIN activity_seen_overrides ov
       ON ov.viewer_user_id = ?viewer AND ov.activity_id = act.id
WHERE <feed predicate>
  AND (?before_ts IS NULL OR (act.occurred_at, act.id) < (?before_ts, ?before_id))
ORDER BY act.occurred_at DESC, act.id DESC
LIMIT ?limit
```

Then in Rust set `row.unread = is_after_cursor == 1 && notifies(&verb, actor, viewer, true)`. For `unread_count`, wrap the same predicate in `SELECT COUNT(*)` with `is_after_cursor = 1` and a `verb IN (<notifiable list>)` filter and `actor_user_id != viewer`. Build the notifiable-verb `IN` list from `Verb::ALL.iter().filter(|v| v.notifiable())` as a comma-joined bound list (dynamic query, like `db/watch.rs::get_my_watch_state`).

- [ ] **Step 4:** `just sqlx-prepare`
- [ ] **Step 5:** `cargo test -p syllabus-tracker --lib test::activity_read` → PASS
- [ ] **Step 6: Commit**

```bash
git add crates/syllabus-tracker/src/db/activity_read.rs crates/syllabus-tracker/src/test/activity_read.rs .sqlx/
git commit -m "feat(activity): keyset feed query + unread_count with notify rule"
```

---

## Task 22: Cursor initialization bin (deploy seed)

**Files:**
- Create: `crates/syllabus-tracker/src/bin/init_activity_cursors.rs`
- Modify: `crates/syllabus-tracker/src/db/activity_read.rs` (testable `run_cursor_init`)
- Modify: `justfile`
- Modify: `crates/syllabus-tracker/src/test/activity_read.rs`

Seed every existing user's cursor to the current `MAX(activity.id)` so pre-deploy history reads as already-seen. Idempotent: only insert a cursor where none exists.

- [ ] **Step 1: Write the failing test** — `cursor_init_seeds_existing_users_to_current_max_and_is_idempotent`: emit some activity, run `run_cursor_init`, assert every user has `max_seen_id = MAX(activity.id)`; run again, assert unchanged and no duplicate rows.

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement** `pub async fn run_cursor_init(pool) -> Result<i64, AppError>`:

```rust
let max_id = sqlx::query_scalar!(r#"SELECT COALESCE(MAX(id), 0) AS "m!: i64" FROM activity"#)
    .fetch_one(pool).await?;
let res = sqlx::query!(
    "INSERT OR IGNORE INTO activity_cursors (viewer_user_id, max_seen_id)
     SELECT id, ? FROM users",
    max_id,
).execute(pool).await?;
Ok(res.rows_affected() as i64)
```

Thin bin wrapper mirrors `bin/seed.rs`. Add justfile recipe `init-activity-cursors: migrate` running the bin.

- [ ] **Step 4:** `just sqlx-prepare`
- [ ] **Step 5:** `cargo test -p syllabus-tracker --lib test::activity_read::tests::cursor_init` → PASS
- [ ] **Step 6: Commit**

```bash
git add crates/syllabus-tracker/src/db/activity_read.rs crates/syllabus-tracker/src/bin/init_activity_cursors.rs justfile crates/syllabus-tracker/src/test/activity_read.rs .sqlx/
git commit -m "feat(activity): add idempotent cursor-init deploy bin"
```

---

## Task 23: Feed / unread / mark routes

**Files:**
- Modify: `crates/syllabus-tracker/src/api.rs`
- Modify: `crates/syllabus-tracker/src/test/activity_read.rs`

Add routes (follow the existing route conventions in `api.rs`; register each in the routes list returned by the mounting fn):
- `GET /api/activity/feed?before_ts=&before_id=&limit=` — the viewer's feed (role-derived predicate). Returns `Vec<ActivityRow>` and snapshots+advances the cursor to `feed_max_id` on load (per the spec: snapshot MAX(id) at load, advance, GC).
- `GET /api/activity/unread_count` — returns `{ count }`.
- `POST /api/activity/mark_all_read` — advances cursor to global max, GC. 204.
- `POST /api/activity/<activity_id>/read` — mark-one-read. 204.
- `POST /api/activity/<activity_id>/unread` — mark-one-unread. 204.

Gate: any authenticated user (the feed predicate already scopes to their own rows; a student only ever sees `target_student_id = self`).

- [ ] **Step 1: Write the failing route tests** — `feed_endpoint_returns_rows_and_advances_cursor`, `unread_count_endpoint`, `mark_all_read_zeroes_unread_count`, using the Rocket test client + `login_test_user`.

- [ ] **Step 2: Run to verify it fails** → FAIL (404 / route missing).

- [ ] **Step 3: Implement** the handlers, delegating to the `activity_read` functions. The feed handler computes `feed_max_id` first, returns the page, then `advance_cursor_to(viewer, snapshot_max)` (advance after building the response so a newly arrived row is not silently marked seen).

- [ ] **Step 4:** `just sqlx-prepare`
- [ ] **Step 5:** `cargo test -p syllabus-tracker` → PASS
- [ ] **Step 6: Commit**

```bash
git add crates/syllabus-tracker/src/api.rs crates/syllabus-tracker/src/test/activity_read.rs .sqlx/
git commit -m "feat(activity): feed, unread-count, and mark-read routes"
```

---

## Task 24: Coach dashboard read swap (recently-active students)

**Files:**
- Modify: `crates/syllabus-tracker/src/db/activity_read.rs` (add `recently_active_students`)
- Modify: `crates/syllabus-tracker/src/api.rs` (dashboard endpoint)
- Modify: `crates/syllabus-tracker/src/test/activity_read.rs`

`recently_active_students(pool, limit) -> Vec<StudentLatestActivity>`: group recent `activity` rows by `target_student_id` (non-null), return each student's most recent row joined to render names, ordered by most-recent `occurred_at DESC`. This replaces the legacy `get_students_by_recent_updates` read for the dashboard.

- [ ] **Step 1: Write the failing test** — `dashboard_returns_recently_active_students_ordering`: emit activity for two students at different times; assert the more-recent student sorts first and the latest verb/entity is carried.

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement** the query (correlated `MAX(occurred_at)` per `target_student_id`, or a window function) returning `{ student_id, student_name, verb, occurred_at, technique_name?, syllabus_name?, video_title?, payload_json }`. Point the coach dashboard endpoint at it. Drop the standalone "recently watched videos" widget read (video watches are now one verb in the stream). Coordinate the legacy `get_students_by_recent_updates` removal with `docs/LEGACY_DECOMMISSION_PLAN.md` (its dashboard section defers to this work); leave the legacy fn in place if other surfaces still call it, but the dashboard no longer does.

- [ ] **Step 4:** `just sqlx-prepare`
- [ ] **Step 5:** `cargo test -p syllabus-tracker` → PASS
- [ ] **Step 6: Commit**

```bash
git add crates/syllabus-tracker/src/db/activity_read.rs crates/syllabus-tracker/src/api.rs crates/syllabus-tracker/src/test/activity_read.rs .sqlx/
git commit -m "feat(activity): drive coach dashboard recently-active from activity stream"
```

---

## Task 25: Shared per-verb renderer (frontend)

**Files:**
- Create: `frontend/src/lib/activity-line.ts`
- Create: `frontend/src/lib/activity-line.test.tsx`

> Use the shadcn-ui-design skill for any component work here.

A single pure mapping from a row (`verb` + joined names + parsed `payload_json`) to a display line, reused by the dashboard, the student recent-activity surface, and (later) the full activity page. Non-notifiable rows render as plain history (no deep-link when the entity column is NULL).

- [ ] **Step 1: Write the failing test** — `activity-line.test.tsx` asserting representative lines, no em-dashes:
  - `attempt_logged` on "Armbar" -> "logged an attempt on Armbar"
  - `video_watched` "Triangle setup" -> "watched Triangle setup"
  - `sst_status_changed` payload `{from:"amber",to:"green"}` on "Kimura" -> "went green on Kimura"
  - `technique_edited` payload `{fields:{name:true}}` -> "edited Armbar"
  - a row with a NULL entity name renders greyed history text with no link.

- [ ] **Step 2: Run to verify it fails** — `pnpm -C frontend test activity-line` → FAIL.

- [ ] **Step 3: Implement** `activityLine(row): { text: string; href?: string }` with a `switch` over `verb`, parsing `payload_json` with a typed parser per verb (mirror the Rust payload shapes from PR 1 Task 3). Greyed/no-link when the relevant entity id is null.

- [ ] **Step 4:** `pnpm -C frontend test activity-line` → PASS
- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/activity-line.ts frontend/src/lib/activity-line.test.tsx
git commit -m "feat(activity): shared per-verb activity-line renderer"
```

---

## Task 26: Coach dashboard UI + student recent-activity + unread badge

**Files:**
- Modify: dashboard component (`grep -rn "recently active\|get_students_by_recent\|useStudentTechniques" frontend/src/app`)
- Modify: student profile hub "Recent activity" component
- Modify: `frontend/src/lib/query-keys.ts`, `frontend/src/lib/queries.ts`, `frontend/src/lib/mutations.ts`, `frontend/src/components/navbar.tsx`

> Use the shadcn-ui-design skill. Follow the RHF + Zod + TracedForm and shadcn/ui conventions; reuse the unified `TechniqueRow` where an activity row expands to technique context.

- [ ] **Step 1: Add query keys + hooks.** `qk.activityFeed`, `qk.activityUnreadCount`, `qk.dashboardRecentlyActive`. Hooks `useActivityFeed(before?)` (keyset/infinite), `useActivityUnreadCount()`, `useRecentlyActiveStudents()`. Mutations `useMarkAllActivityRead()`, `useMarkActivityRead(id)`, `useMarkActivityUnread(id)` invalidating the count + feed keys.

- [ ] **Step 2: Coach dashboard.** Replace the legacy `get_students_by_recent_updates` / `useStudentTechniques`-backed reads with `useRecentlyActiveStudents()`, rendering each student's latest activity inline via `activityLine`. Remove the standalone "recently watched videos" widget.

- [ ] **Step 3: Student recent-activity.** Rebuild the student profile hub "Recent activity" section to read `useActivityFeed()` (the student's own feed) and render with `activityLine`, replacing the legacy SST/attempt aggregate read.

- [ ] **Step 4: Unread badge.** Wire `useActivityUnreadCount()` to a navbar badge and a "mark all read" affordance calling `useMarkAllActivityRead()`.

- [ ] **Step 5: Component tests** (Vitest Browser Mode): badge reflects the count; "mark all read" clears it; a student feed list renders expected lines; a coach dashboard renders recently-active students in order. Run `pnpm -C frontend test`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/
git commit -m "feat(activity): coach dashboard + student recent-activity + unread badge"
```

---

## Task 27: PR 2 full verification

- [ ] **Step 1:** `just verify` → all green (backend + frontend).
- [ ] **Step 2: Deploy ordering note in the PR body.** The deploy must run, in order: `just migrate` (adds the read tables), then `just init-activity-cursors` (so backfilled history reads as already-seen). Without the cursor-init step, every user's first login would badge the entire backfill.
- [ ] **Step 3: Manual smoke.** As a coach, confirm the dashboard lists recently-active students with verb-aware copy and no "recently watched videos" widget. As a student, confirm "Recent activity" lists own-feed rows; mark-all-read zeroes the badge; a freshly emitted row re-badges.
- [ ] **Step 4: Open the PR**

```bash
git push -u origin HEAD
gh pr create --title "Activity read side, unread tracking, dashboard (PR 2)" --body "Adds activity_cursors + activity_seen_overrides, keyset feed + unread_count, cursor ops, cursor-init deploy bin, coach dashboard redesign on the activity stream, and the student recent-activity surface. Deploy runs migrate then init-activity-cursors."
```

---

## Self-review notes (spec coverage)

- PR 1 table + 5 indexes -> Task 1. Verb registry + notifiable + primary-entity -> Task 2. payload constructors -> Task 3. emit + coalesce (incl. status from/to merge) -> Tasks 4-5. emit_fanout + resolvers (active-assignment set; union for technique; empty-set NULL row) -> Task 6. All 20 verbs wired across Tasks 7-15 (pin/unpin, attempts ×3, sst status/notes×2/hidden×2/added, assign/unassign/graduate, syllabus-technique add/remove fan-out, video_added fan-out, video_visibility_set global fan-out + per-student, technique_edited fan-out merged, video_watched threshold). `update_sst` 3-rows-per-call -> Task 9. Backfill (all six sources, idempotent) -> Task 16. PR 1 tests + sqlx-check -> per-task + Task 17.
- PR 2 tables -> Task 18. Cursor init at deploy -> Task 22 + Task 27 ordering. Unread semantics (cursor + overrides, GC, mark-one no-op guard) -> Task 20. feed + unread_count (keyset, role predicate, notify rule) -> Task 21. Coach dashboard redesign (drop video widget) -> Tasks 24, 26. Student recent activity -> Task 26. Shared per-verb renderer -> Task 25. Unread badge + mark-all-read -> Task 26. PR 2 tests -> per-task + Task 27.
- Out of scope (untouched): full social-feed activity page, notifications/push, pruning, coach->cohort filter, `feed_key`, multi-tenant.
```