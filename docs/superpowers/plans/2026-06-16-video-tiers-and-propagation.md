# Video Tiers & Cross-Tier Propagation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a coach attach videos to a technique at any of three tiers (global library / syllabus template / one student's assignment), hide inherited videos per scope, and reconcile both in the diff tool — without the state tangle.

**Architecture:** Videos are *owned at exactly one tier* via `videos.parent_kind` (existing polymorphic typed-column pattern); lower tiers inherit. Visibility is the *only* inheritance: one `video_visibility_overrides` table (scopes student / syllabus / assignment; presence = explicit) + one pure resolver used by both the list read and the playback guard. Techniques remain snapshots (no change). Hiding a technique for a student cascades to its inherited videos. The assignment diff gains video adds/hides with stage-and-apply.

**Tech Stack:** Rust + Rocket + SQLx (SQLite, declarative migrator at `config/schema.sql`), React 19 + Vite + TanStack Query + shadcn/ui, Vitest.

**Authoritative design:** `docs/superpowers/specs/2026-06-16-video-tiers-and-propagation-design.md` (read its **Second-Review Addendum** — those decisions win over any conflicting prose).

**Branch:** stack on `feat/syllabus-modification-ux` (or a fresh branch off it once the technique PR #74 merges — confirm base before starting).

---

## Conventions (same as the technique plan)
- Conventional Commits, scoped, imperative, **no `Co-Authored-By` trailer**.
- Backend tests: `nix develop .#ci --command cargo nextest run -p syllabus-tracker --all-features <filter>` (the `--all-features` flag is required — test-support gating).
- After any `sqlx::query!` change: `nix develop .#ci --command just sqlx-prepare`, commit `.sqlx/`.
- Schema: edit `config/schema.sql`, apply with `nix develop .#ci --command just migrate`.
- Frontend: `cd frontend && npx tsc --noEmit`; pure helpers get `*.unit.test.ts` (run locally), component tests are CI-only.
- A pre-commit hook runs the relevant lint/test suite and blocks on failure.

---

## Key facts confirmed in code (read before starting)
- `VideoParent` enum + `ParentColumns` + `validate_parent` + `next_video_position`: `crates/syllabus-tracker/src/db/videos.rs:16-103`. Inserts (`create_processing_video` ~120, `create_external_video` ~170) write `c.kind, c.technique_id, c.student_id, c.thread_id`.
- `videos` CHECK is exactly-one-typed-column per kind: `config/schema.sql:128` (DEFAULT 'technique') and the CHECK block at the table end.
- Per-syllabus video read: `list_videos_for_technique_in_syllabus_visible_to` (`videos.rs:397`); playback guard `video_visible_to_student` (`videos.rs:536`, joins the LEGACY `video_student_visibility`). Library read `list_videos_for_technique_global_visible` (`videos.rs:435`).
- Two live visibility tables: `student_syllabus_video_visibility` (PK student,syllabus,video — written by `set_video_syllabus_visibility`, `videos.rs:899`) and legacy `video_student_visibility` (PK video,student — written by `api_set_video_student_visibility`, used by the guard + `video-row.tsx:562`).
- SST video_count subquery counts `videos.technique_id` directly: `student_syllabus_techniques.rs:80` (MUST gain `AND parent_kind='technique'` once technique_id is no longer T1-exclusive).
- Diff: `diff_for_assignment` (`student_syllabus_techniques.rs:548`), `remove_technique_from_syllabus` (`syllabi.rs:312`, hard-deletes the membership row).
- `syllabus_techniques`: composite PK `(syllabus_id, technique_id)`, no surrogate id (`schema.sql:254`).

---

## File Structure
- `config/schema.sql` — surrogate `id` on `syllabus_techniques`; new `videos` columns + `parent_kind` values + CHECK branches; new `video_visibility_overrides` table; drop the two legacy visibility tables after migration.
- `crates/syllabus-tracker/src/db/videos.rs` — `VideoParent` gains `SyllabusTechnique`/`StudentSyllabusTechnique`; `ParentColumns` gains the two columns; inserts/position/parent-list updated; new `effective_video_visible` core + `list_videos_for_sst` + `video_visible_to_student_anywhere`; visibility-override read/write.
- `crates/syllabus-tracker/src/db/visibility.rs` — **new**: the override table read/write + resolver core (or co-locate in videos.rs if cleaner).
- `crates/syllabus-tracker/src/db/syllabi.rs` — `remove_technique_from_syllabus` becomes video-aware.
- `crates/syllabus-tracker/src/db/student_syllabus_techniques.rs` — `video_count` query guard; diff gains video adds/hides.
- `crates/syllabus-tracker/src/api.rs` + `src/videos/routes.rs` + `src/syllabi/routes.rs` — create-video parent inputs; diff payload; mounts.
- Frontend: `lib/api.ts`, `lib/mutations.ts`; `components/videos/*` (add button/forms/visibility); a scope-selector component on the syllabus page; `diff-dialog.tsx`.

---

# Chunk V1 — Schema foundations

### Task V1: Surrogate id on `syllabus_techniques` + new video columns/kinds + override table
**Files:** `config/schema.sql`

- [ ] **Step 1: Add a surrogate id to `syllabus_techniques`**
Change the table (keep the pair UNIQUE):
```sql
CREATE TABLE IF NOT EXISTS syllabus_techniques (
    id           INTEGER PRIMARY KEY,
    syllabus_id  INTEGER NOT NULL REFERENCES syllabi (id) ON DELETE CASCADE,
    technique_id INTEGER NOT NULL REFERENCES techniques (id) ON DELETE CASCADE,
    position     INTEGER NOT NULL DEFAULT 0,
    added_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    added_by_id  INTEGER REFERENCES users (id),
    UNIQUE (syllabus_id, technique_id)
);
```

- [ ] **Step 2: Add the two parent columns + parent_kind values + CHECK branches to `videos`**
Add columns `syllabus_technique_id INTEGER REFERENCES syllabus_techniques(id) ON DELETE CASCADE` and `student_syllabus_technique_id INTEGER REFERENCES student_syllabus_techniques(id) ON DELETE CASCADE`. Extend the `parent_kind` CHECK list with `'syllabus_technique'`, `'student_syllabus_technique'`, and add CHECK branches requiring exactly that column set and all others NULL (mirror the existing branches).

- [ ] **Step 3: Add `video_visibility_overrides`**
```sql
CREATE TABLE IF NOT EXISTS video_visibility_overrides (
    scope_kind  TEXT NOT NULL CHECK (scope_kind IN ('student','syllabus','assignment')),
    scope_id    INTEGER NOT NULL,
    video_id    INTEGER NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
    visible     BOOLEAN NOT NULL,
    set_by_id   INTEGER REFERENCES users (id),
    set_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (scope_kind, scope_id, video_id)
);
```
(Leave the two legacy tables in place for now — Task V3 migrates then drops them. Removing them here would break the build before the read paths move.)

- [ ] **Step 4: Migrate + commit**
Run `nix develop .#ci --command just migrate` (expect table rebuilds for `syllabus_techniques` and `videos`; data preserved). Then:
```bash
git add config/schema.sql
git commit -m "feat(videos): schema for 3-tier video parents + visibility-override table"
```
(No sqlx regen yet — no query changes in this task.)

---

# Chunk V2 — VideoParent for the two new tiers

### Task V2: Extend `VideoParent`/`ParentColumns`/inserts/queries
**Files:** `crates/syllabus-tracker/src/db/videos.rs`; `src/test/videos.rs`

- [ ] **Step 1: Failing test** — add to `src/test/videos.rs` a test that creates a video with `VideoParent::StudentSyllabusTechnique(sst_id)` and one with `VideoParent::SyllabusTechnique(st_id)` and asserts they round-trip (parent kind + id) via a fetch. Use existing test helpers to seed an SST and a `syllabus_techniques` row (now with an `id`). Run it; expect FAIL (variants don't exist).

- [ ] **Step 2: Extend the enum + columns**
Add to `VideoParent`: `SyllabusTechnique(i64)`, `StudentSyllabusTechnique(i64)`. Add to `ParentColumns`: `syllabus_technique_id: Option<i64>`, `student_syllabus_technique_id: Option<i64>` (and set all existing arms to `None` for the two new fields). Add the two new match arms in `columns()`:
```rust
VideoParent::SyllabusTechnique(id) => ParentColumns {
    kind: "syllabus_technique", technique_id: None, student_id: None, thread_id: None,
    syllabus_technique_id: Some(id), student_syllabus_technique_id: None,
},
VideoParent::StudentSyllabusTechnique(id) => ParentColumns {
    kind: "student_syllabus_technique", technique_id: None, student_id: None, thread_id: None,
    syllabus_technique_id: None, student_syllabus_technique_id: Some(id),
},
```

- [ ] **Step 3: validate_parent + inserts + position/parent queries**
Add `validate_parent` arms (check the row exists in `syllabus_techniques` / `student_syllabus_techniques`). Update both INSERTs (`create_processing_video`, `create_external_video`) to include the two new columns. Update `next_video_position` and `list_videos_for_parent_global_visible` symmetric-null matching to add the two new `(col IS ? OR (col IS NULL AND ? IS NULL))` clauses. Add the two new params to each `sqlx::query!`.

- [ ] **Step 4: regen + test + commit**
`just sqlx-prepare`; run the V2 test (PASS) + `cargo check`. Commit `videos.rs`, `test/videos.rs`, `.sqlx`:
`feat(videos): add syllabus-technique and student-syllabus-technique video parents`.

---

# Chunk V3 — One override table + one resolver + legacy migration

### Task V3a: Resolver core + override read/write
**Files:** `crates/syllabus-tracker/src/db/videos.rs` (or new `db/visibility.rs`); tests in `src/test/videos.rs`

- [ ] **Step 1: Failing test** for a pure-ish resolver. Seed: a global video (technique-owned) + overrides at assignment/syllabus/student scope; assert `effective_video_visible` returns the precedence-correct result for each combination (deleted > owning-SST-hidden > assignment > syllabus > student > owned-in-scope?global-hidden:absent). Run; FAIL.

- [ ] **Step 2: Implement `effective_video_visible`** as one SQL `CASE` (or a fetch + Rust match) keyed on `(video_id, assignment_id)` that joins: the video, the SST for the owning technique in that assignment (for the hidden-cascade), and the three override scopes (assignment_id; the assignment's syllabus_id; the assignment's student_id). Precedence ladder exactly per the spec addendum item 5. Add write helpers `set_video_override(scope_kind, scope_id, video_id, visible, by)` and `clear_video_override(...)`.

- [ ] **Step 3:** run test (PASS), regen, commit: `feat(videos): single effective-visibility resolver + override read/write`.

### Task V3b: Migrate the two legacy tables into `video_visibility_overrides`, then drop them
**Files:** `config/schema.sql` (drop the two tables), a one-off data migration in the migrate path or `scripts/oneoff/`, the write endpoints, `videos.rs` reads.

- [ ] **Step 1:** Decide + document carry policy (per spec open items): `student_syllabus_video_visibility(student,syllabus,video)` → `('assignment', assignment_id, video)` mapping via `syllabus_assignments` (skip rows with no live assignment); `video_student_visibility(student,video)` → `('student', student_id, video)`. Write the backfill (idempotent INSERT … SELECT).
- [ ] **Step 2:** Repoint the write endpoints (`set_video_syllabus_visibility`, `api_set_video_student_visibility`) to write `video_visibility_overrides`. Repoint reads (`list_videos_for_technique_in_syllabus_visible_to`, the guard) to the resolver from V3a.
- [ ] **Step 3:** Drop the two legacy tables from `config/schema.sql` once nothing references them; `just migrate`; regen; run the full video test module. Commit: `refactor(videos): migrate visibility overrides to one table + resolver, drop legacy tables`.

### Task V3c: Guard "anywhere" entry point + technique_id query audit
- [ ] Add `video_visible_to_student_anywhere(video, student)` = visible under ANY of the student's assignments (for direct-URL playback of a globally-owned video). Point the playback/download guard at it.
- [ ] Audit every `WHERE technique_id = ?` video query for T2/T3 leakage; add `AND parent_kind = 'technique'` where the intent is T1-only — **explicitly** the SST `video_count` subquery (`student_syllabus_techniques.rs:80`) and the deprecated `list_videos_for_technique_visible_to`. Add a regression test that a T3 video does not inflate a technique's library `video_count`. Commit: `fix(videos): scope technique_id video queries to T1 ownership`.

---

# Chunk V4 — Per-syllabus video read (candidate union + cascade)

### Task V4: `list_videos_for_sst`
**Files:** `videos.rs`; `videos-block.tsx` read wiring; tests.
- [ ] Candidate set = videos owned at T1(technique) ∪ T2(this syllabus's `syllabus_techniques` row) ∪ T3(this SST), filtered by `effective_video_visible`. If the owning technique's SST is hidden, return none (cascade). Replace the current per-syllabus read call with this. Tests: T2 video shows only for that syllabus; T3 only for that assignment; hidden technique suppresses all. Commit: `feat(videos): union T1/T2/T3 videos in the per-syllabus read with hide cascade`.

---

# Chunk V5 — Create-video at the new tiers (backend)

### Task V5: create endpoints accept T2/T3 parents
**Files:** `src/videos/routes.rs`, `src/syllabi/routes.rs`, `src/api.rs`, mounts; tests.
- [ ] Extend the upload + external-link create routes so the parent can be technique (T1), syllabus_technique (T2), or student_syllabus_technique (T3). Permission: coach/admin (for T3, assigned to that student). Validate parent existence. Tests for each parent + permission deny. Commit: `feat(videos): create videos scoped to syllabus or student-syllabus technique`.

---

# Chunk V6 — Orphan safety

### Task V6: video-aware technique removal
**Files:** `syllabi.rs:312`; tests.
- [ ] Make `remove_technique_from_syllabus` handle T2 videos on that `(syllabus, technique)`: since the `syllabus_techniques` row is hard-deleted and `videos.syllabus_technique_id` is `ON DELETE CASCADE`, those videos would be hard-deleted — which loses soft-delete history. Instead, before deleting the membership row, **soft-delete** (`deleted_at`) any T2 videos parented to it (or re-parent per a decided policy), so history is preserved and they stop resolving. Add a test: removing a technique from a syllabus soft-deletes its T2 videos and they no longer appear, but the row + storage_key remain. Commit: `fix(videos): preserve syllabus-tier videos when a technique leaves a syllabus`.

---

# Chunk V7 — Frontend plumbing

### Task V7: api + mutations for parent-scoped create + overrides
**Files:** `frontend/src/lib/api.ts`, `lib/mutations.ts`.
- [ ] Extend the create-video api calls to carry the chosen parent (technique/syllabus_technique/student_syllabus_technique). Add/repoint the visibility-override set call to the unified endpoint. Add mutation hooks + invalidate the per-syllabus video query. `tsc` clean. Commit: `feat(videos): frontend api+mutations for tiered video create + overrides`.

---

# Chunk V8 — Add-video UI + scope selector

### Task V8a: scope selector on the student-syllabus page
**Files:** `frontend/src/app/student-syllabi/[syllabusId]/page.tsx` + a small `scope-selector.tsx`.
- [ ] Sticky (session-remembered) `Editing at: [This student ▾]` (This student / This syllabus / Global), default This student. It sets the default tier for adds/hides. Persist in component state (and optionally `sessionStorage`). Commit: `feat(syllabus): scope selector for tiered edits`.

### Task V8b: enable add/record video from a student-syllabus technique + switch
**Files:** `components/videos/add-video-button.tsx`, `upload-video-form.tsx`, `link-video-form.tsx`, `videos-block.tsx`.
- [ ] Enable `AddVideoButton` in `student-syllabus` context. The upload/record + link forms show an **"Also add to global technique library"** switch (default ON): ON ⇒ parent = technique (T1); OFF ⇒ parent = the SST (T3, student-only). Thread the parent choice through to the create call. Commit: `feat(syllabus): add/record videos on a student syllabus technique with global switch`.

---

# Chunk V9 — Diff: videos (backend, stage-and-apply)

### Task V9: assignment diff includes videos
**Files:** `student_syllabus_techniques.rs` (diff), the apply route, payload types; tests.
- [ ] Extend `diff_for_assignment` (and its apply path) so that, per technique, it reports: videos hidden for this assignment (override visible=0) and videos owned only at T3 (student-only). Add video diff action kinds (e.g. promote T3 video to T1, restore a hidden video) + apply logic. Tests for compute + apply. Commit: `feat(diff): include student-syllabus video adds/hides in the assignment diff`.

---

# Chunk V10 — Diff dialog UI

### Task V10: video rows in the diff dialog
**Files:** `frontend/src/app/student-syllabi/[syllabusId]/components/diff-dialog.tsx`, `lib/api.ts` diff types, `lib/mutations.ts` apply.
- [ ] Render per-technique video sub-rows for added/hidden videos with stage actions; wire into the apply mutation; keep the existing technique-level staging intact. `tsc` + lint clean. Commit: `feat(diff): stage and apply video changes in the diff dialog`.

---

## Final verification
- [ ] `nix develop .#ci --command cargo nextest run -p syllabus-tracker --all-features` — all pass.
- [ ] `cd frontend && npx vitest run` (unit) + `npx tsc --noEmit`.
- [ ] `just verify` (note: the pre-existing `unused-deps` failure is unrelated; every other stage must be green).
- [ ] Manual staging check: add a video at each tier; toggle visibility; confirm the resolver in list + direct playback; reconcile via diff.

## Self-review notes
- **Spec coverage:** 3 tiers (V1/V2/V4/V5) ✓; one override table + one resolver, two entry points (V3) ✓; hide-cascades-to-videos (V4) ✓; surrogate-id T2 anchor (V1) ✓; orphan enforcement (V6) ✓; legacy fold-in (V3b) ✓; technique_id audit (V3c) ✓; scope selector + add switch (V8) ✓; video diff stage/apply (V9/V10) ✓.
- **Heaviest/riskiest:** V3 (resolver + migration) and V9 (diff apply). Do V3 carefully; it's the load-bearing correctness work the clean-room reviews centered on.
- **Sequencing:** V1→V2→V3→V4→V5→V6 (backend) then V7→V8 (create UI) then V9→V10 (diff). V8a (scope selector) can land any time after V1.
- **Placeholder check:** the UI tasks (V8/V10) and a few backend tasks are acceptance-criteria-driven rather than full code — by design, since they require reading `diff-dialog.tsx` / the video forms at execution. Each names exact files + the precise behaviour. The schema/enum/resolver tasks (V1–V4) carry concrete SQL/Rust.
