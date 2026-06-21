# Camps Feed Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a camp from an ordered technique list into a timeline/feed where every post (plain, video, technique) is a thread, the camp view is the activity feed sliced to that camp, with a unified composer, a four-source video picker, a Sillybus video navigator, timestamped video replies, and search.

**Architecture:** Mostly additive on top of the threads/comments + activity + video primitives already shipped (PR #100). A camp post is a `threads` row (`anchor_kind` `camp` or `camp_technique`); replies are `thread_comments`. The camp page reads `activity WHERE camp_id = ?`. The big net-new pieces are frontend (unified composer, video-source sheet, navigator, search, the feed view) plus a handful of backend seams (a per-comment timestamp, a relaxed `camp_technique` anchor rule, a camp-feed read endpoint, a scoped video-browse endpoint, and a reference-an-existing-video attach path).

**Tech Stack:** Rust (Rocket, sqlx, SQLite, declarative `config/schema.sql` migrator), React 19 + Vite + TanStack Query + shadcn/ui + Tailwind v4, `cargo nextest`, `just`.

**Spec:** `docs/superpowers/specs/2026-06-21-camps-feed-redesign-design.md`

---

## What already exists (verified, do NOT rebuild)

- `videos.title` is `NOT NULL`; the upload/link forms require a title; draft reply
  videos store `""` (`videos/routes.rs:484`). So "required title on a video post"
  is already satisfied by the upload path; only the *reference* path needs to
  collect/backfill a title.
- `threads`/`thread_comments` carry videos: `threads.attached_video_id`,
  `thread_comments.video_id`, with author-only-until-ready gating in `get_thread`
  (`db/threads.rs:707-765`). Draft videos upload as `VideoParent::Loose` and are
  re-parented onto the thread on create (`reparent_draft_to_thread`).
- `anchor_kind` `camp` and `camp_technique` exist (`db/threads.rs:24-25`,
  `schema.sql:499-500`). Camp + camp_technique threads AND their comments already
  emit `activity` rows with `camp_id` + `context_kind='camp'`
  (`db/threads.rs:316-323` and `:110-112`). No new emission work.
- `activity` has `camp_id` + `context_kind`; the keyset feed query is
  `db::activity_read::feed(pool, viewer, role, before, limit)`
  (`activity_read.rs:206`). It does not yet filter by camp.
- The "moments" video-review subsystem (`components/videos/review/`:
  `video-review-panel.tsx`, `moment-composer.tsx`, `moment-feed.tsx`,
  `scrubber-pins.tsx`, `moment-overlay.tsx`) renders timestamped discussion from
  threads anchored to a video (`anchor_kind='video'/'video_timestamp'`). This
  stays as-is; the camp feed will NOT use it (see Phase 3).
- Video source forms already exist: `upload-video-form.tsx`, `link-video-form.tsx`,
  `add-video-button.tsx`; draft endpoints `POST /api/thread-reply-videos/{upload,link}`
  (`videos/routes.rs:416,466`).

## Conventions for every task

- Backend test: `nix develop .#ci --command env SQLX_OFFLINE=true cargo nextest run --workspace --all-features` (filter with `-E 'test(name)'`).
- After ANY `sqlx::query!`/`query_scalar!`/`query_as!` change, regenerate the
  offline cache: `nix develop .#ci --command just sqlx-prepare`. Never bare
  `cargo sqlx prepare` on the seeded dev DB. Stage `crates/syllabus-tracker/.sqlx`.
- After schema changes, apply locally with `just migrate`.
- Test harness: `crates/syllabus-tracker/src/test/` (`create_standard_test_db`,
  `setup_test_client`, `login_as`; users `coach_user`, `student_user`). Tests are
  `#[rocket::async_test]`.
- Frontend `.test.tsx` run only in CI Chromium (not on this NixOS box); stub
  `window.fetch`, use `renderWithProviders` + `buildUser` (see
  `reference-vitest-browser-fetch-stub`). Local gate: `cd frontend && pnpm exec tsc -b && pnpm lint`.
- Commit messages: imperative, scoped, NO co-author trailer (match repo style).
- Camps stay gated off production by `campsUiEnabled` throughout.

---

# Phase 1 — Backend foundation (executable now)

Four self-contained backend changes the rest of the epic builds on. All additive
or low-risk; no destructive drops in this phase (the `camp_techniques` table drop
is deferred to the Phase 5 cleanup, once the old camp page that reads it is gone).

## Task 1: per-comment timestamp (`thread_comments.video_ts_seconds`)

**Files:**
- Modify: `config/schema.sql` (the `thread_comments` table)
- Modify: `crates/syllabus-tracker/src/db/threads.rs` (`create_comment`, `CommentView`, `get_thread` comment SELECT)
- Modify: `crates/syllabus-tracker/src/threads/routes.rs` (`CreateCommentRequest`, `api_create_comment`)
- Test: `crates/syllabus-tracker/src/test/threads.rs`

- [ ] **Step 1: Add the column**

In `config/schema.sql`, in `CREATE TABLE IF NOT EXISTS thread_comments`, after the
`video_id` column add:

```sql
    -- Optional timestamp (seconds) into THIS comment's thread's attached video,
    -- for a reply pinned to a moment of the post's video. NULL = whole-video reply.
    video_ts_seconds  INTEGER,
```

Apply: `just migrate`. Expected: applies cleanly (additive).

- [ ] **Step 2: Write the failing test**

Add to `src/test/threads.rs` (model on the existing `comment_carries_attached_video` test):

```rust
#[rocket::async_test]
async fn comment_carries_video_timestamp() {
    use crate::db::threads::{create_comment, create_thread, get_thread, Anchor, AnchorKind, NewThread, ThreadVisibility};
    use crate::db::Viewer;
    let db = create_standard_test_db().await;
    // a plain camp thread to hang a comment on
    let camp_id = crate::test::camps::seed_camp(&db).await; // helper used by camp tests; else create_camp inline
    let thread_id = create_thread(&db.pool, NewThread {
        author_id: db.coach_id,
        anchor: Anchor { kind: AnchorKind::Camp, id: camp_id, video_ts_seconds: None, pinned_student_id: None, camp_id: None },
        visibility: ThreadVisibility::Private,
        scope_student_id: Some(db.student_id),
        body: "root".into(),
        attached_video_id: None,
    }).await.unwrap();

    let comment_id = create_comment(&db.pool, thread_id, None, db.coach_id, "at 12s".into(), None, Some(12)).await.unwrap();

    let view = get_thread(&db.pool, thread_id, Viewer { user_id: db.coach_id, is_coach: true }).await.unwrap().unwrap();
    let c = view.comments.iter().find(|c| c.id == comment_id).unwrap();
    assert_eq!(c.video_ts_seconds, Some(12));
}
```

Adapt helper names to whatever `src/test/camps.rs` / `test_utils.rs` expose
(`create_camp` + `NewCamp` inline if there is no `seed_camp`). The new
`create_comment` arg and `CommentView.video_ts_seconds` field do not exist yet, so
this fails to compile.

- [ ] **Step 3: Run to verify it fails**

Run: `nix develop .#ci --command env SQLX_OFFLINE=true cargo nextest run -E 'test(comment_carries_video_timestamp)'`
Expected: FAIL (compile error: unknown arg / field).

- [ ] **Step 4: Thread it through the db layer**

In `src/db/threads.rs`:
- `create_comment` signature: add a trailing param `video_ts_seconds: Option<i64>`.
- Its `INSERT INTO thread_comments (...)` add `video_ts_seconds` to the column list
  and a bind; pass the new arg.
- `struct CommentView`: add `pub video_ts_seconds: Option<i64>,` (place it next to `video`).
- In `get_thread`, the comment SELECT (`db/threads.rs:720`) add
  `c.video_ts_seconds AS "video_ts_seconds?: i64",` and set it on the pushed
  `CommentView`.
- Update every other `create_comment(...)` call site to pass `None` (the compiler
  lists them: other tests, `bin/seed.rs`).

- [ ] **Step 5: Thread it through the route**

In `src/threads/routes.rs`, `struct CreateCommentRequest`: add
`pub video_ts_seconds: Option<i64>,`. In `api_create_comment`, pass
`req.video_ts_seconds` as the new last arg to `create_comment`.

- [ ] **Step 6: Regenerate cache, run the test**

Run: `nix develop .#ci --command just sqlx-prepare`
Run: `nix develop .#ci --command env SQLX_OFFLINE=true cargo nextest run -E 'test(comment_carries_video_timestamp) + test(comment_carries_attached_video)'`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add config/schema.sql crates/syllabus-tracker/src/db/threads.rs crates/syllabus-tracker/src/threads/routes.rs crates/syllabus-tracker/src/test crates/syllabus-tracker/src/bin/seed.rs crates/syllabus-tracker/.sqlx
git commit -m "feat(threads): add per-comment video timestamp for pinned replies"
```

## Task 2: relax the `camp_technique` anchor rule (attach-on-post)

Today a `camp_technique` thread is only valid if the technique is already in
`camp_techniques` (`db/threads.rs:204-218`). The feed model has no pre-attach
step: posting a technique IS the attach. Change the rule to "the technique exists
and is global or scoped to this camp, and the camp exists."

**Files:**
- Modify: `crates/syllabus-tracker/src/db/threads.rs` (`validate_anchor`, `CampTechnique` arm)
- Test: `crates/syllabus-tracker/src/test/threads.rs`

- [ ] **Step 1: Write the failing test**

```rust
#[rocket::async_test]
async fn camp_technique_thread_valid_without_pre_attach() {
    use crate::db::threads::{create_thread, Anchor, AnchorKind, NewThread, ThreadVisibility};
    let db = create_standard_test_db().await;
    let camp_id = /* create_camp for db.student_id by db.coach_id */;
    let technique_id = /* create a global library technique (scoped_camp_id NULL) */;
    // NOTE: technique is NOT added to camp_techniques.
    let id = create_thread(&db.pool, NewThread {
        author_id: db.coach_id,
        anchor: Anchor { kind: AnchorKind::CampTechnique, id: technique_id, video_ts_seconds: None, pinned_student_id: None, camp_id: Some(camp_id) },
        visibility: ThreadVisibility::Private,
        scope_student_id: Some(db.student_id),
        body: "discuss this technique in the camp".into(),
        attached_video_id: None,
    }).await;
    assert!(id.is_ok(), "posting a library technique to a camp should not require pre-attach");
}

#[rocket::async_test]
async fn camp_technique_thread_rejects_other_camps_scoped_technique() {
    // a technique scoped to a DIFFERENT camp (scoped_camp_id = other) must be rejected
    // -> create_thread(... CampTechnique ...) returns Err(Validation)
}
```

Fill camp/technique creation with the helpers in `src/test/camps.rs`
(`create_camp`, and the technique-creation helper used there; a global technique
has `scoped_camp_id` NULL).

- [ ] **Step 2: Run to verify it fails**

Run: `nix develop .#ci --command env SQLX_OFFLINE=true cargo nextest run -E 'test(camp_technique_thread_valid_without_pre_attach) + test(camp_technique_thread_rejects_other_camps_scoped_technique)'`
Expected: FAIL — current rule needs `camp_techniques` membership, so the first test errors.

- [ ] **Step 3: Rewrite the `CampTechnique` arm**

Replace the `camp_techniques` EXISTS check in `validate_anchor` with:

```rust
AnchorKind::CampTechnique => {
    let camp_id = anchor.camp_id.ok_or_else(|| {
        AppError::Validation("camp_technique anchor requires a camp".to_string())
    })?;
    // Camp must exist, and the technique must be global (scoped_camp_id IS NULL)
    // or scoped to THIS camp. Posting the technique is the attach; no prior
    // camp_techniques membership is required.
    sqlx::query_scalar!(
        r#"SELECT EXISTS(
              SELECT 1 FROM techniques t
              JOIN camps c ON c.id = ?
              WHERE t.id = ?
                AND (t.scoped_camp_id IS NULL OR t.scoped_camp_id = ?)
           ) AS "e!: i64""#,
        camp_id,
        anchor.id,
        camp_id
    )
    .fetch_one(pool)
    .await?
}
```

(Confirm the column is `techniques.scoped_camp_id` via `grep -n scoped_camp_id config/schema.sql`.)

- [ ] **Step 4: Regenerate cache, run tests**

Run: `nix develop .#ci --command just sqlx-prepare`
Run: `nix develop .#ci --command env SQLX_OFFLINE=true cargo nextest run -E 'test(camp_technique)'`
Expected: PASS (including any existing camp_technique tests; update ones that relied on pre-attach).

- [ ] **Step 5: Commit**

```bash
git add crates/syllabus-tracker/src/db/threads.rs crates/syllabus-tracker/src/test crates/syllabus-tracker/.sqlx
git commit -m "feat(camps): allow posting a library technique to a camp without pre-attach"
```

## Task 3: drop `camps.references_camp_id` ("builds on")

**Files:**
- Modify: `config/schema.sql` (`camps` table)
- Modify: `crates/syllabus-tracker/src/db/camps.rs` (`NewCamp`, `get_camp`/`Camp` struct)
- Modify: `crates/syllabus-tracker/src/camps/routes.rs` (`:52,97-100,118,163,181-182`)
- Modify: `crates/syllabus-tracker/src/test/camps.rs` (`:557,648`)
- Modify: `frontend/src/lib/api.ts` (any `references_camp_id`/`references_camp_name` on the camp type)

- [ ] **Step 1: Remove from schema**

In `config/schema.sql`, delete the `references_camp_id INTEGER REFERENCES camps(id)`
line from `CREATE TABLE IF NOT EXISTS camps`. This is a destructive column drop;
the migrator rebuilds the table. Apply with `just migrate` (dev has no real camp
data). On staging/prod deploy this needs `allow_destructive_migrations=true`.

- [ ] **Step 2: Remove from the db + routes layer**

- `db/camps.rs`: drop `references_camp_id` from `struct NewCamp`, its INSERT, and
  from the `Camp` row struct + `get_camp` SELECT.
- `camps/routes.rs`: drop `references_camp_id` from `CreateCampRequest` (`:52`),
  `references_camp_id`/`references_camp_name` from the camp-detail response struct
  (`:97-100`, `:181-182`), the `NewCamp { references_camp_id: ... }` (`:118`), and
  the `references_camp_name` lookup block (`:163`).
- `src/test/camps.rs`: drop the two `references_camp_id: None` literals (`:557,648`).
- `frontend/src/lib/api.ts`: drop `references_camp_id`/`references_camp_name` from
  the camp type if present (grep first).

- [ ] **Step 3: Build, regen, test**

Run: `nix develop .#ci --command just sqlx-prepare`
Run: `nix develop .#ci --command env SQLX_OFFLINE=true cargo nextest run -E 'test(camp)'`
Run: `cd frontend && pnpm exec tsc -b`
Expected: compiles; camp tests pass.

- [ ] **Step 4: Commit**

```bash
git add config/schema.sql crates/syllabus-tracker frontend/src/lib/api.ts crates/syllabus-tracker/.sqlx
git commit -m "feat(camps): drop the references_camp_id builds-on link"
```

## Task 4: camp-feed read endpoint (activity sliced by camp)

**Files:**
- Modify: `crates/syllabus-tracker/src/db/activity_read.rs` (`feed`, add optional `camp_id`)
- Modify: `crates/syllabus-tracker/src/camps/routes.rs` (new `api_camp_feed` handler) + mount in `src/main.rs`
- Test: `crates/syllabus-tracker/src/test/camps.rs`

- [ ] **Step 1: Write the failing test**

```rust
#[rocket::async_test]
async fn camp_feed_returns_only_this_camps_activity() {
    // arrange: coach + student; camp A and camp B for the same student.
    //   post a plain thread to camp A (anchor_kind camp) and one to camp B.
    // act: GET /api/camps/{A}/feed as the student.
    // assert: 200; the returned rows reference camp A only (camp_id == A), not B.
}

#[rocket::async_test]
async fn camp_feed_forbidden_for_other_student() {
    // camp owned by other_student; GET /api/camps/{id}/feed as student_user -> Forbidden
}
```

Use the JSON feed shape the dashboard feed route returns (check `api.rs`
`api_activity_feed` for the response type to mirror).

- [ ] **Step 2: Run to verify it fails**

Run: `nix develop .#ci --command env SQLX_OFFLINE=true cargo nextest run -E 'test(camp_feed_returns_only_this_camps_activity) + test(camp_feed_forbidden_for_other_student)'`
Expected: FAIL (route 404, handler absent).

- [ ] **Step 3: Add an optional camp filter to `feed`**

In `db/activity_read.rs`, give `feed` an extra param `camp_id: Option<i64>` and add,
inside the existing `WHERE (...)` visibility block, an `AND (?4 IS NULL OR act.camp_id = ?4)`-style
predicate (match the crate's actual bind-numbering / QueryBuilder approach in that
function). Update existing `feed(...)` callers in `api.rs` to pass `None`.

- [ ] **Step 4: Add the route (coach-or-owner)**

In `camps/routes.rs`:

```rust
#[get("/camps/<camp_id>/feed?<before>&<limit>")]
pub async fn api_camp_feed(
    camp_id: i64, before: Option<i64>, limit: Option<i64>,
    pool: &State<Pool<Sqlite>>, user: User,
) -> Result<Json<Vec<ActivityFeedItem>>, AppError> {
    // authz: coach (ViewAllStudents/ManageCamps) or the camp's own student
    let camp = crate::db::camps::get_camp(pool, camp_id).await?
        .ok_or_else(|| AppError::NotFound(format!("camp #{camp_id}")))?;
    let is_coach = user.has_permission(Permission::ManageCamps);
    if !is_coach && user.id != camp.student_id { return Err(AppError::Forbidden); }
    let rows = crate::db::activity_read::feed(pool, user.id, user.role, /*before*/ ..., limit.unwrap_or(20), Some(camp_id)).await?;
    // map rows -> the same DTO api_activity_feed returns
    Ok(Json(...))
}
```

Mirror `api_activity_feed`'s exact cursor parsing (`before`), DTO mapping, and
`Permission` idiom. Mount `api_camp_feed` in `src/main.rs` `routes![]` + import.

- [ ] **Step 5: Regen, test, commit**

Run: `nix develop .#ci --command just sqlx-prepare`
Run: `nix develop .#ci --command env SQLX_OFFLINE=true cargo nextest run -E 'test(camp_feed)'`
Expected: PASS.

```bash
git add crates/syllabus-tracker config/schema.sql crates/syllabus-tracker/.sqlx
git commit -m "feat(camps): camp feed read endpoint (activity sliced by camp)"
```

## Phase 1 acceptance

- A comment round-trips a `video_ts_seconds`.
- A library technique can be posted to a camp with no prior `camp_techniques` row;
  another camp's scoped technique is rejected.
- `references_camp_id` is gone from schema, backend, frontend types, and tests.
- `GET /api/camps/:id/feed` returns only that camp's activity, coach-or-owner gated.
- `nix develop .#ci --command just verify` green.

---

# Phases 2-5 — roadmap (each gets its own full plan at execution start)

These are frontend-heavy and depend on live component grounding (composer,
moments components, the camp page, the dashboard feed list). Per the repo's slice
cadence and the brainstorming skill's multi-subsystem guidance, expand each into a
full bite-sized plan (its own `docs/superpowers/plans/...md`) when you start it.
File maps, interfaces, and acceptance are fixed here so the sequence is locked.

## Phase 2 — unified composer + four-source video sheet + Sillybus navigator

**Backend:**
- New `GET /api/videos/browse?student_id=&source=&parent_id=&q=` (or similar): the
  navigator's data. Returns videos **visible to the camp's STUDENT** (Section 4
  hard rule: scope to the student's visibility for both operators; exclude
  coach-only and other students' content). Sources: `library` (technique -> videos),
  `camp` (student's other camps), `syllabus` (student's syllabuses). Reuse the
  existing per-student video-visibility resolver.
- Extend the thread/comment create paths to **reference** an existing (non-draft)
  video: `attached_video_id`/`video_id` may point at a live owned video. Add a
  `validate_attachable_reference` that does NOT re-parent (distinct from
  `validate_attachable_draft` + `reparent_draft_to_thread`), and on a title-less
  referenced video starting a thread, require + backfill `videos.title`
  (`UPDATE videos SET title = ?`). Coach-or-owner + student-visibility gates.

**Frontend (files):**
- `frontend/src/components/videos/video-source-sheet.tsx` (new): bottom sheet with
  four entries (Record now / Choose from device / Paste a link / Choose from
  Sillybus). Record + device feed `upload-video-form.tsx` (camera = `<input capture>`);
  link feeds `link-video-form.tsx`; Sillybus opens the navigator.
- `frontend/src/components/videos/sillybus-video-navigator.tsx` (new): drill-down
  (sources -> drill -> Link), top search, thumbnail+provenance rows.
- `frontend/src/components/threads/reply-composer.tsx` (modify): route its video
  attach through `video-source-sheet` so replies get all four sources + reference.
- `frontend/src/components/camps/camp-composer.tsx` (new): the unified composer (+
  menu: Attach technique / Attach video -> source sheet; plain text = type+send).
- `frontend/src/lib/{api,mutations,queries,query-keys}.ts` (modify): `browseVideos`,
  reference-attach mutation variants, `videos.title` backfill field.

**Acceptance:** four sources work from both the camp composer and replies; the
navigator never lists another student's or coach-only videos (negative test with a
coach operating inside a student's camp); referencing keeps the video's parent and
backfills a title on first thread-start; reply videos still need no title.

## Phase 3 — timestamped replies + shared `TimestampedEntry` extraction

**Frontend (files):**
- `frontend/src/components/videos/review/scrubber-pins.tsx` +
  `moment-overlay.tsx` (modify): generalize their prop from `ThreadView[]` (reading
  `.video_ts_seconds`) to a `TimestampedEntry { id: number|string; video_ts_seconds: number|null }[]`
  so they render for both legacy moment-threads AND camp comment-replies.
- `frontend/src/components/threads/comment-item.tsx` (modify): render a comment's
  `video_ts_seconds` (a "@1:23" chip that seeks the post's player).
- `frontend/src/components/threads/thread-view.tsx` (modify): for a camp video post,
  feed the post's comments (their `video_ts_seconds`) into the shared scrubber/overlay
  over the attached video's player; reply composer can stamp the current time.
- `frontend/src/lib/api.ts` (modify): `CommentView.video_ts_seconds`; `createComment`
  passes it (the backend half landed in Phase 1 Task 1).

**Acceptance:** replies to a camp video post can be whole-video or timestamped;
timestamped replies show pins on the post's scrubber and seek on tap; legacy
moments viewer still renders through the same components (no regression). No new
storage; storage isolation is inherent (comments belong to the camp thread).

## Phase 4 — camp search

**Backend:** `GET /api/camps/:id/search?q=&kind=` returning grouped hits across
technique names, video titles, and thread/comment bodies scoped to the camp,
respecting the camp audience. (Reuse the camp-feed visibility scoping.)

**Frontend (files):** `frontend/src/components/camps/camp-search-sheet.tsx` (new):
toggleable full-screen sheet, kind chips (All/Techniques/Videos/Threads), grouped
match-highlighted results; tapping a result closes and deep-links into the feed.

**Acceptance:** search matches the three targets; kind chips narrow groups; a hit
jumps to the feed card (reusing `?thread=` scroll-and-highlight) or opens the
single-thread focused view when deeper than the loaded slice.

## Phase 5 — the camp feed view + cleanup

**Frontend (files):**
- `frontend/src/app/camps/[id]/page.tsx` (rewrite): title header (back + 🔍), the
  unified composer pinned on top, then the feed = `GET /api/camps/:id/feed`
  rendered with the existing activity-tile components (infinite scroll, ordering),
  per-kind cards (plain/video/technique). Empty-camp hint. Remove the
  ordered-technique-list UI, the Pick/Create technique picker tabs, and the
  `camp_techniques`-derived rendering.
- Reuse `discussion-block.tsx`'s `?thread=` scroll-and-highlight for the jump.
- **Caveat from P1T4:** `GET /api/camps/:id/feed` computes each row's `unread`
  from the camp STUDENT's cursor (it queries from the student's perspective so a
  coach sees the full timeline incl. their own posts). The camp feed UI must NOT
  badge `unread` for coach viewers (a coach would see their own posts as unread);
  ignore/suppress it there. (Minor nit also noted: `ActivityFeedQuery` /
  `parse_before_ts` / limit constants are `pub` in `api.rs` for reuse; if a third
  consumer appears, extract a `feed_params` module.)

**Backend cleanup (now safe, the page no longer reads it):**
- Drop the `camp_techniques` table + indexes from `config/schema.sql` (destructive;
  check/relocate the `camp_technique_referenced_videos` FK first), and delete the
  now-dead `db/camps.rs` functions (`add_camp_technique`, `list_camp_techniques`,
  reorder, etc.) + their routes + tests. Sequence this LAST so nothing reads the
  table mid-epic.

**Acceptance:** a camp opens as a feed; posting a technique/video/plain note adds a
card; activity also appears on both dashboards; the old ordered-list UI and the
`camp_techniques` table are gone; `just verify` + frontend tsc/lint/vitest green.

---

## Self-review notes

- **Spec coverage:** S1 model -> Phase 5 view + Phase 1 Task 2 (technique-as-thread).
  S2 schema: `video_ts_seconds` -> P1T1; `videos.title` already exists (no task,
  reference-backfill in P2); drop `camp_techniques` -> P5 cleanup; drop
  `references_camp_id` -> P1T3. S3 composer -> P2. S4 sources+navigator -> P2. S5
  titles/backfill -> P2. S6 timestamped replies -> P1T1 (storage) + P3 (UI). S7 feed
  view -> P1T4 (read) + P5 (UI). S8 activity -> already built (verified). S9 search
  -> P4. S10 permissions -> enforced across P1T4/P2 routes with negative tests.
- **Already-built, de-scoped:** title column, camp/comment activity emission with
  `camp_id`+`context_kind`. Do not rebuild.
- **Sequencing risk:** `camp_techniques` drop is deferred to P5 so the current camp
  page keeps working through P1-P4; `validate_anchor` is relaxed in P1T2 so the feed
  can attach techniques without it. The `camp_technique_referenced_videos` FK onto
  `camp_techniques` must be checked before the P5 drop.
- **Type consistency:** `video_ts_seconds: Option<i64>` (Rust) / `video_ts_seconds:
  number | null` (TS) used identically in P1T1 and P3; `TimestampedEntry` defined
  once in P3 and consumed by `scrubber-pins`/`moment-overlay`; `feed(... camp_id:
  Option<i64>)` defined in P1T4 and reused by the camp feed route.
