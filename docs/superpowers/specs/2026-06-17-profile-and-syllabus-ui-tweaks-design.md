# Profile & syllabus UI tweaks

Date: 2026-06-17
Branch: feat/camps-scoped-visibility (or a fresh branch off it)

A batch of UI changes across the student syllabus detail view, the student
profile page, and the coach/admin dashboard activity feed, plus recovery of a
lost coach account-management affordance.

## Goals

1. Promote the syllabus-detail context-menu actions to full buttons, and surface
   account management there.
2. Turn the profile page's "Syllabi" and "Pinned techniques" links into real
   preview sections (up to 5 items each).
3. Add account management + archive to the profile page.
4. Stop the dashboard activity feed from merging activity across different
   students.

## Decisions (locked)

- **Account credential management is admin-only.** `EditUserCredentials`
  (reset claim, edit another user's username/password) is an admin permission;
  coaches do not get it. The reset-password / issue-claim / edit-details
  controls for *another* user appear only to admins. A student always manages
  their own account.
- **Archive is coach-accessible** via a new dedicated endpoint (see below),
  mirroring how graduate already works (`POST /student/:id/graduate`,
  `ViewAllStudents`, students-only). It does NOT go through the admin-only
  `PUT /admin/users/:id` path.
- **Dashboard coalescing fix = per-student grouping key**, not a blanket
  disable. Same-student runs still collapse (flood protection); different
  students never merge.

## Background: the "lost" account dialog

The account-management UX the user remembers was on the now-**legacy**
`frontend/src/app/student-techniques/page.tsx` (App.tsx keeps it only for
side-by-side comparison). When `student-profile/page.tsx` replaced it, the coach
"Reset password / Copy invite link" dropdown and its claim-link dialog were
dropped. The same dialogs still live (near-verbatim) in
`frontend/src/app/admin/page.tsx`, and the self-edit forms live in
`frontend/src/app/profile/page.tsx`.

So the shared `AccountDialog` is a **consolidation/recovery**, not new design. It
reuses existing building blocks:

- `ClaimLinkPanel` (`components/claim-link-panel.tsx`) — QR + copy link.
- Mutations: `useUpdateUser`, `useResetUserClaim`, `useToggleUserArchived`
  (admin path), `useUpdateUserProfile`, `useUpdatePassword`, and a new
  `useArchiveStudent`.
- Zod schemas + `TracedForm` + `useFormWithValidation` patterns already used in
  admin and profile pages.

## Change 1: Student syllabus detail view

File: `frontend/src/app/student-syllabi/[syllabusId]/page.tsx`

- Replace the coach-only `DropdownMenu` (Sync with current syllabus / Graduate /
  Unassign) with full buttons. Keep the existing **Add technique** button as the
  primary full-width action; render the three former menu items as buttons:
  - **Sync with current syllabus** — outline, opens existing `DiffDialog`.
  - **Graduate / Ungraduate syllabus** — outline, opens existing graduate dialog.
  - **Unassign syllabus** — outline + `text-destructive`, opens existing
    unassign dialog.
  - Layout: a wrapping `flex` row (`flex-wrap gap-2`) of equal-ish buttons under
    the primary action. All existing handlers/dialogs are unchanged; only the
    trigger surface changes.
- **Manage account** button: rendered only when the viewer is an admin (not the
  owner). Opens the shared `AccountDialog` targeting this student. Coaches see
  no account button here (admins-only decision).
- Remove now-unused `DropdownMenu*` imports if nothing else needs them.

## Change 2: Student profile page — preview sections

File: `frontend/src/app/student-profile/page.tsx`

- Remove the `HubLink`s for "Syllabi" and "Pinned techniques".
- Add two preview sections, each capped at 5 items, heading links to the full
  page:
  - **Syllabi** (`useStudentSyllabi(studentId)`): section heading links to
    `/student/:id/syllabi`. Each row links straight to
    `/student/:id/syllabi/:syllabusId`. Rows reuse a new shared
    `SyllabusAssignmentRow` extracted from the existing list markup in
    `student-syllabi/page.tsx` (name + technique count + red/amber/green
    `ProgressChips`). Extract `SyllabusAssignmentRow` (and the `ProgressChips`/
    `Chip` helpers it needs) into
    `student-syllabi/components/syllabus-assignment-row.tsx`; the list page
    imports it too (no behavior change there).
  - **Pinned techniques** (`useStudentPinnedTechniques(studentId)`): heading
    links to `/student/:id/pinned`. Up to 5 `TechniqueRow`s in `student-pinned`
    context inside an `Accordion`, expand-in-place. Preview is view/expand only:
    do NOT wire `onUnpinIntent` / `onAddToCampIntent` (those stay on the
    dedicated page). Local `expandedValue` state for the accordion.
  - Each section shows a lightweight empty state ("No syllabi yet" / "No pins
    yet") when the list is empty, consistent with the dedicated pages' copy.
- The existing "spaces" card keeps Library (owner only) + Camps/Matches (gated by
  `campsUiEnabled`). Render the card only if it would contain at least one entry
  (e.g. a coach viewing with camps gated off would otherwise see an empty card).
- "See all" / section headings use the existing muted-uppercase section style
  already on the page.

## Change 3: Student profile page — account + archive

File: `frontend/src/app/student-profile/page.tsx` plus a new
`frontend/src/components/account-dialog.tsx`.

`AccountDialog` props (sketch):

```ts
interface AccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: User;          // the account being managed
  mode: "self" | "admin"; // capability set
}
```

Capability matrix:

- **Owner (student managing self), `mode="self"`**: edit own display name +
  username (`useUpdateUserProfile`), change own password with current-password
  confirmation (`useUpdatePassword`). No reset-claim, no archive, no role.
- **Admin viewing another, `mode="admin"`**: edit display name + username +
  set password directly (`useUpdateUser`); reset password / issue claim link
  (`useResetUserClaim` + reset-confirm `AlertDialog` + issued-claim `Dialog`
  with `ClaimLinkPanel`); archive toggle. Claimed vs unclaimed mirrors the admin
  page: claimed -> "Change password" + "Reset password"; unclaimed -> "Copy
  invite link". Role editing is out of scope (stays on the admin page).
- The dialog internally hosts its forms (mirroring admin/profile pages) and the
  reset-confirm + issued-claim sub-dialogs (mirroring the legacy
  student-techniques page).

Profile page wiring:

- Add an **Account** trigger button in the profile header section, shown when
  `isOwnView` (opens `mode="self"`) or when the viewer is an **admin** viewing
  another student (opens `mode="admin"`). A coach (non-admin) viewing another
  student does NOT get the account button.
- **Archive** control for a coach/admin viewing another student:
  - If admin: archive can live inside `AccountDialog` (admin mode).
  - If coach: no account dialog, so surface a standalone **Archive student** /
    **Unarchive student** button (with a confirm `AlertDialog`) in the header.
  - Both call the new `useArchiveStudent` mutation against the new
    coach-accessible endpoint, so the behavior is identical regardless of role.
    (Using the coach endpoint for admins too keeps one code path; the admin-only
    `PUT /admin/users/:id` archive path stays for the admin roster page.)
  - Show an "Archived" badge near the name when `student.archived`.

### Backend: coach-accessible archive endpoint

File: `crates/syllabus-tracker/src/api.rs` (+ `main.rs` route registration).

- New `POST /student/<id>/archive` taking `{ archived: bool }`, requiring
  `Permission::ViewAllStudents`, restricted to target users whose role is
  `Student` (mirror `api_set_student_graduated`). Calls the existing
  `set_user_archived(db, id, archived)`.
- Register in `main.rs` alongside `api_set_student_graduated`.
- Frontend: add `archiveStudent(studentId, archived)` to `lib/api.ts` and
  `useArchiveStudent` to `lib/mutations.ts`, invalidating the users list and the
  relevant student/dashboard feeds (match the invalidation set of
  `useToggleUserArchived` / `useSetStudentGraduated`).
- Tests: add an API test (coach can archive a student; coach cannot archive a
  coach/admin; archived flag round-trips) near the existing graduate tests.

## Change 4: Dashboard activity coalescing

File: `frontend/src/lib/activity-coalesce.ts`

- `surfaceKey(row)` currently keys on `syllabus:<syllabus_id>` or
  `context_kind`. Include the subject student so cross-student rows never merge:
  prefix (or incorporate) `row.target_student_id`. Concretely, return something
  like `student:<target_student_id>|<existing surface key>` (when
  `target_student_id` is present), falling back to the current key when null.
- Net effect: a coach setting two statuses on Harry's Blue Belt syllabus still
  collapses into one entry; Harry's and Charlotte's never merge.
- The dashboard feed keeps `coalesce` enabled
  (`dashboard/components/recent-activity-feed.tsx` unchanged).
- Update/extend `activity-coalesce` unit coverage (and any
  `activity-feed-list.test.tsx` fixtures that relied on cross-student merging)
  to assert different `target_student_id` rows do not coalesce.

## Out of scope

- Refactoring the self `/profile` page onto `AccountDialog` (leave as-is; can
  follow later).
- Refactoring the admin roster page dialogs onto `AccountDialog` (optional
  follow-up; not required for this batch). If trivial during extraction, it may
  be pointed at the shared component, but it is not a goal.
- Role editing outside the admin page.
- Removing the legacy `student-techniques` page.

## Test / verify plan

- `just verify` (offline build + lint + vitest unit; browser `.test.tsx` run in
  CI only on this box).
- New Rust API tests for the archive endpoint.
- Manual: admin sees full account dialog on profile + syllabus; coach sees only
  archive on profile; student sees self account dialog; dashboard feed no longer
  merges across students; profile preview sections cap at 5 and deep-link
  correctly.
```
