# Legacy decommission plan

Captured 2026-06-10. Companion to `PLAN.md`. PRs 1-4 of the syllabus
migration shipped clean. PR 5 deliberately stopped short of full removal:
legacy student-techniques and collections surfaces are parked behind
`/legacy/*` URLs so coaches can read off them while migrating prod
students into the new syllabus stack. User-level graduation
(`users.graduated_at`) likewise still ships its UI.

This document is the punch list for the cleanup PR that lands once prod
data is fully migrated. Earliest target: 2026-09-10 (the date already in
the dormant-module TODO comments). Do not start before the data
migration is signed off.

## Precondition

Before any of the work below begins:

1. Every prod student that had legacy `student_techniques` rows has been
   manually re-platformed onto one or more `syllabus_assignments`.
2. `SELECT COUNT(*) FROM student_techniques` on prod that should still
   matter is zero, OR the remaining rows are confirmed safe to leave in
   the dormant table.
3. No coach is still using the `/legacy/*` URLs in their daily workflow
   (light usage telemetry check, or just ask).
4. The user-level `users.graduated_at` flag has been audited: confirm
   nothing in app behavior keys off it any more, and that any user with
   it set is fine to log in normally.

If any of those is "no," fix that first; the cleanup is a no-op
without it.

## Frontend removals

### Routes

In `frontend/src/App.tsx`, drop:

- `/student/:id/legacy` (LegacyStudentTechniques)
- `/student/:id/legacy/technique/:techniqueId` (LegacyStudentTechniqueDetail)
- `/legacy/collections`
- `/legacy/collections/:id`

And the four lazy imports at the top of the file
(`LegacyStudentTechniques`, `LegacyStudentTechniqueDetail`,
`LegacyCollectionsPage`, `LegacyCollectionDetailPage`).

### Page files

Delete entirely:

- `frontend/src/app/student-techniques/`
- `frontend/src/app/collections/`

### Components

Delete:

- `frontend/src/components/assign-techniques.tsx`
- `frontend/src/components/add-techniques-to-collection-dialog.tsx`
- `frontend/src/components/graduate-confirm-dialog.tsx` (only if used
  exclusively by user-level graduation; double-check, the per-syllabus
  graduate flow uses its own confirm)

### Hooks and API client

In `frontend/src/lib/queries.ts`, remove:

- `useStudentTechniques`
- `useStudentTechniqueDetail`
- `useStudentUnassignedTechniques`
- `useCollections`
- `useCollection`
- `useCollectionStudents`

In `frontend/src/lib/mutations.ts`, remove:

- `useCreateCollection`
- `useUpdateCollection`
- `useDeleteCollection`
- `useAddTechniquesToCollection`
- `useRemoveTechniqueFromCollection`
- `useAssignCollectionToStudent`
- `useAssignTechniquesToStudent`
- `useCreateAndAssignTechnique`
- `useSetStudentGraduated`

In `frontend/src/lib/api.ts`, remove the matching request functions
including `setStudentGraduated`. Strip the legacy query keys from
`frontend/src/lib/query-keys.ts`.

### User-level graduation UI

The user-level graduate toggle currently lives on:

- `frontend/src/app/admin/page.tsx` (uses `useSetStudentGraduated`)
- `frontend/src/app/students-list/page.tsx` (uses `useSetStudentGraduated`)

Remove the toggle, the column header where it appears, and the
optimistic-patch wiring. `students-list/page.tsx` keeps its archive
toggle (`useToggleUserArchived`). Graduation now exists only
per-assignment.

The `graduated_at` field on the `User` type stays for now (the column
isn't being dropped in this PR; the schema change is later) but no UI
code reads or writes it.

### Dashboard and library

Two non-trivial callers that the syllabus migration carved out as
"deferred":

- `frontend/src/app/dashboard/page.tsx` still calls `useStudentTechniques`
  to drive its overview. This cleanup PR does NOT have to migrate
  dashboard; if dashboard is being rebuilt on top of the planned
  `activity` table (see `PLAN_ACTIVITY.md`), coordinate the order. If
  the activity work hasn't landed, either:
  - rebuild the dashboard on top of `student_syllabus_techniques` and
    `syllabus_attempts` as part of this PR, OR
  - leave `useStudentTechniques` in place and decommission it in a
    follow-up specifically tied to the dashboard rebuild.

  Decide before opening the PR. Don't half-do it.

- `frontend/src/app/library/page.tsx` imports `useCollections` for a
  "filter library by collection" affordance. Drop the affordance along
  with the hook removal; library no longer knows about collections.

### Tests

Vitest tests that reference removed modules need to go with them.
Backend integration tests covering only the legacy surface
(`test/api.rs` legacy-techniques tests, any `test/attempts.rs` tests
that target `attempts` rather than `syllabus_attempts`) can be
deleted. Test files covering shared behaviour (e.g. the videos test
file) stay; just drop the legacy-specific cases.

## Backend removals

### DB modules

Delete entirely:

- `crates/syllabus-tracker/src/db/student_techniques.rs`
- `crates/syllabus-tracker/src/db/collections.rs`
- `crates/syllabus-tracker/src/db/attempts.rs`

Update `crates/syllabus-tracker/src/db/mod.rs` to drop the `mod`
declarations and re-exports.

### Legacy helpers inside live modules

These three lived alongside still-active code and need surgical
removal:

**`crates/syllabus-tracker/src/db/videos.rs`:**

- `set_video_student_visibility`
- `list_video_student_overrides`
- `list_videos_for_technique_visible_to` (the legacy per-student
  filtered read; the syllabus-aware
  `list_videos_for_technique_in_syllabus_visible_to` replaces it for
  syllabus context, and `list_videos_for_technique_global_visible`
  replaces it for library context)
- `video_visible_to_student` is the **trickier one**: it gates playback
  and download in `videos/routes.rs:515, 563`. It is not legacy
  student-techniques code; it is the global per-video access check.
  When the legacy override table goes away, the gate simplifies to
  "deleted_at IS NULL AND (hidden_at IS NULL OR viewer is coach)" plus,
  if we want syllabus-scoped overrides to gate playback (currently
  they only filter the list), a join through
  `student_syllabus_video_visibility`. Decide which:
  - **Simplest:** strip the legacy join, ignore syllabus overrides for
    the playback gate. A coach who hides a video for a student in one
    syllabus only hides it from the syllabus VIEW; direct video URLs
    still play. Matches current expectation that overrides are a
    visibility nicety, not a hard ACL.
  - **Stricter:** rebuild the gate against
    `student_syllabus_video_visibility`. Needs a "is this video visible
    to this student in ANY assigned syllabus?" query. More work; only
    do it if a real product requirement exists.

  Pick one before the PR. Default recommendation: simplest.

**`crates/syllabus-tracker/src/db/users.rs`:**

- `graduate_user` / `ungraduate_user` (whatever they're called
  exactly): the helpers that write `users.graduated_at` and
  `graduated_by_id`. Delete.

The `graduated_at` and `graduated_by_id` columns on `users` stay in the
schema for now. Dropping columns from SQLite is non-trivial and the
column is harmless once nothing reads or writes it. A later schema
sweep can drop them.

### Routes

In `crates/syllabus-tracker/src/api.rs`, remove the route handlers
that backed the deleted hooks:

- legacy student-techniques CRUD
- legacy attempts CRUD
- collections CRUD + assignment
- `POST /api/users/<id>/graduate` (or equivalent), the user-level
  graduation endpoint, and its `ungraduate` counterpart

In `crates/syllabus-tracker/src/videos/routes.rs`, remove
`api_set_video_student_visibility` and the legacy override read in the
coach annotation path (around line 270). The syllabus-context override
endpoint introduced in PR 4 stays.

### Permissions

`Permission::AssignTechniques` in
`crates/syllabus-tracker/src/auth/permissions.rs` was kept separate
from `ManageSyllabi` specifically to gate the legacy flow. With the
legacy flow gone, this permission has no callers. Remove it from the
enum and from the role permission sets. Check the permission UI in
`/admin` doesn't list it.

### Tests

`crates/syllabus-tracker/src/test/attempts.rs` (legacy attempts tests)
goes. Sections of `test/api.rs` that exercise legacy routes go.
Anything in `test/feature_flags.rs` or `test/utils.rs` that seeds
`student_techniques` either deletes those rows or pivots to the new
tables.

Run `cargo sqlx prepare -- --tests` after the SQL deletions so the
`.sqlx/` cache stops carrying queries against removed tables.

## Schema drops (separate, later PR)

NOT part of this cleanup PR. Defer to a third PR after this one ships
and bakes for a release or two:

- `DROP TABLE student_techniques`
- `DROP TABLE student_technique_views`
- `DROP TABLE collections`
- `DROP TABLE collection_techniques`
- `DROP TABLE attempts`
- `DROP TABLE video_student_visibility`
- `ALTER TABLE users DROP COLUMN graduated_at` (SQLite-specific: this
  is a table-rebuild operation)
- `ALTER TABLE users DROP COLUMN graduated_by_id` (same)

Separating the table drops from the code removal gives one PR cycle to
roll back if anything was missed. A row in `student_techniques` is
recoverable; a dropped table is not.

## Verification

Per-commit gates already in CI continue to apply:

- `cargo build -p syllabus-tracker`
- `cargo test -p syllabus-tracker`
- `cargo sqlx prepare --check -- --tests`
- `pnpm -C frontend lint`
- `pnpm -C frontend build`
- `pnpm -C frontend test`

Manual checks:

- `grep -rn "useStudentTechniques\|useCollections\|useSetStudentGraduated"
  frontend/src/` returns zero hits.
- `grep -rn "student_techniques\|collection_techniques\|video_student_visibility"
  crates/syllabus-tracker/src/` only matches table definitions in
  `config/schema.sql` and the eventual drop migration; no application
  code.
- Walk the app as a coach: students list (no graduate toggle, archive
  still works), admin (no graduate toggle), library (no collection
  filter), syllabi, a student's syllabus, the student profile hub.
- Walk as a student.
- Hit `/student/<id>/legacy` and `/legacy/collections` directly:
  expect the default-route redirect, not the legacy page.
- Pull a prod backup, run the cleanup branch against it, confirm app
  boots and core flows work.

## Out of scope for this PR

- Dashboard rebuild on top of the new tables (see
  `PLAN_ACTIVITY.md`).
- Library stats migration (`/api/library/stats` and
  `/api/techniques/<id>/stats`) off the legacy tables.
- The actual `DROP TABLE` migration (separate later PR, per above).
- Anything multi-tenant (see the deferred multi-tenant plan memory).
