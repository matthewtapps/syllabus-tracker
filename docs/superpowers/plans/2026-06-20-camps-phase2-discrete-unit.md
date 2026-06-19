# Camps Phase 2: Camp as a Discrete Attachable Unit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let students contribute footage and threads to a camp, and add camp-scoped technique discussion plus camp-only-vs-global technique videos, keeping coach-only authoring of camp techniques and the global library.

**Architecture:** Additive change on top of the existing generic camp. Student write surfaces relax two existing coach-only guards (camp video upload, camp-level threads). The new camp-scoped technique discussion adds a `camp_technique` thread anchor (camp_id + technique_id, mirroring the existing `pinned_technique` two-id anchor) that is never surfaced on the global-library technique view. Camp-only technique videos reuse the existing `camp_technique_referenced_videos` association.

**Tech Stack:** Rust (Rocket, sqlx, SQLite), React 19 + Vite + shadcn/ui + TanStack Query, `cargo nextest`, `just`. Depends on Phase 1 (`docs/superpowers/plans/2026-06-20-camps-phase1-remove-competitions.md`) being merged first.

**Spec:** `docs/superpowers/specs/2026-06-20-camps-redesign-remove-competitions-design.md`

---

## Conventions for every task

- Backend test: `nix develop .#ci --command env SQLX_OFFLINE=true cargo nextest run --workspace --all-features` (filter with `-E 'test(name)'`).
- After **any** sqlx query change, regenerate cache: `nix develop .#ci --command just sqlx-prepare`. Never bare `cargo sqlx prepare` on the seeded dev DB.
- After schema changes, apply locally with `just migrate` (these are additive, non-destructive).
- Test harness lives in `crates/syllabus-tracker/src/test/`; use `TestDbBuilder`, `create_standard_test_db`, `setup_test_client`, and `login_as`/`login_test_user` (see existing `src/test/camps.rs`). Tests are `#[rocket::async_test]`.
- Standard test DB users: `coach_user` (coach), `student_user` (student). Add a second student where a non-owner is needed.
- Frontend `.test.tsx` run only in CI Chromium (not on this NixOS box); stub `window.fetch`, use `renderWithProviders` + `buildUser` (see `reference-vitest-browser-fetch-stub`).
- Commit messages: imperative, scoped, NO co-author trailer.

---

## Task 1: Student can upload footage to their own camp

**Files:**
- Modify: `crates/syllabus-tracker/src/videos/routes.rs` (`api_camp_video_upload`, ~217-298)
- Test: `crates/syllabus-tracker/src/test/camps.rs`

- [ ] **Step 1: Write the failing tests**

Add to the `mod tests` block in `src/test/camps.rs` (model them on `coach_uploads_video_to_camp`, ~400):

```rust
#[rocket::async_test]
async fn student_uploads_video_to_own_camp() {
    use crate::test::test_utils::{create_standard_test_db, setup_test_client};
    let test_db = create_standard_test_db().await;
    // coach creates a camp for student_user
    let camp_id = {
        use crate::db::camps::{create_camp, NewCamp};
        create_camp(&test_db.pool, NewCamp {
            student_id: test_db.student_id, coach_id: test_db.coach_id,
            name: "Camp".into(), description: None, references_camp_id: None,
        }).await.unwrap()
    };
    let (client, _db) = setup_test_client(test_db).await;
    login_as(&client, "student_user").await;

    let body = multipart_video_body(); // existing helper used by coach upload test
    let resp = client
        .post(format!("/api/camps/{camp_id}/videos/upload"))
        .header(multipart_content_type())
        .body(body)
        .dispatch()
        .await;
    assert_eq!(resp.status(), rocket::http::Status::Ok);
}

#[rocket::async_test]
async fn student_cannot_upload_to_another_students_camp() {
    use crate::test::test_utils::{create_standard_test_db, setup_test_client};
    let test_db = create_standard_test_db().await;
    // camp owned by a DIFFERENT student
    let other_student = test_db.add_student("other_student", Some("Otto")).await;
    let camp_id = {
        use crate::db::camps::{create_camp, NewCamp};
        create_camp(&test_db.pool, NewCamp {
            student_id: other_student, coach_id: test_db.coach_id,
            name: "Other".into(), description: None, references_camp_id: None,
        }).await.unwrap()
    };
    let (client, _db) = setup_test_client(test_db).await;
    login_as(&client, "student_user").await;

    let resp = client
        .post(format!("/api/camps/{camp_id}/videos/upload"))
        .header(multipart_content_type())
        .body(multipart_video_body())
        .dispatch()
        .await;
    assert_eq!(resp.status(), rocket::http::Status::Forbidden);
}
```

Note: reuse the multipart helpers the existing `coach_uploads_video_to_camp` test already uses; match their exact names. If `add_student` / `student_id` / `coach_id` accessors differ on the test DB type, mirror whatever `create_standard_test_db` exposes (check `src/test/test_utils.rs`).

- [ ] **Step 2: Run to verify they fail**

Run: `nix develop .#ci --command env SQLX_OFFLINE=true cargo nextest run -E 'test(student_uploads_video_to_own_camp) + test(student_cannot_upload_to_another_students_camp)'`
Expected: FAIL — student upload currently 403 (coach-only `ManageCamps` guard).

- [ ] **Step 3: Relax the guard to coach-or-owner**

In `src/videos/routes.rs`, `api_camp_video_upload`, replace the `user.require_permission(Permission::ManageCamps)?;` line with a coach-or-camp-owner check:

```rust
// Coaches (ManageCamps) may upload to any camp; the camp's own student may
// upload their own footage. Anyone else is forbidden.
let camp = crate::db::camps::get_camp(pool, camp_id)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("camp #{camp_id} not found")))?;
let is_coach = user.has_permission(Permission::ManageCamps);
if !is_coach && user.id != camp.student_id {
    return Err(AppError::Forbidden);
}
```

Use whatever the codebase's existing forbidden/permission idiom is (`user.has_permission`, `AppError::Forbidden`, or the local equivalent already used in `camps/routes.rs`'s `can_read`). Keep the rest of the handler unchanged.

- [ ] **Step 4: Run the tests**

Run: `nix develop .#ci --command env SQLX_OFFLINE=true cargo nextest run -E 'test(student_uploads_video_to_own_camp) + test(student_cannot_upload_to_another_students_camp) + test(coach_uploads_video_to_camp)'`
Expected: PASS (coach path still works).

- [ ] **Step 5: Commit**

```bash
git add crates/syllabus-tracker/src/videos/routes.rs crates/syllabus-tracker/src/test/camps.rs
git commit -m "feat(camps): let a student upload footage to their own camp"
```

---

## Task 2: Student can start a camp-level thread

**Files:**
- Modify: `crates/syllabus-tracker/src/threads/routes.rs` (`api_create_thread`, the `AnchorKind::Camp` branch, ~62-95)
- Test: `crates/syllabus-tracker/src/test/threads.rs` (or `camps.rs`)

- [ ] **Step 1: Write the failing tests**

Add (mirroring existing camp-thread tests; check whether a `create_camp` + camp thread helper already exists in the test module):

```rust
#[rocket::async_test]
async fn student_creates_camp_level_thread_on_own_camp() {
    // arrange: coach creates a camp for student_user, log in as student_user
    // act: POST /api/threads { anchor_kind: "camp", anchor_id: camp_id, body, visibility: "broadcast" }
    // assert: 200/Created, and the thread is stored visibility='private' scoped to the camp's student
}

#[rocket::async_test]
async fn student_cannot_create_camp_thread_on_another_students_camp() {
    // arrange: camp owned by other_student, log in as student_user
    // act: same POST
    // assert: Forbidden
}
```

Fill the bodies using the same request shape the existing coach camp-thread test uses (the create-thread JSON body fields are `anchor_kind`, `anchor_id`, `body`, `visibility`, `scope_student_id`).

- [ ] **Step 2: Run to verify they fail**

Run: `nix develop .#ci --command env SQLX_OFFLINE=true cargo nextest run -E 'test(student_creates_camp_level_thread_on_own_camp) + test(student_cannot_create_camp_thread_on_another_students_camp)'`
Expected: FAIL — the `Camp` branch currently calls `require_permission(ManageCamps)` (coach-only).

- [ ] **Step 3: Allow coach-or-owner for camp threads**

In `src/threads/routes.rs`, change the `AnchorKind::Camp` branch so the camp's own student is also allowed. Replace the coach-only require with:

```rust
let (visibility, scope_student_id) = if kind == AnchorKind::Camp {
    let camp_student = sqlx::query_scalar!(
        "SELECT student_id FROM camps WHERE id = ?", req.anchor_id
    )
    .fetch_optional(pool.inner())
    .await
    .map_err(|_| Status::InternalServerError)?
    .ok_or(Status::NotFound)?;
    // Coach may post on any camp; the camp's student may post on their own.
    let is_coach = user.has_permission(Permission::ManageCamps);
    if !is_coach && user.id != camp_student {
        return Err(Status::Forbidden);
    }
    // Camp threads are inherently private, scoped to the camp's student.
    (ThreadVisibility::Private, Some(camp_student))
} else {
    (visibility, req.scope_student_id)
};
```

Also remove `AnchorKind::Camp` from the `if !is_coach && kind != AnchorKind::Camp { ... }` later guard if that guard would now double-reject the student (the camp branch above already authorizes). Keep the exact query-return type (`student_id` typing) consistent with the existing code.

- [ ] **Step 4: Run the tests**

Run: `nix develop .#ci --command env SQLX_OFFLINE=true cargo nextest run -E 'test(camp_thread)'`
Expected: PASS, including the prior coach camp-thread tests.

- [ ] **Step 5: Regenerate sqlx cache (query body changed) and commit**

Run: `nix develop .#ci --command just sqlx-prepare`

```bash
git add crates/syllabus-tracker/src/threads/routes.rs crates/syllabus-tracker/src/test crates/syllabus-tracker/.sqlx
git commit -m "feat(camps): let a student start a camp-level thread on their own camp"
```

---

## Task 3: Add the `camp_technique` thread anchor (schema + db)

**Files:**
- Modify: `config/schema.sql` (threads `anchor_kind` CHECK list + a new CHECK arm)
- Modify: `crates/syllabus-tracker/src/db/threads.rs` (`AnchorKind`, `Anchor`, `anchor_columns`, `validate_anchor`)
- Test: `crates/syllabus-tracker/src/test/threads.rs`

- [ ] **Step 1: Extend the schema**

In `config/schema.sql`, in the `threads.anchor_kind` CHECK `IN (...)` list, add `'camp_technique'`. Add a new CHECK arm in the exclusive-arc block:

```sql
(anchor_kind='camp_technique'  AND camp_id IS NOT NULL AND technique_id IS NOT NULL AND student_id IS NULL AND video_id IS NULL AND video_ts_seconds IS NULL AND sst_id IS NULL) OR
```

(Place it alongside the existing `camp` arm; adjust the existing `camp` arm only if needed so the two are mutually exclusive — `camp` keeps `technique_id IS NULL`.) Add an index:

```sql
CREATE INDEX IF NOT EXISTS idx_threads_camp_technique ON threads(camp_id, technique_id) WHERE anchor_kind='camp_technique' AND deleted_at IS NULL;
```

Apply: `just migrate`. Expected: applies cleanly.

- [ ] **Step 2: Write the failing db test**

Add to `src/test/threads.rs`:

```rust
#[rocket::async_test]
async fn camp_technique_thread_stores_camp_and_technique() {
    use crate::db::threads::{create_thread, Anchor, AnchorKind, NewThread, ThreadVisibility};
    // arrange: build db, create coach+student, a technique, a camp, attach technique to camp
    // (use create_camp + add_camp_technique from crate::db::camps)
    let anchor = Anchor {
        kind: AnchorKind::CampTechnique,
        id: technique_id,
        video_ts_seconds: None,
        pinned_student_id: None,
        camp_id: Some(camp_id),
    };
    let id = create_thread(&db.pool, NewThread {
        author_id: coach_id,
        anchor,
        visibility: ThreadVisibility::Private,
        scope_student_id: Some(student_id),
        body: "camp technique note".into(),
    }).await.unwrap();

    let row = sqlx::query!(
        r#"SELECT anchor_kind, camp_id AS "camp_id?: i64", technique_id AS "technique_id?: i64" FROM threads WHERE id = ?"#,
        id
    ).fetch_one(&db.pool).await.unwrap();
    assert_eq!(row.anchor_kind, "camp_technique");
    assert_eq!(row.camp_id, Some(camp_id));
    assert_eq!(row.technique_id, Some(technique_id));
}
```

- [ ] **Step 3: Run to verify it fails**

Run: `nix develop .#ci --command env SQLX_OFFLINE=true cargo nextest run -E 'test(camp_technique_thread_stores_camp_and_technique)'`
Expected: FAIL — `AnchorKind::CampTechnique` and `Anchor.camp_id` do not exist yet (compile error).

- [ ] **Step 4: Extend the db layer**

In `src/db/threads.rs`:
- Add `CampTechnique` to `enum AnchorKind`, plus `as_str_kind` arm `AnchorKind::CampTechnique => "camp_technique"` and `from_str_kind` arm `"camp_technique" => Some(AnchorKind::CampTechnique)`.
- Add a `camp_id: Option<i64>` field to `struct Anchor` (doc: "Only set for `camp_technique` (anchor is the (camp, technique) pair)."). Update every existing `Anchor { ... }` constructor to set `camp_id: None` (the compiler lists them).
- In `anchor_columns`, add: `AnchorKind::CampTechnique => (None, Some(anchor.id), None, None, None, anchor.camp_id),` (technique_id from `id`, camp_id from `camp_id`).
- In `validate_anchor`, add a `CampTechnique` arm verifying the technique is attached to the camp:

```rust
AnchorKind::CampTechnique => {
    let camp_id = anchor.camp_id.ok_or_else(|| {
        AppError::Validation("camp_technique anchor requires a camp".to_string())
    })?;
    sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM camp_techniques WHERE camp_id = ? AND technique_id = ?) AS "e!: i64""#,
        camp_id, anchor.id
    ).fetch_one(pool).await?
}
```

- Update `broadcast_allowed` (the `allows_broadcast` matcher) to NOT include `CampTechnique` (camp-technique threads are always private/scoped), so the existing matrix rejects a broadcast camp_technique thread.

- [ ] **Step 5: Run the test + regen cache**

Run: `nix develop .#ci --command just sqlx-prepare` then
`nix develop .#ci --command env SQLX_OFFLINE=true cargo nextest run -E 'test(camp_technique_thread_stores_camp_and_technique)'`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add config/schema.sql crates/syllabus-tracker/src/db/threads.rs crates/syllabus-tracker/src/test/threads.rs crates/syllabus-tracker/.sqlx
git commit -m "feat(camps): add camp_technique thread anchor"
```

---

## Task 4: camp_technique threads via the route, isolated from the global library

**Files:**
- Modify: `crates/syllabus-tracker/src/threads/routes.rs` (`api_create_thread` parse/authorize; `api_list_threads` query by camp+technique)
- Test: `crates/syllabus-tracker/src/test/threads.rs`

- [ ] **Step 1: Write the failing isolation test**

```rust
#[rocket::async_test]
async fn camp_technique_thread_not_visible_on_global_technique() {
    // arrange: coach+student, technique T, camp C for student with T attached.
    // act 1: POST /api/threads { anchor_kind:"camp_technique", anchor_id: T, camp_id: C, body, visibility:"private", scope_student_id: student }
    //        (the create-thread request needs a camp_id field — see Step 3)
    // act 2: GET /api/threads?anchor_kind=technique&anchor_id=T   (global library view)
    // assert: the camp_technique thread does NOT appear in act 2's list.
    // act 3: GET /api/threads?anchor_kind=camp_technique&anchor_id=T&camp_id=C
    // assert: the thread DOES appear here.
}

#[rocket::async_test]
async fn student_can_start_camp_technique_thread_on_own_camp() {
    // student_user posts a camp_technique thread on their own camp's technique -> 200/Created
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `nix develop .#ci --command env SQLX_OFFLINE=true cargo nextest run -E 'test(camp_technique_thread_not_visible_on_global_technique) + test(student_can_start_camp_technique_thread_on_own_camp)'`
Expected: FAIL — the route does not parse `camp_id` or handle the new anchor/authorization yet.

- [ ] **Step 3: Thread the camp_id through the create-thread request**

In `src/threads/routes.rs`, add `camp_id: Option<i64>` to the create-thread request struct (the one with `anchor_kind`, `anchor_id`, `visibility`, `scope_student_id`). When building the `Anchor`, set `camp_id: req.camp_id`. Add a `CampTechnique` branch to the authorization logic mirroring Task 2's camp branch:

```rust
} else if kind == AnchorKind::CampTechnique {
    let camp_id = req.camp_id.ok_or(Status::BadRequest)?;
    let camp_student = sqlx::query_scalar!(
        "SELECT student_id FROM camps WHERE id = ?", camp_id
    ).fetch_optional(pool.inner()).await.map_err(|_| Status::InternalServerError)?
     .ok_or(Status::NotFound)?;
    let is_coach = user.has_permission(Permission::ManageCamps);
    if !is_coach && user.id != camp_student {
        return Err(Status::Forbidden);
    }
    // Audience = the camp's student + coaches: private, scoped to that student.
    (ThreadVisibility::Private, Some(camp_student))
}
```

Ensure the generic `if !is_coach && kind != AnchorKind::Camp { ... }` non-coach guard also exempts `CampTechnique` (it is authorized above).

- [ ] **Step 4: List camp_technique threads by (camp, technique)**

In `api_list_threads`, accept an optional `camp_id` query param. When `anchor_kind=camp_technique`, query threads `WHERE anchor_kind='camp_technique' AND technique_id = ? AND camp_id = ?`. Confirm the existing `anchor_kind=technique` list query filters on `anchor_kind='technique'` (so it never returns camp_technique rows); if it filters only by `technique_id`, add the `anchor_kind='technique'` predicate so global library views exclude camp-scoped threads.

- [ ] **Step 5: Run the tests + regen cache**

Run: `nix develop .#ci --command just sqlx-prepare` then
`nix develop .#ci --command env SQLX_OFFLINE=true cargo nextest run -E 'test(camp_technique)'`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/syllabus-tracker/src/threads/routes.rs crates/syllabus-tracker/src/test/threads.rs crates/syllabus-tracker/.sqlx
git commit -m "feat(camps): camp-scoped technique threads isolated from the library"
```

---

## Task 5: Camp-technique videos — camp-only vs global

**Files:**
- Modify: `crates/syllabus-tracker/src/db/camps.rs` (add camp-only-video helpers over `camp_technique_referenced_videos`)
- Modify: `crates/syllabus-tracker/src/camps/routes.rs` (route to add a video to a camp technique with a scope flag) + mount in `src/main.rs`
- Test: `crates/syllabus-tracker/src/test/camps.rs`

- [ ] **Step 1: Write the failing tests**

```rust
#[rocket::async_test]
async fn coach_adds_camp_only_video_to_camp_technique() {
    // arrange: coach, student, technique T attached to camp C, an existing video V.
    // act: POST /api/camps/{C}/techniques/{T}/videos { video_id: V, scope: "camp_only" }
    // assert: 200; row exists in camp_technique_referenced_videos(C,T,V);
    //         V's global technique-video list for T does NOT include V.
}

#[rocket::async_test]
async fn coach_adds_global_video_to_camp_technique() {
    // act: POST /api/camps/{C}/techniques/{T}/videos { video_id: V, scope: "global" }
    // assert: 200; V appears on the global technique-video list for T (parent_kind='technique').
}

#[rocket::async_test]
async fn student_cannot_add_video_to_camp_technique() {
    // login student_user, same POST -> Forbidden
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `nix develop .#ci --command env SQLX_OFFLINE=true cargo nextest run -E 'test(camp_only_video) + test(global_video_to_camp_technique) + test(student_cannot_add_video_to_camp_technique)'`
Expected: FAIL — route/helpers do not exist.

- [ ] **Step 3: Add the db helper**

In `src/db/camps.rs` add:

```rust
/// Pin an existing video as camp-only reference footage for a technique in a
/// camp. Idempotent (INSERT OR IGNORE on the (camp,technique,video) PK).
#[instrument(skip(pool))]
pub async fn add_camp_technique_video(
    pool: &Pool<Sqlite>, camp_id: i64, technique_id: i64, video_id: i64,
) -> Result<(), AppError> {
    sqlx::query!(
        r#"INSERT OR IGNORE INTO camp_technique_referenced_videos (camp_id, technique_id, video_id)
           VALUES (?, ?, ?)"#,
        camp_id, technique_id, video_id,
    ).execute(pool).await?;
    Ok(())
}
```

For the `global` scope, reuse the existing technique-video attach path (the `parent_kind='technique'` link used by `api_video_link` in `videos/routes.rs`); do not write a `camp_technique_referenced_videos` row.

- [ ] **Step 4: Add the route (coach-only)**

In `src/camps/routes.rs` add a handler:

```rust
#[derive(Deserialize)]
pub struct AddCampTechniqueVideoReq { pub video_id: i64, pub scope: String } // "camp_only" | "global"

#[instrument(skip(req, pool, user))]
#[post("/camps/<camp_id>/techniques/<technique_id>/videos", data = "<req>")]
pub async fn api_add_camp_technique_video(
    camp_id: i64, technique_id: i64,
    req: rocket::serde::json::Json<AddCampTechniqueVideoReq>,
    pool: &State<Pool<Sqlite>>, user: User,
) -> Result<Status, AppError> {
    user.require_permission(Permission::ManageCamps)?; // coach-only: technique authoring
    match req.scope.as_str() {
        "camp_only" => crate::db::camps::add_camp_technique_video(pool, camp_id, technique_id, req.video_id).await?,
        "global" => { /* attach as a normal technique video via the existing technique-video link helper */ }
        _ => return Err(AppError::Validation("scope must be camp_only or global".into())),
    }
    Ok(Status::Ok)
}
```

Match the crate's actual handler signature/return idiom (look at neighbouring camp handlers). Add `api_add_camp_technique_video` to the `routes![]` mount in `src/main.rs` and the `use camps::{...}` import.

- [ ] **Step 5: Run the tests + regen cache**

Run: `nix develop .#ci --command just sqlx-prepare` then
`nix develop .#ci --command env SQLX_OFFLINE=true cargo nextest run -E 'test(camp_only_video) + test(global_video_to_camp_technique) + test(student_cannot_add_video_to_camp_technique)'`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/syllabus-tracker config/schema.sql
git commit -m "feat(camps): add camp-only vs global videos on a camp technique"
```

---

## Task 6: Frontend — surface student footage, camp threads, camp-technique discussion

**REQUIRED SUB-SKILL:** Use `shadcn-ui-design` for this task (project React + shadcn/ui + Tailwind v4 conventions, RHF+Zod+TracedForm).

**Files:**
- Modify: `frontend/src/app/camps/[id]/page.tsx` (camp detail surface)
- Modify: `frontend/src/components/technique-row/*` (camp-context discussion + camp-only video block — reuse the unified `TechniqueRow`, see `feedback-unified-technique-row`)
- Modify: `frontend/src/lib/queries.ts`, `frontend/src/lib/mutations.ts`, `frontend/src/lib/query-keys.ts`, `frontend/src/lib/api.ts`

- [ ] **Step 1: Add API client + query/mutation hooks**

In `lib/api.ts` add calls for: student camp-video upload (already POST `/api/camps/:id/videos/upload`), create camp thread (`anchor_kind: "camp"`), create/list camp_technique thread (`anchor_kind: "camp_technique"` with `camp_id`), add camp-technique video (`POST /api/camps/:id/techniques/:tid/videos` with `scope`). Add matching hooks + query keys.

- [ ] **Step 2: Camp detail — student footage + camp-level threads**

On `app/camps/[id]/page.tsx`: show the camp footage upload control to the camp's student and to coaches; render camp-level threads with a composer open to both. Gate coach-only controls (add/reorder technique, add camp-technique video) behind the coach role.

- [ ] **Step 3: Camp-technique discussion in the technique row**

In the camp context, the unified `TechniqueRow` discussion block lists camp_technique threads (`anchor_kind=camp_technique&anchor_id=<tid>&camp_id=<cid>`) and lets both coach and student post. This is a distinct view-context from the library row (see `view-context.ts` / `technique-row-context.ts`): the library row must not render camp threads.

- [ ] **Step 4: Coach camp-only/global video choice**

When a coach adds a video to a technique inside a camp, offer the camp-only vs global choice and call the new endpoint.

- [ ] **Step 5: Typecheck + lint + (CI) vitest**

Run: `cd frontend && pnpm exec tsc -b && pnpm lint`
Expected: PASS. Add/adjust `.test.tsx` for the new student composer + camp-only video control (stub `window.fetch`); these run in CI Chromium, not on this box.

- [ ] **Step 6: Commit**

```bash
git add frontend
git commit -m "feat(camps): student footage, camp threads, and camp-technique discussion UI"
```

---

## Task 7: Full verify and PR

- [ ] **Step 1: Run the repo verify gate**

Run: `nix develop .#ci --command just verify`
Expected: lint + tests + unused-deps PASS.

- [ ] **Step 2: Open the PR**

Open a PR per the `ci-and-staging-deploy` skill. Schema changes here are additive (no destructive flag needed). Camps remain gated off production via `campsUiEnabled` until the epic lands.

---

## Self-review notes

- Spec Phase 2a (student footage) → Task 1 + Task 6 Step 2. 2b (camp threads) → Task 2 + Task 6 Step 2. 2c (camp_technique discussion) → Tasks 3-4 + Task 6 Step 3; isolation from global library asserted in Task 4 Step 1. 2d (camp-only vs global video) → Task 5 + Task 6 Step 4.
- Permission matrix: coach-only authoring (Task 5 `require_permission`), student footage own-camp only (Task 1), camp/camp_technique threads coach-or-owner (Tasks 2, 4). All have explicit negative tests.
- Type consistency: `AnchorKind::CampTechnique`, `Anchor.camp_id`, the create-thread request `camp_id` field, and `add_camp_technique_video` are introduced once (Tasks 3-5) and reused by name thereafter.
- Naming caveat: the test snippets assume helper names (`multipart_video_body`, `add_student`, `test_db.student_id`) that the executor must confirm against `src/test/test_utils.rs` and adapt — flagged inline in Task 1.
