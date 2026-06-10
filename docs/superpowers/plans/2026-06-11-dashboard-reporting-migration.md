# Dashboard & Reporting Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repoint the coach dashboard student list, the student's own dashboard, and the per-technique library stats from the legacy `student_techniques` / `attempts` tables onto the new syllabus stack (`syllabus_assignments` / `student_syllabus_techniques` / `syllabus_attempts`), preserving response shapes.

**Architecture:** Mostly backend read-swaps. Surfaces NOT shared with the dormant legacy `student-techniques` page (the coach `/api/students` list and the per-technique stats endpoint) are repointed IN PLACE, preserving their DTOs so the frontend is untouched. The student dashboard shares its reads (`useStudentTechniques`, attempt endpoints) with the legacy page, so it gets NEW syllabus-backed endpoints + hooks and the dashboard is repointed onto them; the legacy endpoints and legacy page are left exactly as-is for the separate decommission PR.

**Tech Stack:** Rust + Rocket + sqlx (SQLite, offline `.sqlx/` cache), chrono; React + TanStack Query frontend.

**Decisions locked in (from the requester):**
- Coach-list status counts SUM across all active syllabi (a technique in two syllabi counts twice), not distinct.
- `has_unseen_activity` uses a SIMPLE heuristic with no per-coach memory: the student has student-side activity more recent than the coach-side activity. Do NOT wire the PR2 activity cursor here.
- Single stacked PR on top of `roadmap/activity-02-read-side`.
- Repoint only. Do NOT delete legacy tables, legacy endpoints, or the legacy `student-techniques` page; that is the separate decommission (target 2026-09-10).

**Repo conventions (read before starting):**
- Schema/migrations: none needed (no new tables). All tables already exist.
- After ANY change to a `sqlx::query!` / `query_scalar!` / `query_as!`, run `just sqlx-prepare` and commit the regenerated `.sqlx/` in the SAME commit. CI runs `just sqlx-check`.
- Backend tests run OFFLINE: `just test-backend` (`SQLX_OFFLINE=true cargo nextest`). Run `just sqlx-prepare` BEFORE `just test-backend` whenever queries changed. Tests are `#[rocket::async_test]` + `TestDbBuilder` (see `crates/syllabus-tracker/src/test/pinned.rs`). Build SST data with `create_syllabus` / `assign` / `add_technique_to_assignment` / `update_sst` / `create_syllabus_attempt`.
- lefthook pre-commit runs `cargo clippy --workspace --all-targets --all-features -D warnings`; keep warning-clean. `just fmt` before committing Rust.
- Frontend gate: `pnpm -C frontend lint`, `pnpm -C frontend build`, `pnpm -C frontend test`. The browser test project cannot run on the dev box (NixOS Chromium); lint + build are the hard local gates, browser `.test.tsx` are CI-validated. Run `pnpm -C frontend test activity-line` for the node project.
- No em-dashes in copy or comments.
- Commit format: `type(scope): Capitalized imperative summary`, sparse bullets, NO co-author trailer. Do NOT push (controller pushes after review).

---

## File Structure

**Modify (backend):**
- `crates/syllabus-tracker/src/db/reporting.rs` — rewrite `get_students_by_recent_updates` onto the syllabus stack (Task 1).
- `crates/syllabus-tracker/src/db/syllabus_attempts.rs` — add student-scoped aggregate reads: recent attempts, heatmap buckets (Task 2).
- `crates/syllabus-tracker/src/db/student_syllabus_techniques.rs` — add a flat per-student SST list (Task 2).
- `crates/syllabus-tracker/src/db/techniques.rs` — rewrite `library_technique_stats` status + attempt reads onto the new tables (Task 4).
- `crates/syllabus-tracker/src/api.rs` + `main.rs` — three new student-dashboard routes (Task 2).
- `crates/syllabus-tracker/src/test/` — tests per task.

**Modify (frontend, Task 3):**
- `frontend/src/lib/query-keys.ts`, `frontend/src/lib/api.ts`, `frontend/src/lib/queries.ts` — new hooks for the new endpoints.
- `frontend/src/app/dashboard/page.tsx` — repoint the `StudentDashboard` section onto the new hooks.

**Reused DTOs (no shape change):** `User` (coach-list fields), `AttemptListItem`, `AttemptBucket`, `AttemptSummary`, `LibraryTechniqueStats` — all in `crates/syllabus-tracker/src/models.rs`.

---

## Task 1: Repoint coach student list onto the syllabus stack

**Files:**
- Modify: `crates/syllabus-tracker/src/db/reporting.rs:52-170` (`get_students_by_recent_updates`)
- Test: `crates/syllabus-tracker/src/test/` (add a test module or extend an existing dashboard test file; create `crates/syllabus-tracker/src/test/dashboard_reporting.rs` and register `mod dashboard_reporting;` in `crates/syllabus-tracker/src/test/mod.rs`)

The current query aggregates over `student_techniques` + `student_technique_views`. Rewrite it to aggregate over active assignments' SST rows. The `User` output struct and all its dashboard fields stay identical, so `/api/students` and the frontend do not change. The watch subqueries (`video_watch_aggregates`) are NOT legacy and stay verbatim.

- [ ] **Step 1: Write the failing test**

Create `crates/syllabus-tracker/src/test/dashboard_reporting.rs`:

```rust
#[cfg(test)]
mod tests {
    use crate::db::{
        add_technique_to_assignment, assign, create_syllabus, get_students_by_recent_updates,
        update_sst, SstUpdate,
    };
    use crate::auth::{Role, User};
    use crate::test::test_utils::TestDbBuilder;

    fn coach_actor(id: i64) -> User {
        User {
            id, username: "c".into(), role: Role::Coach, display_name: String::new(),
            archived: false, graduated_at: None, email: None, claimed_at: None,
            approved_at: None, first_name: None, last_name: None, reset_requested_at: None,
            last_update: None, last_coach_update_at: None, total_techniques: None,
            red_count: None, amber_count: None, green_count: None, has_unseen_activity: None,
            last_student_initiative_at: None, last_watch_at: None, last_watch_video_title: None,
        }
    }
    fn student_actor(id: i64) -> User { let mut u = coach_actor(id); u.role = Role::Student; u }

    #[rocket::async_test]
    async fn counts_sum_across_active_syllabi_not_distinct() {
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .technique("Armbar", "", Some("coach"))
            .build().await.unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();
        let armbar = db.technique_id("Armbar").unwrap();

        // Two syllabi, both assigned to alice, both containing Armbar -> 2 SST rows
        // for the same technique. Counts must SUM (total 2), not dedupe to 1.
        for name in ["S1", "S2"] {
            let sid = create_syllabus(&db.pool, name, None, coach).await.unwrap();
            let aid = assign(&db.pool, coach, alice, sid).await.unwrap();
            add_technique_to_assignment(&db.pool, aid, armbar, coach).await.unwrap();
        }

        let students = get_students_by_recent_updates(&db.pool, false, coach).await.unwrap();
        let alice_row = students.iter().find(|u| u.id == alice).unwrap();
        assert_eq!(alice_row.total_techniques, Some(2));
        assert_eq!(alice_row.red_count, Some(2)); // default status red
    }

    #[rocket::async_test]
    async fn unseen_flag_set_when_student_activity_newer_than_coach() {
        let db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .technique("Armbar", "", Some("coach"))
            .build().await.unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();
        let armbar = db.technique_id("Armbar").unwrap();
        let sid = create_syllabus(&db.pool, "S", None, coach).await.unwrap();
        let aid = assign(&db.pool, coach, alice, sid).await.unwrap();
        let sst = add_technique_to_assignment(&db.pool, aid, armbar, coach).await.unwrap();

        // Coach writes coach notes first, then the student writes student notes
        // (student activity is now the most recent) -> unseen = true.
        update_sst(&db.pool, sst, &coach_actor(coach),
            &SstUpdate { coach_notes: Some("c".into()), ..Default::default() }).await.unwrap();
        update_sst(&db.pool, sst, &student_actor(alice),
            &SstUpdate { student_notes: Some("s".into()), ..Default::default() }).await.unwrap();

        let students = get_students_by_recent_updates(&db.pool, false, coach).await.unwrap();
        let alice_row = students.iter().find(|u| u.id == alice).unwrap();
        assert_eq!(alice_row.has_unseen_activity, Some(true));
    }
}
```

Register the module: add `mod dashboard_reporting;` to `crates/syllabus-tracker/src/test/mod.rs`.

- [ ] **Step 2: Run to verify it fails**

Run: `just sqlx-prepare && just test-backend` (or focused: `SQLX_OFFLINE=true cargo nextest run -p syllabus-tracker dashboard_reporting`)
Expected: FAIL (current implementation counts legacy `student_techniques`, which these students have none of, so totals are 0).

- [ ] **Step 3: Rewrite the query**

Replace the `sqlx::query_as!` block in `get_students_by_recent_updates` (keep the surrounding `UserWithActivityDto` mapping and the `include_archived` filter; keep the two `video_watch_aggregates` subqueries verbatim). New query body:

```rust
    let dtos = sqlx::query_as!(
        UserWithActivityDto,
        r#"
        SELECT
            u.id, u.username, u.display_name, u.role, u.archived,
            u.graduated_at as "graduated_at?: NaiveDateTime",
            u.email,
            u.claimed_at as "claimed_at?: NaiveDateTime",
            u.approved_at as "approved_at?: NaiveDateTime",
            u.first_name, u.last_name,
            u.reset_requested_at as "reset_requested_at?: NaiveDateTime",
            MAX(sst.updated_at) as "last_update?: NaiveDateTime",
            MAX(sst.last_coach_update_at) as "last_coach_update_at?: NaiveDateTime",
            COUNT(sst.id) as "total_techniques?: i64",
            COALESCE(SUM(CASE WHEN sst.status = 'red'   THEN 1 ELSE 0 END), 0) as "red_count?: i64",
            COALESCE(SUM(CASE WHEN sst.status = 'amber' THEN 1 ELSE 0 END), 0) as "amber_count?: i64",
            COALESCE(SUM(CASE WHEN sst.status = 'green' THEN 1 ELSE 0 END), 0) as "green_count?: i64",
            -- Simple unseen heuristic, no per-coach memory: the student has
            -- student-side activity strictly newer than any coach-side activity.
            -- datetime(...) wrapping normalises mixed timestamp text formats.
            CASE
                WHEN MAX(sst.last_student_update_at) IS NULL THEN 0
                WHEN MAX(sst.last_coach_update_at) IS NULL THEN 1
                WHEN datetime(MAX(sst.last_student_update_at)) > datetime(MAX(sst.last_coach_update_at)) THEN 1
                ELSE 0
            END as "has_unseen_activity?: i64",
            MAX(sst.last_student_update_at) as "latest_student_note_at?: NaiveDateTime",
            (SELECT MAX(last_watched_at)
               FROM video_watch_aggregates
              WHERE user_id = u.id) as "latest_watch_at?: NaiveDateTime",
            (SELECT v.title
               FROM video_watch_aggregates a
               JOIN videos v ON v.id = a.video_id
              WHERE a.user_id = u.id AND v.deleted_at IS NULL
              ORDER BY a.last_watched_at DESC
              LIMIT 1) as "latest_watch_video_title?: String"
        FROM users u
        LEFT JOIN syllabus_assignments sa
               ON sa.student_id = u.id AND sa.unassigned_at IS NULL
        LEFT JOIN student_syllabus_techniques sst
               ON sst.assignment_id = sa.id AND sst.hidden_at IS NULL
        WHERE u.role = 'student'
        GROUP BY u.id
        ORDER BY MAX(sst.updated_at) DESC NULLS LAST
        "#,
    )
    .fetch_all(pool)
    .await?;
```

The `viewer_id` parameter is no longer used by the query (the unseen heuristic is per-coach-agnostic). Keep the function signature unchanged (the route passes it) but rename the binding to `_viewer_id` to satisfy clippy, and add a one-line comment: `// viewer_id retained for signature stability; the unseen rule no longer uses per-coach view state.` Remove the now-unused `viewer_id` bind from the query. The `UserWithActivityDto` struct and the `.map(...)` below stay unchanged (same field names).

- [ ] **Step 4: Regenerate cache and run tests**

Run: `just sqlx-prepare && just test-backend`
Expected: PASS (both new tests, and the existing suite stays green).

- [ ] **Step 5: Commit**

```bash
git add crates/syllabus-tracker/src/db/reporting.rs crates/syllabus-tracker/src/test/dashboard_reporting.rs crates/syllabus-tracker/src/test/mod.rs .sqlx/
git commit -m "feat(dashboard): Drive coach student list from the syllabus stack"
```

---

## Task 2: New student-dashboard backend reads + routes

**Files:**
- Modify: `crates/syllabus-tracker/src/db/student_syllabus_techniques.rs` (add `list_sst_flat_for_student`)
- Modify: `crates/syllabus-tracker/src/db/syllabus_attempts.rs` (add `list_recent_syllabus_attempts_for_student`, `syllabus_attempt_buckets_for_student`)
- Modify: `crates/syllabus-tracker/src/api.rs` (3 new routes) + `crates/syllabus-tracker/src/main.rs` (register)
- Test: `crates/syllabus-tracker/src/test/dashboard_reporting.rs`

These are NEW reads (the legacy endpoints stay for the dormant legacy page). They reuse the `AttemptListItem` and `AttemptBucket` DTOs and a small new `StudentSyllabusTechniqueOverview` DTO.

- [ ] **Step 1: Write the failing test**

Add to `crates/syllabus-tracker/src/test/dashboard_reporting.rs` `tests` module:

```rust
    #[rocket::async_test]
    async fn recent_syllabus_attempts_scoped_to_student() {
        use crate::db::{create_syllabus_attempt, list_recent_syllabus_attempts_for_student,
            CreateSyllabusAttempt};
        let db = TestDbBuilder::new()
            .coach("coach", None).student("alice", None)
            .technique("Armbar", "", Some("coach"))
            .build().await.unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();
        let armbar = db.technique_id("Armbar").unwrap();
        let sid = create_syllabus(&db.pool, "S", None, coach).await.unwrap();
        let aid = assign(&db.pool, coach, alice, sid).await.unwrap();
        let sst = add_technique_to_assignment(&db.pool, aid, armbar, coach).await.unwrap();
        create_syllabus_attempt(&db.pool, &coach_actor(coach), sst,
            &CreateSyllabusAttempt {
                attempted_at: chrono::Utc::now().naive_utc(),
                coach_note: None, student_note: None,
            }).await.unwrap();

        let recent = list_recent_syllabus_attempts_for_student(&db.pool, alice, 5).await.unwrap();
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].technique_name, "Armbar");
    }

    #[rocket::async_test]
    async fn flat_sst_list_spans_all_active_assignments() {
        use crate::db::list_sst_flat_for_student;
        let db = TestDbBuilder::new()
            .coach("coach", None).student("alice", None)
            .technique("Armbar", "", Some("coach"))
            .technique("Triangle", "", Some("coach"))
            .build().await.unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();
        let sid = create_syllabus(&db.pool, "S", None, coach).await.unwrap();
        let aid = assign(&db.pool, coach, alice, sid).await.unwrap();
        add_technique_to_assignment(&db.pool, aid, db.technique_id("Armbar").unwrap(), coach).await.unwrap();
        add_technique_to_assignment(&db.pool, aid, db.technique_id("Triangle").unwrap(), coach).await.unwrap();

        let rows = list_sst_flat_for_student(&db.pool, alice).await.unwrap();
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().all(|r| r.status == "red"));
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `SQLX_OFFLINE=true cargo nextest run -p syllabus-tracker dashboard_reporting` (after a prepare it will fail to compile: missing functions)
Expected: FAIL (functions not defined).

- [ ] **Step 3a: Add the flat SST list**

In `crates/syllabus-tracker/src/db/student_syllabus_techniques.rs`, add:

```rust
/// A flat, cross-assignment view of one student's SST rows for the student's
/// own dashboard "currently working / recently done" widgets. Spans every
/// active (unassigned_at IS NULL) assignment; excludes soft-hidden rows.
#[derive(Debug, Serialize)]
pub struct StudentSyllabusTechniqueOverview {
    pub sst_id: i64,
    pub technique_id: i64,
    pub technique_name: String,
    pub syllabus_id: i64,
    pub syllabus_name: String,
    pub status: String,
    pub updated_at: String,
    pub last_attempt_at: Option<String>,
}

#[instrument]
pub async fn list_sst_flat_for_student(
    pool: &Pool<Sqlite>,
    student_id: i64,
) -> Result<Vec<StudentSyllabusTechniqueOverview>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT sst.id AS "sst_id!: i64",
                  sst.technique_id AS "technique_id!: i64",
                  t.name AS "technique_name!: String",
                  sa.syllabus_id AS "syllabus_id!: i64",
                  s.name AS "syllabus_name!: String",
                  sst.status AS "status!: String",
                  sst.updated_at AS "updated_at!: NaiveDateTime",
                  (SELECT MAX(attempted_at) FROM syllabus_attempts
                    WHERE student_syllabus_technique_id = sst.id) AS "last_attempt_at?: NaiveDateTime"
           FROM student_syllabus_techniques sst
           JOIN syllabus_assignments sa ON sa.id = sst.assignment_id
           JOIN syllabi s ON s.id = sa.syllabus_id
           JOIN techniques t ON t.id = sst.technique_id
           WHERE sa.student_id = ? AND sa.unassigned_at IS NULL AND sst.hidden_at IS NULL
           ORDER BY sst.updated_at DESC"#,
        student_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| StudentSyllabusTechniqueOverview {
        sst_id: r.sst_id,
        technique_id: r.technique_id,
        technique_name: r.technique_name,
        syllabus_id: r.syllabus_id,
        syllabus_name: r.syllabus_name,
        status: r.status,
        updated_at: rfc3339(r.updated_at),
        last_attempt_at: r.last_attempt_at.map(rfc3339),
    }).collect())
}
```

(`rfc3339` and `Serialize` are already imported in this file.)

- [ ] **Step 3b: Add the syllabus-attempt aggregate reads**

In `crates/syllabus-tracker/src/db/syllabus_attempts.rs`, add (mirrors the legacy `list_recent_attempts_for_student` and `attempt_buckets_for_student` in `db/attempts.rs`, swapping `attempts JOIN student_techniques` for `syllabus_attempts JOIN student_syllabus_techniques JOIN syllabus_assignments`; reuses `AttemptListItem` + `AttemptBucket` from `crate::models`):

```rust
use crate::models::{AttemptBucket, AttemptListItem};

/// Recent attempts across all of a student's active assignments, newest first.
/// Mirrors the legacy `list_recent_attempts_for_student` shape on the new
/// tables. `AttemptListItem.student_technique_id` carries the SST id here.
#[instrument]
pub async fn list_recent_syllabus_attempts_for_student(
    pool: &Pool<Sqlite>,
    student_id: i64,
    limit: i64,
) -> Result<Vec<AttemptListItem>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT sa.id AS "id!: i64",
                  sa.student_syllabus_technique_id AS "sst_id!: i64",
                  sst.technique_id AS "technique_id!: i64",
                  t.name AS "technique_name!: String",
                  sa.attempted_at AS "attempted_at!: NaiveDateTime",
                  sa.coach_note, sa.student_note
           FROM syllabus_attempts sa
           JOIN student_syllabus_techniques sst ON sst.id = sa.student_syllabus_technique_id
           JOIN syllabus_assignments asn ON asn.id = sst.assignment_id
           JOIN techniques t ON t.id = sst.technique_id
           WHERE asn.student_id = ?
           ORDER BY sa.attempted_at DESC, sa.id DESC
           LIMIT ?"#,
        student_id, limit,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| AttemptListItem {
        id: r.id,
        student_technique_id: r.sst_id,
        technique_id: r.technique_id,
        technique_name: r.technique_name,
        attempted_at: chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(r.attempted_at, chrono::Utc),
        coach_note: r.coach_note,
        student_note: r.student_note,
    }).collect())
}

/// Daily attempt-count buckets across all of a student's assignments, for the
/// dashboard heatmap. Mirrors legacy `attempt_buckets_for_student`.
#[instrument]
pub async fn syllabus_attempt_buckets_for_student(
    pool: &Pool<Sqlite>,
    student_id: i64,
    from: chrono::NaiveDate,
    to: chrono::NaiveDate,
) -> Result<Vec<AttemptBucket>, AppError> {
    let from_str = from.format("%Y-%m-%d").to_string();
    let to_str = to.format("%Y-%m-%d").to_string();
    let rows = sqlx::query!(
        r#"SELECT date(sa.attempted_at) as "date!: String",
                  COUNT(*) as "count!: i64"
           FROM syllabus_attempts sa
           JOIN student_syllabus_techniques sst ON sst.id = sa.student_syllabus_technique_id
           JOIN syllabus_assignments asn ON asn.id = sst.assignment_id
           WHERE asn.student_id = ?
             AND date(sa.attempted_at) >= ? AND date(sa.attempted_at) <= ?
           GROUP BY date(sa.attempted_at)
           ORDER BY 1"#,
        student_id, from_str, to_str,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().filter_map(|r| {
        chrono::NaiveDate::parse_from_str(&r.date, "%Y-%m-%d").ok()
            .map(|date| AttemptBucket { date, count: r.count })
    }).collect())
}
```

- [ ] **Step 3c: Add the three routes**

In `crates/syllabus-tracker/src/api.rs`, add three routes with the owner-or-coach guard (mirror the existing `/api/student/<id>/attempts/recent` and `/heatmap` handlers for query-param parsing of `limit` / `from` / `to`; reuse their `*Params` query structs or define siblings). Use distinct paths so they do not collide with the legacy ones:

```rust
#[get("/student/<id>/syllabus_techniques")]
pub async fn api_student_syllabus_techniques_flat(
    id: i64, user: User, db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<Vec<crate::db::StudentSyllabusTechniqueOverview>>> {
    if user.id != id && !user.has_permission(Permission::ViewAllStudents) {
        return Err(Status::Forbidden.into());
    }
    Ok(Json(crate::db::list_sst_flat_for_student(db, id).await?))
}

#[get("/student/<id>/syllabus_attempts/recent?<params..>")]
pub async fn api_student_recent_syllabus_attempts(
    id: i64, params: RecentAttemptsParams, user: User, db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<Vec<crate::models::AttemptListItem>>> {
    if user.id != id && !user.has_permission(Permission::ViewAllStudents) {
        return Err(Status::Forbidden.into());
    }
    let limit = params.limit.unwrap_or(5).clamp(1, 50);
    Ok(Json(crate::db::list_recent_syllabus_attempts_for_student(db, id, limit).await?))
}

#[get("/student/<id>/syllabus_attempts/heatmap?<params..>")]
pub async fn api_student_syllabus_attempt_heatmap(
    id: i64, params: HeatmapParams, user: User, db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<Vec<crate::models::AttemptBucket>>> {
    if user.id != id && !user.has_permission(Permission::ViewAllStudents) {
        return Err(Status::Forbidden.into());
    }
    // Reuse the same default window the legacy heatmap route uses.
    let (from, to) = resolve_heatmap_window(&params);
    Ok(Json(crate::db::syllabus_attempt_buckets_for_student(db, id, from, to).await?))
}
```

Find the existing legacy handlers (`grep -n "attempts/recent\|attempts/heatmap" crates/syllabus-tracker/src/api.rs`, lines ~1738 and ~1807) and REUSE their query-param structs (`RecentAttemptsParams`, `HeatmapParams`) and the from/to defaulting logic (`resolve_heatmap_window` may need extracting from the legacy handler body into a small shared helper; if it is inline, copy the same default-window logic). Register all three handler names in the `routes![...]` mount list in `crates/syllabus-tracker/src/main.rs` next to the other `/student/<id>/...` routes.

- [ ] **Step 4: Regenerate cache and run tests**

Run: `just sqlx-prepare && just test-backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/syllabus-tracker/src/db/student_syllabus_techniques.rs crates/syllabus-tracker/src/db/syllabus_attempts.rs crates/syllabus-tracker/src/api.rs crates/syllabus-tracker/src/main.rs crates/syllabus-tracker/src/test/dashboard_reporting.rs .sqlx/
git commit -m "feat(dashboard): Add syllabus-backed student dashboard reads and routes"
```

---

## Task 3: Repoint the student dashboard frontend onto the new endpoints

**Files:**
- Modify: `frontend/src/lib/query-keys.ts`, `frontend/src/lib/api.ts`, `frontend/src/lib/queries.ts`
- Modify: `frontend/src/app/dashboard/page.tsx` (the `StudentDashboard` section, ~line 419-460)

The legacy `useStudentTechniques`, `useRecentAttempts`, `useAttemptHeatmap` hooks stay (the legacy page uses them). Add new hooks pointed at the Task 2 endpoints and switch only the dashboard's `StudentDashboard` onto them.

- [ ] **Step 1: Add query keys**

In `frontend/src/lib/query-keys.ts`, add (matching the existing `qk.*` hierarchical style):

```ts
studentSyllabusTechniquesFlat: (studentId: number) =>
  ["student", studentId, "syllabusTechniquesFlat"] as const,
studentRecentSyllabusAttempts: (studentId: number, limit: number) =>
  ["student", studentId, "recentSyllabusAttempts", limit] as const,
studentSyllabusAttemptHeatmap: (studentId: number) =>
  ["student", studentId, "syllabusAttemptHeatmap"] as const,
```

- [ ] **Step 2: Add fetchers + hooks**

In `frontend/src/lib/api.ts`, add fetchers calling `/api/student/${id}/syllabus_techniques`, `/api/student/${id}/syllabus_attempts/recent?limit=${limit}`, `/api/student/${id}/syllabus_attempts/heatmap` (mirror the existing `getStudentTechniques` / `getRecentAttempts` / `getAttemptHeatmap` fetchers and their return types; the recent + heatmap responses reuse the existing `RecentAttemptItem` / heatmap bucket types since the backend reuses `AttemptListItem` / `AttemptBucket`). Add a `StudentSyllabusTechniqueOverview` TS type for the flat list (`sst_id, technique_id, technique_name, syllabus_id, syllabus_name, status, updated_at, last_attempt_at`).

In `frontend/src/lib/queries.ts`, add `useStudentSyllabusTechniquesFlat(studentId)`, `useRecentSyllabusAttempts(studentId, limit)`, `useSyllabusAttemptHeatmap(studentId)` mirroring the existing `useStudentTechniques` / `useRecentAttempts` / `useAttemptHeatmap` hooks but with the new keys + fetchers.

- [ ] **Step 3: Repoint `StudentDashboard`**

In `frontend/src/app/dashboard/page.tsx`, in the `StudentDashboard` component (~line 419):
- Replace `useStudentTechniques(user.id)` with `useStudentSyllabusTechniquesFlat(user.id)`.
- Replace `useRecentAttempts(user.id, 5)` with `useRecentSyllabusAttempts(user.id, 5)`.
- Replace `useAttemptHeatmap(user.id)` with `useSyllabusAttemptHeatmap(user.id)`.
- Update the `currentlyWorking` / `recentlyDone` `useMemo` derivations to read the new flat-overview shape (`status`, `updated_at`, `technique_name`) instead of the legacy `StudentTechnique` shape. Keep the same visual output (currently working = non-green ordered by recency, recently done = green ordered by recency, or whatever the current derivation does, mapped onto the new fields).
- Remove the now-unused legacy imports from this file IF they are not used elsewhere in the same file (the coach section may still use some; check before removing). Leave the legacy hooks defined in `queries.ts`.

- [ ] **Step 4: Verify frontend gate**

Run: `pnpm -C frontend lint && pnpm -C frontend build`
Expected: both pass. (Browser tests run in CI.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/query-keys.ts frontend/src/lib/api.ts frontend/src/lib/queries.ts frontend/src/app/dashboard/page.tsx
git commit -m "feat(dashboard): Point student dashboard at syllabus-backed reads"
```

---

## Task 4: Repoint per-technique library stats onto the new tables

**Files:**
- Modify: `crates/syllabus-tracker/src/db/techniques.rs:200-290` (`library_technique_stats`)
- Test: `crates/syllabus-tracker/src/test/dashboard_reporting.rs`

`/api/library/stats` already returns only `total_techniques` (from the `techniques` table) and needs no change. The per-technique `library_technique_stats` (`/api/techniques/<id>/stats`) reads `student_techniques` (status counts) and `attempts` (30d count + weekly buckets). Swap those two reads to the new tables; keep `video_watch_aggregates` (video plays, non-legacy) verbatim; leave the `collections` membership read as-is (collections are a separate legacy decommission, out of scope here). The `LibraryTechniqueStats` DTO is unchanged, so the frontend does not change.

- [ ] **Step 1: Write the failing test**

Add to `crates/syllabus-tracker/src/test/dashboard_reporting.rs`:

```rust
    #[rocket::async_test]
    async fn library_stats_status_counts_come_from_sst() {
        use crate::db::library_technique_stats;
        let db = TestDbBuilder::new()
            .coach("coach", None).student("alice", None)
            .technique("Armbar", "", Some("coach"))
            .build().await.unwrap();
        let coach = db.user_id("coach").unwrap();
        let alice = db.user_id("alice").unwrap();
        let armbar = db.technique_id("Armbar").unwrap();
        let sid = create_syllabus(&db.pool, "S", None, coach).await.unwrap();
        let aid = assign(&db.pool, coach, alice, sid).await.unwrap();
        let sst = add_technique_to_assignment(&db.pool, aid, armbar, coach).await.unwrap();
        update_sst(&db.pool, sst, &student_actor(alice),
            &SstUpdate { status: Some("green".into()), ..Default::default() }).await.unwrap();

        let stats = library_technique_stats(&db.pool, armbar).await.unwrap();
        assert_eq!(stats.status_counts.green, 1);
        assert_eq!(stats.status_counts.red, 0);
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `SQLX_OFFLINE=true cargo nextest run -p syllabus-tracker dashboard_reporting::tests::library_stats`
Expected: FAIL (legacy reads `student_techniques`, which is empty, so green count is 0).

- [ ] **Step 3: Swap the two reads**

In `library_technique_stats`, replace the status-counts query's `FROM student_techniques WHERE technique_id = ?` with the SST equivalent scoped to active assignments:

```rust
    let status_row = sqlx::query!(
        r#"SELECT
            COALESCE(SUM(CASE WHEN sst.status = 'red'   THEN 1 ELSE 0 END), 0) AS "red!: i64",
            COALESCE(SUM(CASE WHEN sst.status = 'amber' THEN 1 ELSE 0 END), 0) AS "amber!: i64",
            COALESCE(SUM(CASE WHEN sst.status = 'green' THEN 1 ELSE 0 END), 0) AS "green!: i64"
           FROM student_syllabus_techniques sst
           JOIN syllabus_assignments sa ON sa.id = sst.assignment_id
           WHERE sst.technique_id = ? AND sa.unassigned_at IS NULL AND sst.hidden_at IS NULL"#,
        technique_id,
    ).fetch_one(pool).await?;
```

Replace the `attempts_30d` count and the weekly-bucket query's `FROM attempts a JOIN student_techniques st ON st.id = a.student_technique_id WHERE st.technique_id = ?` with the syllabus-attempt path:

```rust
    // attempts in the last 30 days for this technique, across the new tables
    let attempts_30d_row = sqlx::query!(
        r#"SELECT COUNT(*) AS "count!: i64"
           FROM syllabus_attempts sa
           JOIN student_syllabus_techniques sst ON sst.id = sa.student_syllabus_technique_id
           WHERE sst.technique_id = ?
             AND sa.attempted_at >= datetime('now', '-30 days')"#,
        technique_id,
    ).fetch_one(pool).await?;
```

And the weekly buckets:

```rust
    let bucket_rows = sqlx::query!(
        r#"SELECT date(sa.attempted_at, 'weekday 0', '-6 days') as "week_start!: String",
                  COUNT(*) as "count!: i64"
           FROM syllabus_attempts sa
           JOIN student_syllabus_techniques sst ON sst.id = sa.student_syllabus_technique_id
           WHERE sst.technique_id = ?
             AND sa.attempted_at >= datetime('now', '-84 days')
           GROUP BY date(sa.attempted_at, 'weekday 0', '-6 days')
           ORDER BY 1"#,
        technique_id,
    ).fetch_all(pool).await?;
```

Keep the rest of the function (collections list, video plays, the `LibraryTechniqueStats` assembly) unchanged.

- [ ] **Step 4: Regenerate cache and run tests**

Run: `just sqlx-prepare && just test-backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/syllabus-tracker/src/db/techniques.rs crates/syllabus-tracker/src/test/dashboard_reporting.rs .sqlx/
git commit -m "feat(dashboard): Source per-technique library stats from the syllabus stack"
```

---

## Task 5: Full verification, PR, CI, staging

- [ ] **Step 1: Run the gates**

Run: `just sqlx-check && just test-backend && pnpm -C frontend lint && pnpm -C frontend build`
Expected: all pass. (`just unused-deps` may report the four pre-existing unused deps that CI does not run; ignore them.)

- [ ] **Step 2: Open the PR (stacked on the activity branch)**

```bash
git push -u origin HEAD
gh pr create --base roadmap/activity-02-read-side --title "feat(dashboard): Dashboard and reporting migration to the syllabus stack" --body "<scope summary; preserves response shapes; legacy endpoints + legacy student-techniques page untouched for the separate decommission>"
```

- [ ] **Step 3: Confirm CI green**, fix any failures (esp. frontend browser tests).

- [ ] **Step 4: Deploy the branch to staging** via `gh workflow run staging.yml -f branch=<branch> -f refresh_db=false -f allow_destructive_migrations=false` and confirm success.

---

## Self-review notes (coverage)

- Coach student list off legacy -> Task 1 (sum counts, simple unseen, watch fields preserved, `User` DTO unchanged, frontend untouched).
- Student dashboard off legacy -> Tasks 2 (new reads + routes) + 3 (frontend repoint); legacy endpoints + legacy page untouched (new endpoints/paths).
- Library stats off legacy -> Task 4 (`library_technique_stats` status + attempts swapped; `/api/library/stats` already non-legacy; collections membership left for the collections decommission).
- Repoint-only boundary honored: no legacy tables, routes, or the legacy `student-techniques` page are deleted.
- Shapes preserved: `User`, `AttemptListItem`, `AttemptBucket`, `LibraryTechniqueStats` reused unchanged; new `StudentSyllabusTechniqueOverview` only for the flat list the legacy shape did not cover cleanly.
```