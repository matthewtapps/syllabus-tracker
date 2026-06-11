# Coach Dashboard and Roster Uplift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the coach dashboard's stale status donut with a rolling activity digest and an event feed, and rebuild the student-list page as an activity-based triage, on top of reusable activity and avatar primitives.

**Architecture:** Backend adds three reads off the existing `activity` log (a gym-wide digest, a peek feed that does not advance the read cursor, and two per-student activity timestamps on the students query) plus their routes. Frontend introduces three reusable primitives (a deterministic `studentColor`, a `StudentAvatar`, and a presentational `ActivityFeedList`) and wires them into the coach dashboard, the student list, and the student profile.

**Tech Stack:** Rust / Rocket / sqlx (SQLite, compile-time-checked macros, offline `.sqlx/` cache), chrono, serde. Frontend: Vite + React 19 SPA, shadcn/ui, Tailwind v4, TanStack Query, react-router-dom v7, Vitest (node `.unit.test.ts` + browser `.test.tsx`).

**Spec:** `docs/superpowers/specs/2026-06-11-coach-dashboard-and-roster-uplift-design.md`

---

## Conventions for this plan

- Commits: short imperative, `feat(scope): Add the thing`, no co-author trailer (repo skill `atomic-commits`).
- Backend verify: `just verify` (or `cargo test -p syllabus-tracker <name>` for a single test). Frontend: `cd frontend && npx vitest run <path>`.
- Never rebuild `data/sqlite.db` while the dev app runs. Regenerate the `.sqlx/` cache against a temp seeded DB (repo memory `project-sqlx-check-seed-dependency`).
- No em-dashes in copy or comments.

## File structure (what each unit owns)

**Backend (new)**
- `crates/syllabus-tracker/src/db/dashboard.rs` — `activity_digest()` + `ActivityDigest`/`DigestMetric` types.

**Backend (modified)**
- `db/activity_read.rs` — `dashboard_activity_feed()` (peek, engagement-scoped).
- `db/reporting.rs` — two activity-log timestamps on `get_students_by_recent_updates`.
- `auth.rs` (or wherever `User` is defined) — two new `User` fields.
- `db/mod.rs` — re-export new `dashboard` module items.
- `api.rs` + `main.rs` — two dashboard routes; mount them.

**Frontend (new)**
- `lib/student-color.ts` — deterministic per-student color.
- `lib/activity-coalesce.ts` — collapse consecutive same-verb same-actor rows.
- `lib/student-triage.ts` — categorize a student by activity recency.
- `components/student-avatar.tsx` — tinted initials avatar.
- `components/activity-feed-list.tsx` — presentational activity list (the reusable component).
- `app/dashboard/components/sparkline.tsx` — tiny inline-SVG sparkline.
- `app/dashboard/components/activity-digest.tsx` — the four-tile digest (B).
- `app/dashboard/components/recent-activity-feed.tsx` — dashboard feed (C) wrapping `ActivityFeedList`.

**Frontend (modified)**
- `lib/api.ts` — types + fetchers.
- `lib/queries.ts` — `useActivityDigest`, `useDashboardActivityFeed`; query keys.
- `app/dashboard/page.tsx` — CoachDashboard surgery.
- `app/students-list/page.tsx` — triage rebuild.
- `components/student-row.tsx` — use `StudentAvatar`.
- `app/student-profile/page.tsx` — use `ActivityFeedList`.

The work is grouped into five stacked PRs. Each PR ends green and is independently reviewable.

---

# PR 1 — Backend reads and routes

### Task 1: Activity digest query

**Files:**
- Create: `crates/syllabus-tracker/src/db/dashboard.rs`
- Modify: `crates/syllabus-tracker/src/db/mod.rs` (add `pub mod dashboard;` and re-exports)
- Test: `crates/syllabus-tracker/src/test/dashboard_digest.rs` (new) + register in `crates/syllabus-tracker/src/test/mod.rs`

The digest counts **student-actor** activity gym-wide over a rolling 7-day window vs the previous 7 days, with a 7-point daily sparkline per metric. Metrics: `attempts_logged` (verb `attempt_logged`), `videos_watched` (verb `video_watched`), `techniques_pinned` (verb `technique_pinned`), and `active_students` (distinct student actors).

- [ ] **Step 1: Write the failing test**

Create `crates/syllabus-tracker/src/test/dashboard_digest.rs`:

```rust
#[cfg(test)]
mod tests {
    use crate::db::{ActivityDigest, NewActivity, Verb, activity_digest, emit};
    use crate::test::test_utils::TestDbBuilder;

    fn metric<'a>(d: &'a ActivityDigest, key: &str) -> &'a crate::db::DigestMetric {
        d.metrics.iter().find(|m| m.key == key).expect("metric present")
    }

    #[rocket::async_test]
    async fn digest_counts_student_attempts_in_current_window() {
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .technique("Armbar", "", Some("coach"))
            .build()
            .await
            .unwrap();
        let alice = db.user_id("alice").unwrap();
        let armbar = db.technique_id("Armbar").unwrap();

        // Three attempts logged by the student today (actor = student).
        for _ in 0..3 {
            let mut tx = db.pool.begin().await.unwrap();
            emit(
                &mut tx,
                NewActivity::new(Verb::AttemptLogged, alice)
                    .target_student(alice)
                    .technique(armbar),
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();
        }

        let digest = activity_digest(&db.pool).await.unwrap();
        let attempts = metric(&digest, "attempts_logged");
        assert_eq!(attempts.count, 3, "3 attempts in the current 7-day window");
        assert_eq!(attempts.prev_count, 0);
        assert_eq!(attempts.delta, 3);
        assert_eq!(attempts.daily.len(), 7);
        assert_eq!(attempts.daily.iter().sum::<i64>(), 3);

        let active = metric(&digest, "active_students");
        assert_eq!(active.count, 1, "one distinct active student");
    }

    #[rocket::async_test]
    async fn digest_ignores_coach_actor_activity() {
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .technique("Armbar", "", Some("coach"))
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();
        let armbar = db.technique_id("Armbar").unwrap();

        // Coach action targeting the student must NOT count as student activity.
        let mut tx = db.pool.begin().await.unwrap();
        emit(
            &mut tx,
            NewActivity::new(Verb::SstStatusChanged, coach)
                .target_student(alice)
                .technique(armbar),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let digest = activity_digest(&db.pool).await.unwrap();
        assert_eq!(metric(&digest, "active_students").count, 0);
    }
}
```

Register the module: in `crates/syllabus-tracker/src/test/mod.rs` add `mod dashboard_digest;` alongside the existing `mod dashboard_reporting;`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p syllabus-tracker digest_ -- --nocapture`
Expected: FAIL to compile (`activity_digest`, `ActivityDigest`, `DigestMetric` not found).

- [ ] **Step 3: Implement the digest module**

Create `crates/syllabus-tracker/src/db/dashboard.rs`:

```rust
//! Coach dashboard reads off the activity log: the rolling "what happened
//! lately" digest. Gym-wide (coach/admin see all students); counts only
//! student-actor activity, since a coach already knows their own actions.

use chrono::{Duration, Utc};
use serde::Serialize;
use sqlx::{Pool, Sqlite};

use crate::error::AppError;

/// One digest tile: a rolling 7-day count, the previous 7-day count, the
/// signed delta, and a 7-point daily series (oldest first) for the sparkline.
#[derive(Debug, Serialize)]
pub struct DigestMetric {
    pub key: String,
    pub label: String,
    pub count: i64,
    pub prev_count: i64,
    pub delta: i64,
    pub daily: Vec<i64>,
}

#[derive(Debug, Serialize)]
pub struct ActivityDigest {
    pub window_days: i64,
    pub metrics: Vec<DigestMetric>,
}

/// A simple-count metric (attempts/videos/pins): one activity row = one unit.
struct CountSpec {
    key: &'static str,
    label: &'static str,
    verb: &'static str,
}

const COUNT_METRICS: [CountSpec; 3] = [
    CountSpec { key: "attempts_logged", label: "Attempts logged", verb: "attempt_logged" },
    CountSpec { key: "videos_watched", label: "Videos watched", verb: "video_watched" },
    CountSpec { key: "techniques_pinned", label: "Techniques pinned", verb: "technique_pinned" },
];

pub async fn activity_digest(pool: &Pool<Sqlite>) -> Result<ActivityDigest, AppError> {
    // The 14 day-keys we care about, oldest first. day_keys[7..14] is the
    // current window; day_keys[0..7] is the previous window. date() in SQLite
    // yields 'YYYY-MM-DD', which we match against these.
    let today = Utc::now().date_naive();
    let day_keys: Vec<String> = (0..14)
        .rev()
        .map(|back| (today - Duration::days(back)).format("%Y-%m-%d").to_string())
        .collect();

    // Per-verb daily counts over the last 14 days, student actors only.
    let count_rows = sqlx::query!(
        r#"SELECT a.verb              AS "verb!: String",
                  date(a.occurred_at) AS "day!: String",
                  COUNT(*)            AS "n!: i64"
           FROM activity a
           JOIN users u ON u.id = a.actor_user_id
           WHERE u.role = 'student'
             AND a.occurred_at >= datetime('now', '-13 days', 'start of day')
             AND a.verb IN ('attempt_logged', 'video_watched', 'technique_pinned')
           GROUP BY a.verb, date(a.occurred_at)"#,
    )
    .fetch_all(pool)
    .await?;

    // Distinct active students per day (any student-actor activity).
    let active_rows = sqlx::query!(
        r#"SELECT date(a.occurred_at)             AS "day!: String",
                  COUNT(DISTINCT a.actor_user_id) AS "n!: i64"
           FROM activity a
           JOIN users u ON u.id = a.actor_user_id
           WHERE u.role = 'student'
             AND a.occurred_at >= datetime('now', '-13 days', 'start of day')
           GROUP BY date(a.occurred_at)"#,
    )
    .fetch_all(pool)
    .await?;

    // Distinct active students per WINDOW (not summable from daily distincts).
    let active_windows = sqlx::query!(
        r#"SELECT
             COUNT(DISTINCT CASE WHEN a.occurred_at >= datetime('now', '-6 days', 'start of day')
                                 THEN a.actor_user_id END) AS "cur!: i64",
             COUNT(DISTINCT CASE WHEN a.occurred_at <  datetime('now', '-6 days', 'start of day')
                                 THEN a.actor_user_id END) AS "prev!: i64"
           FROM activity a
           JOIN users u ON u.id = a.actor_user_id
           WHERE u.role = 'student'
             AND a.occurred_at >= datetime('now', '-13 days', 'start of day')"#,
    )
    .fetch_one(pool)
    .await?;

    let mut metrics = Vec::with_capacity(4);

    for spec in &COUNT_METRICS {
        // Build a 14-slot daily array aligned to day_keys.
        let mut daily14 = vec![0i64; 14];
        for r in count_rows.iter().filter(|r| r.verb == spec.verb) {
            if let Some(idx) = day_keys.iter().position(|d| *d == r.day) {
                daily14[idx] = r.n;
            }
        }
        let prev_count: i64 = daily14[0..7].iter().sum();
        let count: i64 = daily14[7..14].iter().sum();
        metrics.push(DigestMetric {
            key: spec.key.to_string(),
            label: spec.label.to_string(),
            count,
            prev_count,
            delta: count - prev_count,
            daily: daily14[7..14].to_vec(),
        });
    }

    // active_students: daily series from active_rows, totals from windows.
    let mut active_daily14 = vec![0i64; 14];
    for r in &active_rows {
        if let Some(idx) = day_keys.iter().position(|d| *d == r.day) {
            active_daily14[idx] = r.n;
        }
    }
    metrics.push(DigestMetric {
        key: "active_students".to_string(),
        label: "Active students".to_string(),
        count: active_windows.cur,
        prev_count: active_windows.prev,
        delta: active_windows.cur - active_windows.prev,
        daily: active_daily14[7..14].to_vec(),
    });

    Ok(ActivityDigest { window_days: 7, metrics })
}
```

In `crates/syllabus-tracker/src/db/mod.rs`, add `pub mod dashboard;` and re-export: `pub use dashboard::{activity_digest, ActivityDigest, DigestMetric};` (match the existing re-export style in that file).

- [ ] **Step 4: Run the test to verify it passes**

Run: `cargo test -p syllabus-tracker digest_ -- --nocapture`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add crates/syllabus-tracker/src/db/dashboard.rs crates/syllabus-tracker/src/db/mod.rs crates/syllabus-tracker/src/test/dashboard_digest.rs crates/syllabus-tracker/src/test/mod.rs
git commit -m "feat(dashboard): Add student-activity digest query"
```

---

### Task 2: Dashboard activity feed (peek, engagement-scoped)

**Files:**
- Modify: `crates/syllabus-tracker/src/db/activity_read.rs` (add `dashboard_activity_feed`)
- Modify: `crates/syllabus-tracker/src/db/mod.rs` (re-export)
- Test: `crates/syllabus-tracker/src/test/dashboard_digest.rs` (append)

This returns the most recent student-engagement events gym-wide for a coach glance. It reuses `ActivityRow` but is read-only (no cursor advance) and filters to engagement verbs.

- [ ] **Step 1: Write the failing test**

Append to the `tests` module in `crates/syllabus-tracker/src/test/dashboard_digest.rs`:

```rust
    #[rocket::async_test]
    async fn dashboard_feed_includes_engagement_excludes_coach_curation() {
        use crate::db::dashboard_activity_feed;
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .technique("Armbar", "", Some("coach"))
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();
        let armbar = db.technique_id("Armbar").unwrap();

        let mut tx = db.pool.begin().await.unwrap();
        // Student engagement: should appear.
        emit(&mut tx, NewActivity::new(Verb::AttemptLogged, alice).target_student(alice).technique(armbar)).await.unwrap();
        // Coach curation: should NOT appear in the engagement feed.
        emit(&mut tx, NewActivity::new(Verb::SyllabusTechniqueAdded, coach).target_student(alice).technique(armbar)).await.unwrap();
        tx.commit().await.unwrap();

        let rows = dashboard_activity_feed(&db.pool, 30).await.unwrap();
        assert_eq!(rows.len(), 1, "only the student engagement row");
        assert_eq!(rows[0].verb, "attempt_logged");
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p syllabus-tracker dashboard_feed_includes -- --nocapture`
Expected: FAIL to compile (`dashboard_activity_feed` not found).

- [ ] **Step 3: Implement `dashboard_activity_feed`**

Add to `crates/syllabus-tracker/src/db/activity_read.rs` (it can reuse the `ActivityRow` struct and `notifies` already in that file):

```rust
/// Gym-wide recent student-engagement events for the coach dashboard glance.
/// Read-only: unlike the cursor-advancing `/activity/feed` route, this never
/// touches `activity_cursors`, so opening the dashboard does not clear the
/// navbar unread badge. `unread` is always false here (the dashboard does not
/// render unread styling).
pub async fn dashboard_activity_feed(
    pool: &Pool<Sqlite>,
    limit: i64,
) -> Result<Vec<ActivityRow>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT act.id                AS "id!: i64",
                  act.occurred_at       AS "occurred_at!: String",
                  act.verb              AS "verb!: String",
                  act.actor_user_id     AS "actor_user_id!: i64",
                  u.display_name        AS "actor_name?: String",
                  act.target_student_id AS "target_student_id?: i64",
                  act.technique_id      AS "technique_id?: i64",
                  t.name                AS "technique_name?: String",
                  act.syllabus_id       AS "syllabus_id?: i64",
                  s.name                AS "syllabus_name?: String",
                  act.sst_id            AS "sst_id?: i64",
                  act.video_id          AS "video_id?: i64",
                  v.title               AS "video_title?: String",
                  act.payload_json      AS "payload_json?: String"
           FROM activity act
           JOIN users u           ON u.id = act.actor_user_id
           LEFT JOIN techniques t ON t.id = act.technique_id
           LEFT JOIN syllabi s    ON s.id = act.syllabus_id
           LEFT JOIN videos v     ON v.id = act.video_id
           WHERE (
                   u.role = 'student'
                   AND act.verb IN (
                     'video_watched', 'attempt_logged', 'attempt_edited',
                     'sst_status_changed', 'sst_student_notes_edited', 'technique_pinned'
                   )
                 )
              OR act.verb = 'syllabus_graduated'
           ORDER BY act.occurred_at DESC, act.id DESC
           LIMIT ?"#,
        limit,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| ActivityRow {
            id: r.id,
            occurred_at: r.occurred_at,
            verb: r.verb,
            actor_user_id: r.actor_user_id,
            actor_name: r.actor_name,
            target_student_id: r.target_student_id,
            technique_id: r.technique_id,
            technique_name: r.technique_name,
            syllabus_id: r.syllabus_id,
            syllabus_name: r.syllabus_name,
            sst_id: r.sst_id,
            video_id: r.video_id,
            video_title: r.video_title,
            payload_json: r.payload_json,
            unread: false,
        })
        .collect())
}
```

Re-export in `db/mod.rs`: add `dashboard_activity_feed` to the `activity_read` re-export list.

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test -p syllabus-tracker dashboard_feed_includes -- --nocapture`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/syllabus-tracker/src/db/activity_read.rs crates/syllabus-tracker/src/db/mod.rs crates/syllabus-tracker/src/test/dashboard_digest.rs
git commit -m "feat(dashboard): Add peek activity feed for coach glance"
```

---

### Task 3: Per-student activity timestamps on the students query

**Files:**
- Modify: `crates/syllabus-tracker/src/db/reporting.rs` (`get_students_by_recent_updates` + its DTO)
- Modify: the `User` struct definition (search: `pub struct User` — likely `crates/syllabus-tracker/src/auth.rs`)
- Test: `crates/syllabus-tracker/src/test/dashboard_reporting.rs` (append)

Add `last_student_activity_at` (most recent activity where the student is the actor) and `last_coach_activity_at` (most recent activity targeting the student where the actor is a coach/admin) from the **activity log**, so triage includes attempts/pins/status, not just notes+watches.

- [ ] **Step 1: Write the failing test**

Append to the `tests` module in `crates/syllabus-tracker/src/test/dashboard_reporting.rs`:

```rust
    #[rocket::async_test]
    async fn students_query_exposes_activity_log_timestamps() {
        use crate::db::{NewActivity, Verb, emit};
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .technique("Armbar", "", Some("coach"))
            .build()
            .await
            .unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();
        let armbar = db.technique_id("Armbar").unwrap();

        let mut tx = db.pool.begin().await.unwrap();
        emit(&mut tx, NewActivity::new(Verb::AttemptLogged, alice).target_student(alice).technique(armbar)).await.unwrap();
        emit(&mut tx, NewActivity::new(Verb::SstCoachNotesEdited, coach).target_student(alice).technique(armbar)).await.unwrap();
        tx.commit().await.unwrap();

        let students = get_students_by_recent_updates(&db.pool, true, coach).await.unwrap();
        let alice_row = students.iter().find(|u| u.id == alice).unwrap();
        assert!(alice_row.last_student_activity_at.is_some(), "student-actor activity present");
        assert!(alice_row.last_coach_activity_at.is_some(), "coach-actor activity present");
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p syllabus-tracker students_query_exposes -- --nocapture`
Expected: FAIL to compile (`last_student_activity_at` / `last_coach_activity_at` not fields of `User`).

- [ ] **Step 3a: Add the two `User` fields**

In the `User` struct (find with `grep -rn "pub struct User" crates/syllabus-tracker/src`), add after `last_watch_video_title`:

```rust
    pub last_student_activity_at: Option<String>,
    pub last_coach_activity_at: Option<String>,
```

Then fix every `User { ... }` literal the compiler flags (the test helper `coach_actor` in `dashboard_reporting.rs`, any constructors in `api.rs`, etc.) by adding `last_student_activity_at: None, last_coach_activity_at: None,`. Use `cargo build -p syllabus-tracker 2>&1 | grep "missing field"` to find them all.

- [ ] **Step 3b: Compute the columns in the query**

In `get_students_by_recent_updates`, add to the `UserWithActivityDto` struct (above the fn) two fields:

```rust
    pub last_student_activity_at: Option<chrono::NaiveDateTime>,
    pub last_coach_activity_at: Option<chrono::NaiveDateTime>,
```

Add these correlated subqueries to the SELECT (after the watch subqueries, before `FROM users u`):

```sql
            ,
            (SELECT MAX(a.occurred_at)
               FROM activity a
              WHERE a.target_student_id = u.id
                AND a.actor_user_id = u.id) as "last_student_activity_at?: NaiveDateTime",
            (SELECT MAX(a.occurred_at)
               FROM activity a
               JOIN users au ON au.id = a.actor_user_id
              WHERE a.target_student_id = u.id
                AND a.actor_user_id <> u.id
                AND au.role IN ('coach', 'admin')) as "last_coach_activity_at?: NaiveDateTime"
```

In the `.map(|dto| ...)` body, set the two new `User` fields:

```rust
                last_student_activity_at: dto
                    .last_student_activity_at
                    .map(|dt| naive_to_utc(dt).to_rfc3339()),
                last_coach_activity_at: dto
                    .last_coach_activity_at
                    .map(|dt| naive_to_utc(dt).to_rfc3339()),
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test -p syllabus-tracker students_query_exposes -- --nocapture`
Expected: PASS. Then `cargo build -p syllabus-tracker` clean.

- [ ] **Step 5: Commit**

```bash
git add crates/syllabus-tracker/src
git commit -m "feat(reporting): Expose per-student activity-log timestamps"
```

---

### Task 4: Dashboard routes

**Files:**
- Modify: `crates/syllabus-tracker/src/api.rs` (two routes)
- Modify: `crates/syllabus-tracker/src/main.rs` (mount)
- Test: `crates/syllabus-tracker/src/test/api.rs` (append a route smoke test)

- [ ] **Step 1: Write the failing test**

Append to `crates/syllabus-tracker/src/test/api.rs` (mirror an existing GET test in that file for the client/login helpers):

```rust
    #[rocket::async_test]
    async fn dashboard_digest_route_returns_metrics_for_coach() {
        use crate::test::test_utils::{create_standard_test_db, login_test_user, setup_test_client};
        let db = create_standard_test_db().await;
        let (client, _db) = setup_test_client(db).await;
        let cookie = login_test_user(&client, "coach", "password").await;

        let resp = client
            .get("/api/dashboard/activity_digest")
            .cookie(cookie)
            .dispatch()
            .await;
        assert_eq!(resp.status(), rocket::http::Status::Ok);
        let body = resp.into_string().await.unwrap();
        assert!(body.contains("attempts_logged"));
        assert!(body.contains("active_students"));
    }
```

(Check `create_standard_test_db`'s coach username/password in `test/utils.rs`; adjust the `login_test_user` args to match its actual seeded credentials.)

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p syllabus-tracker dashboard_digest_route -- --nocapture`
Expected: FAIL (404 / route not mounted).

- [ ] **Step 3: Add the routes**

In `crates/syllabus-tracker/src/api.rs`, import `activity_digest` and `dashboard_activity_feed` and the existing `ActivityRow` JSON pattern. Add:

```rust
/// `GET /api/dashboard/activity_digest` (coach/admin only)
#[get("/dashboard/activity_digest")]
pub async fn api_activity_digest(
    db: &State<Pool<Sqlite>>,
    user: User,
) -> Result<Json<crate::db::ActivityDigest>, AppError> {
    if !user.role.is_coach_or_admin() {
        return Err(AppError::Forbidden);
    }
    Ok(Json(activity_digest(db).await?))
}

/// `GET /api/dashboard/activity_feed?limit=` (coach/admin only). Peek: does not
/// advance the read cursor.
#[get("/dashboard/activity_feed?<limit>")]
pub async fn api_dashboard_activity_feed(
    db: &State<Pool<Sqlite>>,
    user: User,
    limit: Option<i64>,
) -> Result<Json<Vec<crate::db::ActivityRow>>, AppError> {
    if !user.role.is_coach_or_admin() {
        return Err(AppError::Forbidden);
    }
    let limit = limit.unwrap_or(30).clamp(1, 100);
    Ok(Json(dashboard_activity_feed(db, limit).await?))
}
```

Match the real patterns already in `api.rs`: the role guard helper (search for how `api_get_students` or the existing activity routes check coach/admin and what error type they return; reuse that, e.g. `is_coach_or_admin`/`Role` check and `AppError::Forbidden` or the project equivalent), and the `State<Pool<Sqlite>>` vs `&State<...>` form.

In `crates/syllabus-tracker/src/main.rs`, add `api_activity_digest` and `api_dashboard_activity_feed` to the `routes![...]` macro where the other `/api` routes are mounted.

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test -p syllabus-tracker dashboard_digest_route -- --nocapture`
Expected: PASS.

- [ ] **Step 5: Regenerate sqlx cache and verify**

Per repo memory `project-sqlx-check-seed-dependency`: build a fresh temp DB, seed it, repoint the `sqlite.db` symlink, `find crates/syllabus-tracker/src -name '*.rs' -exec touch {} +`, `RUSTC_WRAPPER="" cargo sqlx prepare --workspace -- -p syllabus-tracker --tests --all-features`, restore the symlink. Then `just verify`.
Expected: clean; `.sqlx/` diff contains only the new queries.

- [ ] **Step 6: Commit**

```bash
git add crates/syllabus-tracker/src api .sqlx
git commit -m "feat(dashboard): Add digest and feed routes"
```

---

# PR 2 — Reusable frontend primitives

### Task 5: Deterministic student color

**Files:**
- Create: `frontend/src/lib/student-color.ts`
- Test: `frontend/src/lib/student-color.unit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { studentColor, STUDENT_COLOR_PALETTE } from "./student-color";

describe("studentColor", () => {
  it("is deterministic: same id maps to the same pair", () => {
    expect(studentColor(42)).toEqual(studentColor(42));
  });

  it("returns a palette member", () => {
    const c = studentColor(123);
    expect(STUDENT_COLOR_PALETTE).toContainEqual(c);
  });

  it("spreads adjacent ids to different palette entries", () => {
    const a = studentColor(1);
    const b = studentColor(2);
    expect(a).not.toEqual(b);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/lib/student-color.unit.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// Deterministic, stateless per-student color. Seeded on the immutable user id
// (never the name) so a student is the same color forever. Color is a
// secondary identity cue (initials and name carry identity), so palette
// collisions past 12 students are acceptable and there is no legend.

export interface StudentColor {
  /** Low-opacity wash for the avatar background. */
  bg: string;
  /** Bright, legible foreground for the initials. */
  fg: string;
}

// Curated, dark-mode-tuned hues. Each entry is precomputed so we never emit a
// muddy or low-contrast color the way raw hashed HSL would.
export const STUDENT_COLOR_PALETTE: StudentColor[] = [
  { bg: "hsla(210, 65%, 55%, 0.20)", fg: "hsl(210, 80%, 74%)" },
  { bg: "hsla(160, 60%, 50%, 0.20)", fg: "hsl(160, 70%, 68%)" },
  { bg: "hsla(280, 60%, 60%, 0.22)", fg: "hsl(280, 75%, 80%)" },
  { bg: "hsla(35, 75%, 55%, 0.20)", fg: "hsl(35, 85%, 68%)" },
  { bg: "hsla(340, 70%, 58%, 0.20)", fg: "hsl(340, 80%, 76%)" },
  { bg: "hsla(20, 75%, 55%, 0.22)", fg: "hsl(20, 85%, 70%)" },
  { bg: "hsla(95, 55%, 48%, 0.22)", fg: "hsl(95, 65%, 66%)" },
  { bg: "hsla(250, 65%, 62%, 0.22)", fg: "hsl(250, 80%, 80%)" },
  { bg: "hsla(185, 65%, 48%, 0.22)", fg: "hsl(185, 75%, 66%)" },
  { bg: "hsla(310, 60%, 58%, 0.22)", fg: "hsl(310, 75%, 78%)" },
  { bg: "hsla(55, 70%, 50%, 0.20)", fg: "hsl(55, 80%, 68%)" },
  { bg: "hsla(225, 60%, 60%, 0.22)", fg: "hsl(225, 78%, 80%)" },
];

/** Knuth multiplicative hash to scatter sequential ids across the palette. */
export function studentColor(id: number): StudentColor {
  const hashed = Math.imul(id >>> 0, 2654435761) >>> 0;
  return STUDENT_COLOR_PALETTE[hashed % STUDENT_COLOR_PALETTE.length];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/lib/student-color.unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/student-color.ts frontend/src/lib/student-color.unit.test.ts
git commit -m "feat(frontend): Add deterministic student color helper"
```

---

### Task 6: StudentAvatar component

**Files:**
- Create: `frontend/src/components/student-avatar.tsx`
- Test: `frontend/src/components/student-avatar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render } from "vitest-browser-react";
import { expect, test } from "vitest";
import { StudentAvatar } from "./student-avatar";

test("renders initials from a display name", async () => {
  const screen = render(<StudentAvatar id={1} name="Alex Rivera" />);
  await expect.element(screen.getByText("AR")).toBeInTheDocument();
});

test("falls back to a question mark for an empty name", async () => {
  const screen = render(<StudentAvatar id={2} name="" />);
  await expect.element(screen.getByText("?")).toBeInTheDocument();
});
```

(Match the import style of an existing component test, e.g. `frontend/src/components/navbar.test.tsx`, for `render`/`screen` helpers.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/student-avatar.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```tsx
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { studentColor } from "@/lib/student-color";
import { cn } from "@/lib/utils";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface StudentAvatarProps {
  id: number;
  name: string;
  size?: "default" | "sm" | "lg";
  className?: string;
}

/** Avatar tinted by deterministic student identity color. */
export function StudentAvatar({ id, name, size = "default", className }: StudentAvatarProps) {
  const color = studentColor(id);
  return (
    <Avatar size={size} className={cn("shrink-0", className)}>
      <AvatarFallback
        className="font-semibold"
        style={{ backgroundColor: color.bg, color: color.fg }}
      >
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/components/student-avatar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/student-avatar.tsx frontend/src/components/student-avatar.test.tsx
git commit -m "feat(frontend): Add tinted StudentAvatar component"
```

---

### Task 7: Activity coalescing helper + reusable ActivityFeedList

**Files:**
- Create: `frontend/src/lib/activity-coalesce.ts`
- Test: `frontend/src/lib/activity-coalesce.unit.test.ts`
- Create: `frontend/src/components/activity-feed-list.tsx`
- Test: `frontend/src/components/activity-feed-list.test.tsx`

- [ ] **Step 1: Write the failing coalesce test**

`frontend/src/lib/activity-coalesce.unit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { coalesceActivity } from "./activity-coalesce";
import type { ActivityRow } from "./activity-line";

function row(p: Partial<ActivityRow>): ActivityRow {
  return {
    id: 0, occurred_at: "2026-06-11T00:00:00Z", verb: "attempt_logged",
    actor_user_id: 1, actor_name: "Alex", target_student_id: 1,
    technique_id: 1, technique_name: "Armbar", syllabus_id: null, syllabus_name: null,
    sst_id: null, video_id: null, video_title: null, payload_json: null, unread: false,
    ...p,
  };
}

describe("coalesceActivity", () => {
  it("collapses consecutive same-verb same-actor rows", () => {
    const out = coalesceActivity([
      row({ id: 3, technique_name: "Armbar" }),
      row({ id: 2, technique_name: "Triangle" }),
      row({ id: 1, verb: "video_watched", technique_name: "Kimura" }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].count).toBe(2);
    expect(out[0].extraTechniques).toEqual(["Triangle"]);
    expect(out[1].count).toBe(1);
  });

  it("does not merge across different actors", () => {
    const out = coalesceActivity([
      row({ id: 2, actor_user_id: 1 }),
      row({ id: 1, actor_user_id: 2 }),
    ]);
    expect(out).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/lib/activity-coalesce.unit.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the coalesce helper**

`frontend/src/lib/activity-coalesce.ts`:

```ts
import type { ActivityRow } from "./activity-line";

export interface CoalescedActivity {
  /** The representative (most recent) row of the group. */
  row: ActivityRow;
  /** How many rows were merged (1 = no coalescing). */
  count: number;
  /** Distinct other technique names in the group, for "and N more" copy. */
  extraTechniques: string[];
}

/**
 * Collapse runs of consecutive rows that share actor + verb into one entry, so
 * one keen student does not flood the feed. Input must already be sorted newest
 * first (as the feed endpoint returns it).
 */
export function coalesceActivity(rows: ActivityRow[]): CoalescedActivity[] {
  const out: CoalescedActivity[] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (last && last.row.actor_user_id === row.actor_user_id && last.row.verb === row.verb) {
      last.count += 1;
      const name = row.technique_name;
      if (
        name &&
        name !== last.row.technique_name &&
        !last.extraTechniques.includes(name)
      ) {
        last.extraTechniques.push(name);
      }
    } else {
      out.push({ row, count: 1, extraTechniques: [] });
    }
  }
  return out;
}

/**
 * Suffix for a coalesced group, e.g. " and 2 more". Empty when count === 1.
 */
export function coalescedSuffix(item: CoalescedActivity): string {
  if (item.count <= 1) return "";
  const others = item.count - 1;
  return ` and ${others} more`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/lib/activity-coalesce.unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing ActivityFeedList test**

`frontend/src/components/activity-feed-list.test.tsx`:

```tsx
import { MemoryRouter } from "react-router-dom";
import { render } from "vitest-browser-react";
import { expect, test } from "vitest";
import { ActivityFeedList } from "./activity-feed-list";
import type { ActivityRow } from "@/lib/activity-line";

function row(p: Partial<ActivityRow>): ActivityRow {
  return {
    id: 1, occurred_at: new Date().toISOString(), verb: "attempt_logged",
    actor_user_id: 1, actor_name: "Alex Rivera", target_student_id: 1,
    technique_id: 1, technique_name: "Armbar", syllabus_id: null, syllabus_name: null,
    sst_id: null, video_id: null, video_title: null, payload_json: null, unread: false,
    ...p,
  };
}

test("renders a row with actor name and activity line", async () => {
  const screen = render(
    <MemoryRouter>
      <ActivityFeedList rows={[row({})]} isLoading={false} />
    </MemoryRouter>,
  );
  await expect.element(screen.getByText("Alex Rivera")).toBeInTheDocument();
  await expect.element(screen.getByText(/logged an attempt on Armbar/)).toBeInTheDocument();
});

test("shows the empty state when there are no rows", async () => {
  const screen = render(
    <MemoryRouter>
      <ActivityFeedList rows={[]} isLoading={false} emptyText="Nothing yet." />
    </MemoryRouter>,
  );
  await expect.element(screen.getByText("Nothing yet.")).toBeInTheDocument();
});

test("coalesces and shows an 'and N more' suffix", async () => {
  const rows = [row({ id: 2, technique_name: "Armbar" }), row({ id: 1, technique_name: "Triangle" })];
  const screen = render(
    <MemoryRouter>
      <ActivityFeedList rows={rows} isLoading={false} coalesce />
    </MemoryRouter>,
  );
  await expect.element(screen.getByText(/and 1 more/)).toBeInTheDocument();
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/activity-feed-list.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 7: Implement ActivityFeedList**

`frontend/src/components/activity-feed-list.tsx`:

```tsx
import { Link } from "react-router-dom";
import { StudentAvatar } from "@/components/student-avatar";
import { activityLine, type ActivityRow } from "@/lib/activity-line";
import { coalesceActivity, coalescedSuffix } from "@/lib/activity-coalesce";
import { formatRelative } from "@/lib/dates";

interface ActivityFeedListProps {
  rows: ActivityRow[];
  isLoading: boolean;
  /** Collapse consecutive same-actor same-verb rows. Default false. */
  coalesce?: boolean;
  /** Cap the number of (possibly coalesced) entries rendered. */
  maxRows?: number;
  /** Hide the per-row avatar (e.g. a single-student profile feed). Default shows it. */
  showAvatar?: boolean;
  emptyText?: string;
}

/**
 * Presentational activity list shared by the coach dashboard, the student
 * profile, and the full activity page. It renders ActivityRow[] only. callers
 * choose the data source, which is what makes it audience-agnostic (a coach
 * passes student activity, a student passes their own / coach activity).
 */
export function ActivityFeedList({
  rows,
  isLoading,
  coalesce = false,
  maxRows,
  showAvatar = true,
  emptyText = "No recent activity yet.",
}: ActivityFeedListProps) {
  if (isLoading) {
    return (
      <div className="divide-y divide-border">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="px-4 py-3">
            <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-3 w-1/4 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return <p className="px-6 py-8 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }

  const items = coalesce ? coalesceActivity(rows) : rows.map((row) => ({ row, count: 1, extraTechniques: [] }));
  const shown = maxRows ? items.slice(0, maxRows) : items;

  return (
    <ul className="divide-y divide-border">
      {shown.map((item) => {
        const line = activityLine(item.row);
        const text = line.text + coalescedSuffix(item);
        return (
          <li
            key={`${item.row.actor_user_id}-${item.row.id}-${item.row.occurred_at}`}
            className="flex items-center gap-3 px-4 py-3"
          >
            {showAvatar && (
              <StudentAvatar id={item.row.actor_user_id} name={item.row.actor_name ?? "?"} />
            )}
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="truncate text-sm font-medium">{item.row.actor_name ?? "A student"}</p>
              <p className="truncate text-xs text-muted-foreground">
                {line.href ? (
                  <Link to={line.href} className="underline-offset-2 hover:underline">
                    {text}
                  </Link>
                ) : (
                  text
                )}
              </p>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatRelative(item.row.occurred_at)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `cd frontend && npx vitest run src/components/activity-feed-list.test.tsx`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/lib/activity-coalesce.ts frontend/src/lib/activity-coalesce.unit.test.ts frontend/src/components/activity-feed-list.tsx frontend/src/components/activity-feed-list.test.tsx
git commit -m "feat(frontend): Add coalescing helper and reusable ActivityFeedList"
```

---

# PR 3 — Coach dashboard uplift

### Task 8: API types and query hooks

**Files:**
- Modify: `frontend/src/lib/api.ts` (types + fetchers + `User` fields)
- Modify: `frontend/src/lib/queries.ts` (hooks + query keys)

- [ ] **Step 1: Add types and fetchers to `api.ts`**

Add the two optional fields to the `User` type (find `export interface User`):

```ts
  last_student_activity_at?: string | null;
  last_coach_activity_at?: string | null;
```

Add digest types and fetchers (place near the existing activity fetchers; reuse the existing `apiFetch`/`getJson` helper used by `getActivityFeed`):

```ts
export interface DigestMetric {
  key: string;
  label: string;
  count: number;
  prev_count: number;
  delta: number;
  daily: number[];
}

export interface ActivityDigest {
  window_days: number;
  metrics: DigestMetric[];
}

export function getActivityDigest(): Promise<ActivityDigest> {
  return getJson<ActivityDigest>("/api/dashboard/activity_digest");
}

export function getDashboardActivityFeed(limit = 30): Promise<ActivityRow[]> {
  return getJson<ActivityRow[]>(`/api/dashboard/activity_feed?limit=${limit}`);
}
```

(Use whatever the existing fetch helper is named. grep `getActivityFeed` in `api.ts` and copy its exact transport; `ActivityRow` is already imported there.)

- [ ] **Step 2: Add hooks and query keys to `queries.ts`**

Add to the `qk` object (match its existing style):

```ts
  activityDigest: () => ["activity", "digest"] as const,
  dashboardActivityFeed: () => ["activity", "dashboard-feed"] as const,
```

Add the hooks near the other activity hooks:

```ts
export function useActivityDigest(enabled: boolean = true) {
  return useQuery({
    queryKey: qk.activityDigest(),
    queryFn: enabled ? getActivityDigest : skipToken,
    staleTime: 60 * 1000,
  });
}

export function useDashboardActivityFeed(enabled: boolean = true) {
  return useQuery({
    queryKey: qk.dashboardActivityFeed(),
    queryFn: enabled ? () => getDashboardActivityFeed(30) : skipToken,
    staleTime: 30 * 1000,
  });
}
```

Import `getActivityDigest` and `getDashboardActivityFeed` from `@/lib/api`.

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/queries.ts
git commit -m "feat(frontend): Add digest and dashboard-feed queries"
```

---

### Task 9: Sparkline + ActivityDigest component

**Files:**
- Create: `frontend/src/app/dashboard/components/sparkline.tsx`
- Create: `frontend/src/app/dashboard/components/activity-digest.tsx`
- Test: `frontend/src/app/dashboard/components/activity-digest.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "vitest-browser-react";
import { expect, test, vi } from "vitest";
import * as api from "@/lib/api";
import { ActivityDigest } from "./activity-digest";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

test("renders four metric tiles with counts", async () => {
  vi.spyOn(api, "getActivityDigest").mockResolvedValue({
    window_days: 7,
    metrics: [
      { key: "attempts_logged", label: "Attempts logged", count: 37, prev_count: 33, delta: 4, daily: [3,5,4,7,6,9,3] },
      { key: "videos_watched", label: "Videos watched", count: 24, prev_count: 23, delta: 1, daily: [1,2,3,4,3,2,1] },
      { key: "active_students", label: "Active students", count: 11, prev_count: 12, delta: -1, daily: [2,3,2,4,3,5,4] },
      { key: "techniques_pinned", label: "Techniques pinned", count: 8, prev_count: 5, delta: 3, daily: [0,1,1,2,1,2,1] },
    ],
  });
  const screen = render(wrap(<ActivityDigest />));
  await expect.element(screen.getByText("Attempts logged")).toBeInTheDocument();
  await expect.element(screen.getByText("37")).toBeInTheDocument();
  await expect.element(screen.getByText("Active students")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/app/dashboard/components/activity-digest.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the Sparkline**

`frontend/src/app/dashboard/components/sparkline.tsx`:

```tsx
interface SparklineProps {
  values: number[];
  className?: string;
}

/** Tiny bar sparkline. Pure presentational; scales to the local max. */
export function Sparkline({ values, className }: SparklineProps) {
  const max = Math.max(1, ...values);
  return (
    <div className={className} aria-hidden style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 22 }}>
      {values.map((v, i) => (
        <span
          key={i}
          className="flex-1 rounded-sm bg-primary/40 last:bg-primary"
          style={{ height: `${Math.max(8, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Implement the ActivityDigest**

`frontend/src/app/dashboard/components/activity-digest.tsx`:

```tsx
import { useActivityDigest } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { Sparkline } from "./sparkline";

function deltaText(delta: number): string {
  if (delta === 0) return "No change vs last week";
  if (delta > 0) return `Up ${delta} vs last week`;
  return `${Math.abs(delta)} fewer vs last week`;
}

export function ActivityDigest({ className }: { className?: string }) {
  const { data, isLoading, error } = useActivityDigest();

  if (isLoading) {
    return (
      <div className={cn("grid grid-cols-2 gap-3", className)}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    );
  }
  if (error || !data) {
    return (
      <p className={cn("rounded-xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground", className)}>
        Could not load recent activity.
      </p>
    );
  }

  return (
    <div className={cn("grid grid-cols-2 gap-3", className)}>
      {data.metrics.map((m) => (
        <div key={m.key} className="rounded-xl border border-border bg-card p-4">
          <div className="text-2xl font-bold leading-none">{m.count}</div>
          <div className="mt-1 text-xs text-muted-foreground">{m.label}</div>
          <Sparkline values={m.daily} className="mt-2" />
          <div className={cn("mt-2 text-[11px]", m.delta >= 0 ? "text-status-green" : "text-muted-foreground")}>
            {deltaText(m.delta)}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd frontend && npx vitest run src/app/dashboard/components/activity-digest.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/dashboard/components/sparkline.tsx frontend/src/app/dashboard/components/activity-digest.tsx frontend/src/app/dashboard/components/activity-digest.test.tsx
git commit -m "feat(dashboard): Add activity digest tiles"
```

---

### Task 10: Dashboard recent activity feed

**Files:**
- Create: `frontend/src/app/dashboard/components/recent-activity-feed.tsx`
- Test: `frontend/src/app/dashboard/components/recent-activity-feed.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { render } from "vitest-browser-react";
import { expect, test, vi } from "vitest";
import * as api from "@/lib/api";
import { RecentActivityFeed } from "./recent-activity-feed";

test("renders student events", async () => {
  vi.spyOn(api, "getDashboardActivityFeed").mockResolvedValue([
    {
      id: 1, occurred_at: new Date().toISOString(), verb: "attempt_logged",
      actor_user_id: 5, actor_name: "Sam Khan", target_student_id: 5,
      technique_id: 9, technique_name: "Triangle", syllabus_id: null, syllabus_name: null,
      sst_id: null, video_id: null, video_title: null, payload_json: null, unread: false,
    },
  ]);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const screen = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><RecentActivityFeed /></MemoryRouter>
    </QueryClientProvider>,
  );
  await expect.element(screen.getByText("Sam Khan")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/app/dashboard/components/recent-activity-feed.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`frontend/src/app/dashboard/components/recent-activity-feed.tsx`:

```tsx
import { Activity } from "lucide-react";
import { ActivityFeedList } from "@/components/activity-feed-list";
import { useDashboardActivityFeed } from "@/lib/queries";

export function RecentActivityFeed() {
  const { data, isLoading } = useDashboardActivityFeed();
  return (
    <section className="mb-8 overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <Activity className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-semibold">Recent activity</h2>
      </header>
      <ActivityFeedList
        rows={data ?? []}
        isLoading={isLoading}
        coalesce
        maxRows={6}
        emptyText="No recent student activity yet."
      />
    </section>
  );
}
```

The feed shows the six most recent (coalesced) student events with no "see all" link. a richer, browsable feed is a separate future feature, out of scope here.

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/app/dashboard/components/recent-activity-feed.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/dashboard/components/recent-activity-feed.tsx frontend/src/app/dashboard/components/recent-activity-feed.test.tsx
git commit -m "feat(dashboard): Add recent activity feed panel"
```

---

### Task 11: Wire CoachDashboard

**Files:**
- Modify: `frontend/src/app/dashboard/page.tsx`

Replace the donut + roster + recently-active panel on the coach view with the digest and the feed. `StudentDashboard` (and its `StatusDonut`) stay untouched.

- [ ] **Step 1: Edit CoachDashboard**

In `frontend/src/app/dashboard/page.tsx`:
- Remove the import and use of `StatusDonut` **only inside `CoachDashboard`** (keep the import if `StudentDashboard` still uses it; it does).
- Remove `useRecentlyActiveStudents` usage, the `recentlyActiveQuery`, the `RecentlyActivePanel` element, and the `<Tabs>`/`Roster` triage block plus the now-unused `Roster`, `RosterTab`, `rosterDescription`, `RosterCountBadge`, `rosterEmptyMessage`, `recentlyActiveToActivityRow`, `RecentlyActivePanel`, and `STALE_THRESHOLD_DAYS` (if nothing else in the file references them. check first).
- Add imports: `import { ActivityDigest } from './components/activity-digest';` and `import { RecentActivityFeed } from './components/recent-activity-feed';`.
- New CoachDashboard body order:

```tsx
return (
  <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
    <DashboardTotals
      studentCount={studentCount}
      techniqueCount={techniqueCount}
      assignmentCount={totalAssignments}
    />

    <ActivityDigest className="mb-6" />

    <QueuePanel
      pending={pendingApprovals}
      onApprove={handleApprove}
      onSendResetLink={handleSendResetLink}
    />

    <RecentActivityFeed />
  </div>
);
```

(Keep the exact `DashboardTotals` and `QueuePanel` props the file already passes; only the donut, the roster Tabs, and the RecentlyActivePanel are removed.)

- [ ] **Step 2: Type-check and run the dashboard tests**

Run: `cd frontend && npx tsc --noEmit && npx vitest run src/app/dashboard`
Expected: no type errors; dashboard tests pass. Remove any now-dead test that asserted the donut/roster on the coach view, or update it to assert the digest.

- [ ] **Step 3: Visual check**

Run the dev server, view `/dashboard` as a coach. Confirm digest tiles, queue, and feed render; toggle dark mode; check 390px width.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/dashboard/page.tsx frontend/src/app/dashboard
git commit -m "feat(dashboard): Replace donut and roster with digest and feed"
```

---

# PR 4 — Student list activity triage

### Task 12: Triage helper

**Files:**
- Create: `frontend/src/lib/student-triage.ts`
- Test: `frontend/src/lib/student-triage.unit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { categorizeStudent, isStudentLed, TRIAGE_THRESHOLD_DAYS } from "./student-triage";
import type { User } from "./api";

const now = Date.parse("2026-06-11T12:00:00Z");
const recent = "2026-06-10T12:00:00Z";
const old = "2026-05-01T12:00:00Z";

function student(p: Partial<User>): User {
  return { id: 1, username: "x", role: "student", display_name: "X", archived: false, ...p } as User;
}

describe("student triage", () => {
  it("active = recent student activity regardless of coach", () => {
    expect(categorizeStudent(student({ last_student_activity_at: recent, last_coach_activity_at: recent }), now)).toBe("active");
    expect(categorizeStudent(student({ last_student_activity_at: recent, last_coach_activity_at: old }), now)).toBe("active");
  });
  it("student-led = active and no recent coach activity", () => {
    expect(isStudentLed(student({ last_student_activity_at: recent, last_coach_activity_at: old }), now)).toBe(true);
    expect(isStudentLed(student({ last_student_activity_at: recent, last_coach_activity_at: recent }), now)).toBe(false);
  });
  it("coach-led = no recent student activity but recent coach activity", () => {
    expect(categorizeStudent(student({ last_student_activity_at: old, last_coach_activity_at: recent }), now)).toBe("coach_led");
  });
  it("quiet = neither recent", () => {
    expect(categorizeStudent(student({ last_student_activity_at: old, last_coach_activity_at: old }), now)).toBe("quiet");
    expect(categorizeStudent(student({}), now)).toBe("quiet");
  });
  it("threshold is 14 days", () => {
    expect(TRIAGE_THRESHOLD_DAYS).toBe(14);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/lib/student-triage.unit.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import type { User } from "./api";

export type TriageCategory = "active" | "coach_led" | "quiet";

export const TRIAGE_THRESHOLD_DAYS = 14;
const THRESHOLD_MS = TRIAGE_THRESHOLD_DAYS * 86400 * 1000;

function isRecent(ts: string | null | undefined, now: number): boolean {
  if (!ts) return false;
  const parsed = Date.parse(ts);
  return Number.isFinite(parsed) && now - parsed <= THRESHOLD_MS;
}

/** Active iff the student has recent activity of their own (coach activity is
 *  irrelevant here). Otherwise coach-led if the coach updated them recently,
 *  else quiet. */
export function categorizeStudent(student: User, now: number): TriageCategory {
  if (isRecent(student.last_student_activity_at, now)) return "active";
  if (isRecent(student.last_coach_activity_at, now)) return "coach_led";
  return "quiet";
}

/** Refinement of Active: student active, coach not recently involved. */
export function isStudentLed(student: User, now: number): boolean {
  return (
    isRecent(student.last_student_activity_at, now) &&
    !isRecent(student.last_coach_activity_at, now)
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/lib/student-triage.unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/student-triage.ts frontend/src/lib/student-triage.unit.test.ts
git commit -m "feat(frontend): Add student activity-triage helper"
```

---

### Task 13: Rebuild the students-list page

**Files:**
- Modify: `frontend/src/app/students-list/page.tsx`
- Modify: `frontend/src/components/student-row.tsx` (tinted avatar)
- Test: `frontend/src/app/students-list/students-list.test.tsx` (new)

- [ ] **Step 1: Swap StudentRow to the tinted avatar**

In `frontend/src/components/student-row.tsx`, replace the `Avatar`/`AvatarFallback`/local `initials` block with `StudentAvatar`:

```tsx
import { StudentAvatar } from "@/components/student-avatar";
// ...remove the local `initials` fn and the Avatar import if now unused...
// In the JSX, replace:
//   <Avatar size="lg" className="shrink-0"><AvatarFallback>{initials(student)}</AvatarFallback></Avatar>
// with:
<StudentAvatar id={student.id} name={student.display_name || student.username} size="lg" />
```

Run `cd frontend && npx vitest run src/components/student-row*.test.tsx` if such a test exists; otherwise `npx tsc --noEmit`.

- [ ] **Step 2: Write the failing students-list test**

`frontend/src/app/students-list/students-list.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { render } from "vitest-browser-react";
import { expect, test, vi } from "vitest";
import * as api from "@/lib/api";
import StudentsList from "./page";

// Minimal current-user context: the page calls useUser(). Mock it to a coach.
vi.mock("@/lib/current-user", async (orig) => {
  const mod = await orig<typeof import("@/lib/current-user")>();
  return { ...mod, useUser: () => ({ id: 99, role: "coach", username: "coach", display_name: "Coach" }) };
});

const recent = new Date().toISOString();
const old = "2026-01-01T00:00:00Z";

function coachQc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

test("Active tab shows students with recent student activity; Coach-led tab does not", async () => {
  vi.spyOn(api, "getStudents").mockResolvedValue([
    { id: 1, username: "alice", role: "student", display_name: "Alice", archived: false, last_student_activity_at: recent, last_coach_activity_at: old },
    { id: 2, username: "bob", role: "student", display_name: "Bob", archived: false, last_student_activity_at: old, last_coach_activity_at: recent },
  ] as api.User[]);

  const screen = render(
    <QueryClientProvider client={coachQc()}>
      <MemoryRouter initialEntries={["/students"]}><StudentsList /></MemoryRouter>
    </QueryClientProvider>,
  );

  await expect.element(screen.getByText("Alice")).toBeInTheDocument();
  // Bob is coach-led, not in the default Active tab.
  await expect.element(screen.getByText("Bob")).not.toBeInTheDocument();
});
```

(Confirm the actual user-context module path/hook name with `grep -rn "export function useUser" frontend/src`; adjust the `vi.mock` target accordingly. it is `@/lib/current-user` per the imports in `students-list/page.tsx`.)

- [ ] **Step 3: Run to verify it fails**

Run: `cd frontend && npx vitest run src/app/students-list/students-list.test.tsx`
Expected: FAIL (still shows the old lifecycle tabs; Bob present, or assertion mismatch).

- [ ] **Step 4: Rebuild the page**

Rewrite `frontend/src/app/students-list/page.tsx`'s control + filtering logic. Remove `StatusTab`, `STATUS_TABS`, `STATUS_TAB_VALUES`, `isStatusTab`, the graduate/archive lifecycle filtering, and the lifecycle `Tabs`. Keep search, sort, register, and per-row actions.

Key additions:

```tsx
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { categorizeStudent, isStudentLed, type TriageCategory } from "@/lib/student-triage";

type ActivityTab = "active" | "coach_led" | "quiet";
const ACTIVITY_TABS: { value: ActivityTab; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "coach_led", label: "Coach-led" },
  { value: "quiet", label: "Quiet" },
];

function flavour(tab: ActivityTab, studentLedOnly: boolean): string {
  if (tab === "active") {
    return studentLedOnly
      ? "Active on their own, with no recent updates from you."
      : "Students with activity of their own lately, whether or not you've updated them.";
  }
  if (tab === "coach_led") return "You've updated them recently, with no recent activity from the student.";
  return "No recent activity from either side.";
}
```

Replace the search placeholder string `"Search students"` with `"Search for any student"`.

Filtering logic (replace the `filteredStudents` memo). When the search box has text, it searches **all** students regardless of tab:

```tsx
const now = Date.now();
const [studentLedOnly, setStudentLedOnly] = useState(false);
const activityTab: ActivityTab = isActivityTab(searchParams.get("tab")) ? (searchParams.get("tab") as ActivityTab) : "active";

const counts = useMemo(() => {
  let active = 0, studentLed = 0, coach = 0, quiet = 0;
  for (const s of students) {
    const c = categorizeStudent(s, now);
    if (c === "active") { active++; if (isStudentLed(s, now)) studentLed++; }
    else if (c === "coach_led") coach++;
    else quiet++;
  }
  return { active, studentLed, coach, quiet };
}, [students, now]);

const filteredStudents = useMemo(() => {
  const needle = filter.trim().toLowerCase();
  let result = students.filter((s) => {
    if (needle) {
      const name = s.display_name?.toLowerCase() || "";
      return name.includes(needle) || s.username.toLowerCase().includes(needle);
    }
    const c = categorizeStudent(s, now);
    if (activityTab === "active") return c === "active" && (!studentLedOnly || isStudentLed(s, now));
    return c === activityTab;
  });
  if (sortBy === "alphabetical") {
    result = [...result].sort((a, b) =>
      (a.display_name || a.username).localeCompare(b.display_name || b.username));
  }
  return result;
}, [students, filter, sortBy, activityTab, studentLedOnly, now]);
```

Add `isActivityTab` (mirror the old `isStatusTab`) and a `setActivityTab` that writes the `tab` search param (clearing `tab` when `active`, and resetting `studentLedOnly` to false on tab change).

Control JSX (replacing the old lifecycle `<Tabs>` block; keep the sort `<Select>`):

```tsx
<div className="mb-2">
  <Tabs value={activityTab} onValueChange={(v) => setActivityTab(v as ActivityTab)}>
    <TabsList className="w-full sm:w-auto">
      {ACTIVITY_TABS.map(({ value, label }) => {
        const n = value === "active" ? counts.active : value === "coach_led" ? counts.coach : counts.quiet;
        return (
          <TabsTrigger key={value} value={value} className="flex-1 px-2 sm:flex-initial sm:px-3">
            {label}
            <span className="ml-1.5 text-[10px] opacity-70">{n}</span>
          </TabsTrigger>
        );
      })}
    </TabsList>
  </Tabs>
</div>

{activityTab === "active" && (
  <div className="mb-2 flex items-center gap-2">
    <Badge
      variant={!studentLedOnly ? "default" : "outline"}
      className="cursor-pointer select-none"
      onClick={() => setStudentLedOnly(false)}
    >
      Everyone
    </Badge>
    <Badge
      variant={studentLedOnly ? "default" : "outline"}
      className="cursor-pointer select-none"
      onClick={() => setStudentLedOnly(true)}
    >
      Student-led <span className="ml-1 opacity-70">{counts.studentLed}</span>
    </Badge>
  </div>
)}

<p className="mb-4 text-xs text-muted-foreground">{flavour(activityTab, studentLedOnly)}</p>
```

(The sort `<Select>` stays as-is. Place it inline to the right of the chip row or on its own line; either is fine.)

- [ ] **Step 5: Run to verify it passes**

Run: `cd frontend && npx vitest run src/app/students-list/students-list.test.tsx`
Expected: PASS.

- [ ] **Step 6: Type-check + visual check**

Run: `cd frontend && npx tsc --noEmit`. Then view `/students` as a coach: tabs filter, the Student-led chip narrows Active, search finds students across tabs, avatars are tinted, dark mode + 390px OK.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/students-list/page.tsx frontend/src/components/student-row.tsx frontend/src/app/students-list/students-list.test.tsx
git commit -m "feat(students): Replace lifecycle tabs with activity triage"
```

---

# PR 5 — Profile reuse and cleanup

### Task 14: Refactor student-profile to reuse ActivityFeedList

**Files:**
- Modify: `frontend/src/app/student-profile/page.tsx`
- Check: `frontend/src/app/student-profile/student-profile-activity.test.tsx` still passes

- [ ] **Step 1: Replace the inline activity block**

In `student-profile/page.tsx`, replace the hand-rolled "Recent activity" loading/empty/list block (the one driven by `feedQuery`) with:

```tsx
<section className="space-y-2">
  <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
    <History className="h-3.5 w-3.5" aria-hidden />
    Recent activity
  </h2>
  <div className="overflow-hidden rounded-lg border border-border bg-card">
    <ActivityFeedList
      rows={feedQuery.data ?? []}
      isLoading={feedQuery.isLoading}
      showAvatar={false}
      emptyText="No recent activity yet."
    />
  </div>
</section>
```

`showAvatar={false}` because the profile is already a single student's context. Remove now-unused imports (the manual `activityLine`/`Link`/`formatRelative` usage in that block, if not used elsewhere in the file). Add `import { ActivityFeedList } from '@/components/activity-feed-list';`.

- [ ] **Step 2: Run the existing profile test**

Run: `cd frontend && npx vitest run src/app/student-profile`
Expected: PASS (the regression test that this feed is the student-scoped one still holds; we changed presentation, not the data source).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/student-profile/page.tsx
git commit -m "refactor(profile): Reuse ActivityFeedList for recent activity"
```

---

### Task 15: Remove dead recently-active code

**Files:**
- Modify: `frontend/src/lib/queries.ts`, `frontend/src/lib/api.ts` (remove `useRecentlyActiveStudents` + fetcher if unused)
- Modify: `crates/syllabus-tracker/src/api.rs`, `db/activity_read.rs`, `db/mod.rs` (remove `recently_active_students` route + fn if unused)

- [ ] **Step 1: Confirm no remaining references**

Run: `grep -rn "recentlyActive\|recently_active\|RecentlyActive" frontend/src crates/syllabus-tracker/src`
Expected: only the definitions remain (no consumers after Task 11).

- [ ] **Step 2: Remove them**

Delete `useRecentlyActiveStudents`, `getRecentlyActiveStudents`, the `RecentlyActiveStudent` type, `recently_active_students` (Rust fn), its route, the `qk.recentlyActiveStudents` key, and the route from `main.rs`. Leave anything still referenced.

- [ ] **Step 3: Verify the whole build**

Run: `cd frontend && npx tsc --noEmit && npx vitest run` then from repo root `just verify`.
Expected: green. Regenerate the `.sqlx/` cache if any Rust query was removed (see Task 4 Step 5).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(activity): Remove unused recently-active code"
```

---

## Self-review notes (already reconciled)

- **No full `/activity` page.** A richer, social-style browsable feed is a separate future feature, out of scope. The dashboard feed shows six rows with no "see all" link.
- **Existing `last_student_initiative_at` / `last_coach_update_at` are SST/watch proxies** (they miss attempts). Task 3 adds activity-log-derived `last_student_activity_at` / `last_coach_activity_at` instead; the old fields are left untouched for their existing consumers.
- **Digest window (7d) vs triage threshold (14d)** are intentionally different (recent pulse vs staleness) and are separate constants.
- **Peek (no cursor advance):** the dashboard feed (Task 2) never advances the read cursor, so opening the dashboard does not clear the navbar unread badge.
- **Reuse coverage:** `ActivityFeedList` is consumed by the dashboard feed (Task 10) and the student profile (Task 14), and is the natural base for the future social feed; `StudentAvatar` by the feed list and `StudentRow` (Task 13); the `Badge` chip pattern and `Tabs` are reused from the library page and the old students list.
```
