# Context-Aware Activity Naming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three defects in the recent-activity surfaces: (1) coach actions on a student are anonymous ("graduated Blue Belt Syllabus" with no student, deep-linking to the bare syllabus instead of that student's syllabus); (2) coach/admin status changes never appear on the dashboard glance; (3) status copy leaks the backend `red`/`amber`/`green` names instead of the user-facing `New`/`Doing`/`Done`.

**Approach:** Introduce a small `ActivityScope` describing what the viewing surface already establishes, so the shared line renderer omits redundant naming and reads semantically in each context:
- Gym-wide surfaces (dashboard, coach timeline): name the target student ("Dan Bennet's Blue Belt Syllabus").
- A single student's surfaces (their profile + timeline): that student is implicit, so drop the possessive ("Blue Belt Syllabus").

Backend change is a pure read-projection: `LEFT JOIN users` to carry the target student's `display_name`. No DB migration, no schema change to the `activity` table. Dashboard verb filter broadens to surface all coach/admin actions (excluding undo/delete history verbs).

**Tech Stack:** Rust / Rocket / sqlx (SQLite, offline cache), React 19 + Vite SPA, TanStack Query, react-router-dom v7, Vitest (node `*.unit.test.ts` + browser `*.test.tsx`), shadcn/ui.

**Base branch:** `polish/staging-ui-feedback` (the active trunk; `main` is 19 behind and diverged). Branch name suggestion: `feat/activity-context-aware-naming`.

---

## Conventions for every task

- **Commit message format:** `feat(scope): Sentence in past tense.` No co-author trailer. No em-dashes anywhere (copy, comments, commit messages); use commas, periods, or parens. User-facing status copy is `New`/`Doing`/`Done`, never `red`/`amber`/`green`.
- **Frontend checks (runnable locally):** `cd frontend && npx tsc --noEmit && pnpm lint && pnpm vitest run --project node`. Browser `*.test.tsx` cannot run on this box (Chromium libs missing); write to convention and rely on CI. In `*.test.tsx`, never `vi.spyOn` an `@/lib/api` export (fails in CI browser mode); stub `window.fetch`. No `as` casts (lint rule); build fixtures with the local helpers.
- **Backend checks:** `nix develop .#ci --command just lint` and `nix develop .#ci --command cargo nextest run -p syllabus-tracker` from repo root (toolchain alignment per flake). `sqlx-check` is dropped from CI; the offline build (`SQLX_OFFLINE`) is the gate.
- **sqlx cache regen (required after any `query!` SQL change):** `nix develop .#ci --command just sqlx-prepare`. Never bare `cargo sqlx prepare` on the seeded dev DB; never rebuild `data/sqlite.db` while the dev app runs.
- **Never** `git stash` in this repo.

---

## DTO sync map (the recurring bite)

`ActivityRow` is serialized **directly** (`Json<Vec<ActivityRow>>`); there is no separate API/response DTO. But the shape is mirrored by hand across the boundary and re-declared in every test fixture. Adding `target_student_name` requires touching **all** of:

**Rust (`crates/syllabus-tracker/src/db/activity_read.rs`):**
- struct def (`:26`)
- 3 `SELECT`s: `feed` student (`~:212`), `feed` coach (`~:293`), `dashboard_activity_feed` (`~:405`)
- 3 literal constructions: `:270`, `:351`, `:451`

**TS (`frontend/src/lib/activity-line.ts`):** the `ActivityRow` interface (`api.ts` re-exports, auto-covered).

**TS fixtures (7) — tsc fails until each is updated in the same task:**
- `frontend/src/lib/activity-line.unit.test.ts` (`row` base, `:9`)
- `frontend/src/components/activity-feed-list.test.tsx` (`row` base, `:15`)
- `frontend/src/lib/activity-coalesce.unit.test.ts` (`row` base, `:5`)
- `frontend/src/app/student-activity/student-activity.test.tsx` (`buildActivityRow`, `:16`)
- `frontend/src/app/student-profile/student-profile-activity.test.tsx` (`buildActivityRow`, `:17`)
- `frontend/src/app/dashboard/components/recent-activity-feed.test.tsx` (inline `mockRow`, `:14`)
- (`frontend/src/lib/view-context.unit.test.ts` uses the `ViewContextRow` subset and is **not** affected.)

---

## File structure (what each changed file owns)

**Backend:**
- `crates/syllabus-tracker/src/db/activity_read.rs` - `target_student_name` on struct + 3 queries + 3 mappers; broaden `dashboard_activity_feed` verb filter.
- `crates/syllabus-tracker/src/test/activity_read.rs` and/or `dashboard_*.rs` - assert target name populated and coach status changes surface.
- `.sqlx/` - regenerated cache.

**Frontend:**
- `frontend/src/lib/activity-line.ts` - `target_student_name` on `ActivityRow`; `ActivityScope` type; `activityLine(row, scope?)`; `suppressSurface` on `ActivityLine`; rewrite `syllabus_graduated` + `sst_status_changed` arms using `STATUS_LABELS`.
- `frontend/src/components/activity-feed-list.tsx` - `scope` prop threaded to `activityLine` (representative + members); skip surface chip when `suppressSurface`.
- `frontend/src/app/student-profile/page.tsx`, `frontend/src/app/student-activity/page.tsx` - pass `scope={{ kind: "student", studentId }}`.
- `frontend/src/app/dashboard/components/recent-activity-feed.tsx` - no change (gym default).
- Test fixtures listed in the DTO sync map.

---

## Task 1: Backend carries the target student's name

**Files:** `crates/syllabus-tracker/src/db/activity_read.rs`, `.sqlx/`

- [ ] **Step 1:** Add `pub target_student_name: Option<String>` to `ActivityRow` (after `target_student_id`).
- [ ] **Step 2:** In all three queries add the join and select. Actor join already exists as `u`; use a distinct alias `tu`:
  ```sql
  LEFT JOIN users tu ON tu.id = act.target_student_id
  ```
  and in each `SELECT` list:
  ```sql
  tu.display_name AS "target_student_name?: String",
  ```
  Nullable to match the sibling joined names (FK can be `SET NULL`). `dashboard_activity_feed` keeps its inner `JOIN users u` for the actor; the new join is `LEFT JOIN`.
- [ ] **Step 3:** In all three mappers add `target_student_name: r.target_student_name,`.
- [ ] **Step 4:** Regen sqlx cache: `nix develop .#ci --command just sqlx-prepare`.
- [ ] **Step 5:** Verify backend builds: `nix develop .#ci --command cargo build -p syllabus-tracker` (offline).

**Commit:** `feat(activity): Carry the target student's name on activity rows.`

---

## Task 2: Dashboard glance surfaces coach/admin actions

**Files:** `crates/syllabus-tracker/src/db/activity_read.rs`, backend tests

The current `dashboard_activity_feed` filter is `(u.role = 'student' AND act.verb IN (<positive engagement verbs>)) OR act.verb = 'syllabus_graduated'`. Coach/admin status changes (and other coach actions) are excluded.

- [ ] **Step 1: Write the failing test.** In `crates/syllabus-tracker/src/test/` (extend `activity_read.rs` or `dashboard_*.rs`): seed a coach `sst_status_changed` targeting a student, call `dashboard_activity_feed`, assert the row is returned and `target_student_name` is populated. Run it red.
- [ ] **Step 2:** Broaden the filter to include all coach/admin actions except undo/delete history verbs:
  ```sql
  AND (
        ( u.role = 'student' AND act.verb IN (
            'video_watched', 'attempt_logged', 'attempt_edited',
            'sst_status_changed', 'sst_student_notes_edited', 'technique_pinned'
        ) )
        OR ( u.role != 'student' AND act.verb NOT IN (
            'attempt_deleted', 'technique_unpinned', 'syllabus_unassigned',
            'sst_hidden', 'sst_unhidden', 'syllabus_technique_removed',
            'video_visibility_set'
        ) )
        OR act.verb = 'syllabus_graduated'
      )
  ```
  (The excluded set mirrors the non-notifiable / undo verbs in `db/activity.rs`. `syllabus_graduated` stays unconditional so a student self-graduation still shows.)
- [ ] **Step 3:** Regen sqlx cache (`dashboard_activity_feed` SQL changed): `nix develop .#ci --command just sqlx-prepare`.
- [ ] **Step 4:** Green the test: `nix develop .#ci --command cargo nextest run -p syllabus-tracker`.

**Commit:** `feat(activity): Surface coach actions on the dashboard recent-activity glance.`

---

## Task 3: Scope-aware line rendering (the abstraction)

**Files:** `frontend/src/lib/activity-line.ts`, `frontend/src/lib/activity-line.unit.test.ts`, plus the 7 fixture sites from the DTO sync map.

- [ ] **Step 1:** Add the new field to the TS interface and to all 7 fixtures (keeps `tsc` green):
  ```ts
  // ActivityRow interface, after target_student_id
  target_student_name: string | null;
  ```
  Each fixture base / `mockRow` gets `target_student_name: null` (override per test where a name is needed).
- [ ] **Step 2:** Add the scope model and `suppressSurface`:
  ```ts
  export type ActivityScope =
    | { kind: "gym" }
    | { kind: "student"; studentId: number };
  ```
  ```ts
  // ActivityLine
  /** When true, the feed should not render the syllabus surface chip (the
   *  syllabus is already named inline). */
  suppressSurface?: boolean;
  ```
- [ ] **Step 3:** Import labels and add the naming helpers:
  ```ts
  import { STATUS_LABELS } from "./status";

  function studentSyllabusHref(row: ActivityRow): string | undefined {
    if (row.target_student_id == null || row.syllabus_id == null) return undefined;
    return `/student/${row.target_student_id}/syllabi/${row.syllabus_id}`;
  }
  ```
- [ ] **Step 4:** Change the signature to `activityLine(row, scope: ActivityScope = { kind: "gym" })`. Compute, near the top:
  ```ts
  const isCoachAction =
    row.target_student_id != null && row.target_student_id !== row.actor_user_id;
  const surfaceImplicit =
    scope.kind === "student" && scope.studentId === row.target_student_id;
  const studentName =
    isCoachAction && row.target_student_name && !surfaceImplicit
      ? row.target_student_name
      : undefined;
  ```
- [ ] **Step 5:** Rewrite `syllabus_graduated`:
  ```ts
  case "syllabus_graduated": {
    const href = studentSyllabusHref(row) ?? syllabusHref(row);
    if (studentName && syll) return { verb: "graduated", subject: `${studentName}'s ${syll}`, href };
    return syll
      ? { verb: "graduated", subject: syll, href }
      : { verb: "graduated a syllabus", href };
  }
  ```
- [ ] **Step 6:** Rewrite `sst_status_changed`:
  ```ts
  case "sst_status_changed": {
    const payload = parsePayload<SstStatusChangedPayload>(row.payload_json);
    const label = payload?.to ? STATUS_LABELS[payload.to] : undefined;
    if (label && tech) {
      if (studentName && syll) {
        return { verb: `set ${tech} to ${label} on`, subject: `${studentName}'s ${syll}`, href: deep, suppressSurface: true };
      }
      return { verb: `set ${tech} to ${label}`, href: deep };
    }
    return tech
      ? { verb: "updated status on", subject: tech, href: deep }
      : { verb: "updated a technique status" };
  }
  ```
- [ ] **Step 7: Tests** in `activity-line.unit.test.ts`:
  - Replace the existing `went amber on` / `went green on` expectations with `set X to Doing` / `set X to Done`.
  - Coach graduation, gym scope: `graduated Dan Bennet's Blue Belt Syllabus`, href `/student/<id>/syllabi/<sid>`.
  - Coach graduation, `{ kind: "student", studentId: <target> }`: `graduated Blue Belt Syllabus` (no possessive).
  - Coach status, gym scope: `set Armbar to Doing on Charlotte's Blue Belt Syllabus`, `suppressSurface === true`.
  - Coach status, student scope: `set Armbar to Doing` (no possessive, no suppress).
  - Student self status (actor == target): `set Armbar to Doing` regardless of scope.
- [ ] **Step 8:** `cd frontend && npx tsc --noEmit && pnpm lint && pnpm vitest run --project node`.

**Commit:** `feat(activity): Render activity lines with context-aware student naming.`

---

## Task 4: Feed list threads scope and honors suppressSurface

**Files:** `frontend/src/components/activity-feed-list.tsx`, `frontend/src/components/activity-feed-list.test.tsx`

- [ ] **Step 1:** Add `scope?: ActivityScope` to `ActivityFeedListProps` (default `{ kind: "gym" }`). Thread it onto `RowOptions` and into both `activityLine` calls (the representative `ActivityRowItem` and the coalesced member rows at `:311`).
- [ ] **Step 2:** In `ActivityRowItem`, compute `const line = activityLine(activityRow, opts.scope);` and gate the surface chip render on `!line.suppressSurface` (the `surface && (...)` block at `:199`).
- [ ] **Step 3: Tests** (`*.test.tsx`, CI-only): a gym-scope coach status row renders the inline syllabus text and no surface chip; a coach graduation row renders the target student's name.
- [ ] **Step 4:** `cd frontend && npx tsc --noEmit && pnpm lint`.

**Commit:** `feat(activity): Thread viewing scope through the activity feed list.`

---

## Task 5: Wire scope at the single-student surfaces

**Files:** `frontend/src/app/student-profile/page.tsx`, `frontend/src/app/student-activity/page.tsx`

- [ ] **Step 1:** In both `<ActivityFeedList .../>` usages add `scope={{ kind: "student", studentId }}` (both pages already have `studentId` in scope).
- [ ] **Step 2:** Dashboard (`recent-activity-feed.tsx`) is left as the gym default; no change.
- [ ] **Step 3:** `cd frontend && npx tsc --noEmit && pnpm lint && pnpm vitest run --project node`.

**Commit:** `feat(activity): Scope the profile and timeline feeds to their student.`

---

## Final verification

- [ ] Backend: `nix develop .#ci --command just lint` and `nix develop .#ci --command cargo nextest run -p syllabus-tracker`.
- [ ] Frontend: `cd frontend && npx tsc --noEmit && pnpm lint && pnpm vitest run --project node`.
- [ ] Confirm `.sqlx/` regenerated and committed; offline build clean (`SQLX_OFFLINE=1`).
- [ ] Manual smoke (optional, via `/run`): dashboard glance shows "Matty Admin graduated Dan Bennet's Blue Belt Syllabus" linking to that student's syllabus, and "Matty Admin set <Technique> to Doing on Charlotte's Blue Belt Syllabus" linking to that technique; the same rows on a student's own profile drop the possessive.

## Notes / decisions

- No DB migration: `activity.target_student_id` FK already exists; this only joins `users` for the name.
- Graduation href lives in `activity-line.ts` (not `view-context.ts`) so the `ViewContextRow` subset type stays untouched.
- Coalescing is unaffected: `activity-coalesce.ts` keys on actor+verb+surface (scope-independent); `suppressSurface` is render-time only.
- Status deep link already resolves correctly via the existing `sst_status_changed` view-context; only the copy and dashboard visibility were broken.
