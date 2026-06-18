# Camps & Competitions tweaks — design

Date: 2026-06-18
Branch: `feat/camps-tweaks`

## Context

Camps and competitions currently work but are stitched together loosely:

- A camp can be generic or competition-linked (`camps.competition_id`). A camp is
  promoted to a competition camp manually via the camp detail page (`PromoteDialog`).
- Competitions exist independently; students register via the competition detail
  page roster (coach) or a self-register button (student).
- Registering a student does **not** create or link any camp. The link only exists
  if a coach later promotes a camp.
- Matches hang off a registration and only surface inside a competition-linked camp.

The owner wants camps and competitions tied closer, a crash fixed, the match UI
simplified, the social tile corrected, the selection UIs polished, and the first
slice of a cross-camp "pull prior work into a new camp" workflow.

All required columns already exist (`camps.competition_id`, `camps.references_camp_id`).
**No database migration is required for any slice.**

## Slices

The work is split into independently shippable slices, each its own commit(s) and
push. Slices 1–4 are well-defined; Slice 5 is an explicitly-scoped MVP with named
deferrals.

---

### Slice 1 — Match dialog crash + "+ match" relabel + lighter form

**Bug.** `LogMatchDialog` (`frontend/src/app/camps/[id]/page.tsx`) renders
`<SelectItem value="">None</SelectItem>` for the optional match method. Radix UI
forbids a `Select.Item` with an empty-string value and throws synchronously during
render. The throw bubbles to `AuthErrorBoundary`, which renders the generic
"Session lost / We could not read your session" panel — so the real cause is masked.

**Fixes.**
1. Replace the empty-string method option with a non-empty sentinel (`"none"`),
   mapping `"none"` → `null` on submit and `null`/absent → `"none"` on the form
   default. The Zod schema drops `""` from the method enum.
2. Rename the trigger button from **"Log match"** to **"+ match"** (icon + `match`),
   and the dialog title from "Log match" to "Add match". The submit button reads
   "Add" / "Adding…".
3. Keep the fields (result, optional method, optional detail, optional date) — the
   owner calls match details "pretty arbitrary", so nothing is made mandatory beyond
   `result`, which keeps its `win` default. No new required fields.

**Tests.** A Vitest browser test that opens the match dialog and asserts it renders
without throwing (would have caught the Radix crash), and that submitting with method
"None" sends `method: null`.

---

### Slice 2 — Registration creates/links a competition camp

**Goal.** Registering a student for a competition ensures the student has a camp
linked to that competition. The coach can either promote one of the student's
existing (unlinked, active) camps, or create a fresh one. A fresh camp gets a
default editable name derived from the competition: `"<Competition name> Camp"`
(e.g. "Worlds 2026" → "Worlds 2026 Camp"). Generic naming is fine because camps are
per-student.

**Backend.**
- New db helper `ensure_competition_camp(tx, student_id, competition_id, by_id, choice)`
  in `db/competitions.rs` (or `db/camps.rs`), where `choice` is an enum:
  - `Existing(camp_id)` — verify the camp belongs to `student_id` and is not already
    linked to a competition; set its `competition_id` and emit
    `CampPromotedToCompetition`.
  - `CreateNew` — create a camp named `"<comp.name> Camp"` with `competition_id` set,
    emit `CampCreated`.
  - Idempotency: if the student already has **any** camp linked to this competition,
    do nothing (covers re-registration via the existing upsert path).
- `register_student` runs inside its existing transaction; after the registration
  upsert, call `ensure_competition_camp` with the chosen `choice`. Re-using the same
  tx keeps registration + camp atomic.
- Route changes:
  - `POST /competitions/<id>/register/<student_id>` (coach): accept an optional JSON
    body `{ "camp": { "existing": <id> } }` or `{ "camp": "create_new" }`. Absent body
    defaults to `create_new` (preserves current callers).
  - `POST /competitions/<id>/register` (self): always `create_new`. Students lack
    `ManageCamps`, so they never choose; the camp is created on their behalf with
    `coach_id = competition.created_by_id`.
- `coach_id` on an auto-created camp: the registering coach for the coach path;
  `competition.created_by_id` for the self path.

**Frontend.**
- `RegisterStudentDialog` (competition detail) gains a second step after the student
  is chosen: a camp choice. If the student has unlinked active camps, show them as
  selectable options plus a "Create a new camp" option (default selected). If they
  have none, the dialog states a new camp will be created. The chosen option is sent
  in the register body.
- `useRegisterStudent` / `registerStudent` carry the camp choice. `useRegisterSelf`
  is unchanged on the wire (server defaults to create_new) but its `onSuccess`
  invalidates the student's camp list too.
- Invalidate `qk.campsForStudent(studentId)` and `qk.competition(id)` after register.

**Tests.** Backend: register-coach with `create_new` makes a `"<name> Camp"`; with
`existing` promotes that camp; re-register is a no-op. Self-register makes the camp.

---

### Slice 3 — Promote-camp social tile links the camp

**Bug.** The `camp_promoted_to_competition` tile surfaces/links the **competition**,
not the camp that was promoted. The promote action is inherently about both, but the
camp is the thing the coach navigates to.

**Fixes (frontend, pure functions + a CrumbIcon).**
- `rowToViewContext` already routes `camp_promoted_to_competition` to the camp page
  when `camp_id` is present; ensure `buildPath` emits a **camp** crumb (dumbbell,
  deep link to `/camps/<id>`) for this verb, and that the activity read row carries
  `camp_id`/`camp_name` (it does — verified in `db/activity_read.rs`).
- Add a competition (trophy) icon arm to `CrumbIcon` in `activity-tile-header.tsx`
  so competition surface crumbs are not mis-iconed as the library.
- Caption keeps naming the competition ("Promoted a camp" / "linked a camp to …")
  but the navigable crumb is the camp.

**Tests.** Extend `view-context.unit.test.ts` / `activity-line.unit.test.ts` to
assert the promote row yields a camp crumb with an `/camps/<id>` href.

---

### Slice 4 — Polish the student/camp selection interfaces

The owner finds the camp/competition selection UIs out of place versus the rest of
the app. Targets, in priority order:

1. **`RegisterStudentDialog`** (the main offender): replace the raw
   `<ul><button>` student list with the project's component vocabulary — a searchable
   `Command`/combobox for the student, consistent spacing, the shadcn selectable-card
   pattern already used by `ScopeOption` for the camp choice, and standard dialog
   footer buttons. Follow `shadcn-ui-design`.
2. **`PromoteDialog`** (camp detail): align copy and the Select with the rest;
   it stays a Select but matches the polished register dialog.
3. **Camp choice cards** reused between the register flow (Slice 2) and a future
   promote flow — a single small `CampChoiceList` component.

No behaviour change beyond what Slices 2/3 introduce; this is presentation +
consistency only.

---

### Slice 5 — Pull prior work into a camp (MVP of cross-camp surfacing)

**Motivating workflow (owner's words, paraphrased).** Run a competition camp, log
matches, after the event attach footage/results, then archive the camp — and reuse
that camp's raw match footage and discussion to inform the *next* camp's prep. We
need a way, inside a camp, to look through the student's previous camps and other
content and feed it into a new (especially competition) camp.

**MVP scope (this slice).** Inside camp detail, a coach-only **"Pull from previous
work"** panel/dialog that:
- Lists the student's *other* camps (active + archived), newest first, each
  expandable to show its techniques and a count of its videos, with deep links.
- Lets the coach **pull a technique** from a prior camp into the current camp
  (re-uses the idempotent `add_camp_technique`; global techniques link, scoped
  techniques are surfaced read-only with a deep link since they cannot leave their
  owning camp).
- Surfaces prior-camp discussion threads as read-only deep links so the coach can
  jump to relevant prep conversations.
- When creating a camp from the profile, the existing "Builds on" selector remains
  the lineage hint; a camp created with `references_camp_id` set deep-links its
  source in the existing "Builds on" section (already implemented). The pull panel
  defaults its "source camp" selection to `references_camp_id` when present.

**Explicitly deferred (NOT in this slice; recorded as follow-ups).**
- **Cross-camp video reuse.** Videos have a single typed parent (`VideoParent`);
  showing one camp's match footage *inside* another camp requires either a
  many-to-many video↔surface model or a video-reference table. This is a model
  change and is out of scope here. The pull panel deep-links to prior videos
  rather than copying them.
- **Post-competition results → prior-camp feedback loop** as an automated flow.
- **Comment/thread re-anchoring** across camps.

These deferrals keep Slice 5 free of schema changes and within the existing
authz/data model while delivering the core "see and pull prior techniques + jump to
prior footage/discussion" value.

## Out of scope

- Any database migration (none needed).
- Changing the match data model (the typed-column anchors stay).
- Multi-tenant / billing concerns.

## Testing & rollout

- Backend: `nix develop .#ci --command just test` (offline sqlx is the gate);
  regenerate sqlx data with `nix develop .#ci --command just sqlx-prepare` if any
  query changes, never bare `cargo sqlx prepare`.
- Frontend: unit tests run locally; `.test.tsx` browser tests run in CI (Chromium),
  stub `window.fetch`.
- `just verify` before PR. CI gates on PR. Deploy to staging via the manual
  staging-sibling workflow after the PR is green.

## Commit plan

Small atomic commits, no `Co-Authored-By` trailer, pushed as they land:
1. Slice 1 fix + relabel + test.
2. Slice 2 backend (db + routes + sqlx) then frontend (dialog + mutations).
3. Slice 3 tile fix + tests.
4. Slice 4 polish.
5. Slice 5 MVP backend (if any) + frontend panel.
