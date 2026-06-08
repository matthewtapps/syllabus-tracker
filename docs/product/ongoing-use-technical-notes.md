# Sillybus ongoing-use, technical exploration notes

## Purpose

This doc lives alongside `ongoing-use-concepts.md` and `ongoing-use-stories.csv` and captures technical/infra considerations that surfaced during product ideation. Nothing here is a user story; this is engineering context to consult when we're preparing to implement.

Several of these were raised by a rubber-duck review of the user-story doc against the current codebase. Topics are organised by area, with each entry covering current state, target state, and open questions.

---

## 1. Video parent polymorphism (single bundled story)

### Current state

- `videos.technique_id` is `NOT NULL` (`config/schema.sql:124`).
- Two indexes assume this: `idx_videos_technique_position`, `idx_videos_alive_by_technique`.
- `crates/syllabus-tracker/src/db/videos.rs` queries by `v.technique_id = ?` throughout (e.g. `list_videos_for_technique`, `video_visible_to_student`).
- Upload route is technique-scoped: `POST /api/techniques/<technique_id>/videos/upload` in `crates/syllabus-tracker/src/videos/routes.rs:86`.
- sqlx offline mode caches all of the above query shapes in `.sqlx/`.

### Target state

A video can have one of several parent kinds:

- `technique` (existing global-library behaviour)
- `camp` (CC-016)
- `match` (CC-021)
- `profile` (CC-017, ad-hoc / historical footage)
- `thread` (CX-008/CX-009, video replies in a thread; never promoted globally)
- `loose` (CX-018, no parent yet, awaiting CC-019 attach)

Stories that need this: CX-008, CX-018, CC-016, CC-017, CC-018, CC-019, CC-021, CC-023.

### Approach

Two reasonable shapes:

- **(A) Polymorphic columns**: `videos.technique_id` becomes nullable, add `parent_kind TEXT NOT NULL` and `parent_id INTEGER NOT NULL`. The `technique` kind keeps `technique_id` populated for backwards compatibility, or migrates entirely to the new columns. Indexes split per kind.
- **(B) Join table**: keep `videos` parent-agnostic, add `video_parents` with `(video_id, parent_kind, parent_id)`. Allows a video to have multiple parents (could be useful: a video promoted from a thread to a technique still references its origin thread).

(B) is more flexible and matches the "video promotion" workflows naturally. (A) is closer to the existing shape and probably faster to land. Pick before implementing.

### Migration considerations

- Existing rows all have `technique_id` populated. The first migration step is making it nullable + writing the new columns/table. Then sqlx queries get updated. Then `.sqlx/` cache rebuilds via `just sqlx-prepare`.
- Cascade-delete semantics need a deliberate decision per parent kind:
  - Delete a camp → camp videos: keep them (re-parent to profile?) or hard delete?
  - Delete a match → match videos: keep them, demote to camp scope?
  - Delete a thread → video replies in thread: hard delete?
- `videos.deleted_at` (soft delete) should still apply universally.
- `idx_videos_alive_by_technique` partial index only makes sense for `parent_kind=technique`. New indexes likely needed per parent kind for queries that filter scope.
- The app panics on schema mismatch (`crates/syllabus-tracker/src/main.rs:140`). Migration plan must be ordered so prod migrate runs before the new app code ships.

### Open question

- Does a thread reply-video also count as "attached to its thread for cascade purposes," or is the thread just a parent-by-convention with the video standalone in `videos`?

---

## 2. Footage Submitter as a sub-role on Student

### Decision

Footage Submitter is a **role**, not a per-user permission flag. Roles available to students:

- `Student` (base, no footage upload)
- `FootageSubmitterStudent` (new, can upload to profile / camp / match / threads they're part of)

Coach and Admin retain implicit upload capability via their role's permission set.

### Why this shape

- The existing `Permission` enum aggregates into static `HashSet`s per role (`crates/syllabus-tracker/src/auth/permissions.rs:8-92`). A per-user permission would require either bifurcating the API surface or threading per-user resolution through every existing `user.require_permission(...)` call site.
- A new role variant fits the existing model cleanly: just add to the `Role` enum and the static permission sets.

### Schema impact

- No new columns. `users.role` is already `TEXT`; just add the new variant.
- Existing students stay `Student`. Promotion to `FootageSubmitterStudent` is a coach-initiated `update_user_role` call (existing endpoint, just expand allowed roles for that action).

### Permission additions

- `Permission::SubmitFootage`: granted to `FootageSubmitterStudent`, `Coach`, `Admin`. Not granted to `Student`.

### UI implications

- "Promote to Footage Submitter" / "Revoke Footage Submitter" actions on the student profile (coach-only).
- The role change should not affect anything else about the student's experience; they keep all their existing techniques, camps, etc.

---

## 3. Notes storage for pinned techniques

### Decision

Notes are keyed by `(student, technique)`. There is **one shared notes record** per pair, and it appears in every view of that pair (syllabus, pinned, camp).

### Implications

- `student_techniques` table is the canonical location. Today it represents a syllabus assignment. We need to either:
  - **(A)** Add a `source` column or set of boolean flags (`in_syllabus`, `pinned`, `in_camp`) so a single row can represent multiple relationships, OR
  - **(B)** Keep `student_techniques` as the syllabus row but extract notes to a separate `(student_id, technique_id) -> notes` table that all contexts read from. Then add a separate `pinned_techniques` table for the pinning relationship.

(B) is cleaner: it separates "relationships" from "shared content per pair." (A) compresses storage but couples relationship semantics to a single row.

### What this affects

- `SD-004` (pinned notes): same notes appear across all views.
- `SD-008` (syllabus context surfaces on pinned view): partially automatic now (notes auto-appear); the explicit story is about surfacing status + attempts + relationship history.
- `CC-037` (promote pinned to camp): notes don't need to migrate, they're already shared.
- The existing `coach_notes` and `student_notes` columns on `student_techniques`: under (B), these move to the new notes table.

### What stays scoped

Threads and comments stay context-scoped: a thread on the syllabus technique is a different artifact from a thread on the pinned view of the same technique. Only **notes** (the free-text fields) are shared.

### Open questions

- If we go with (B), what's the migration path for existing `student_notes` / `coach_notes` data on the current `student_techniques` rows? Probably: copy on read, write to new table going forward, drop old columns after a window.
- Permission model: a pinned technique that's not in syllabus still has notes. Who can edit / view them? Same rules as the syllabus version (student edits own notes, coach edits coach notes, both visible to both).

---

## 4. CX-019 visibility model refactor

### Current state

- `videos.hidden_at` is the global hide (no student sees the video).
- `video_student_visibility` is a per-(video, student) override that applies everywhere today.
- `crates/syllabus-tracker/src/db/videos.rs:237-260` has `video_visible_to_student`, a shared playback guard called from playback and download routes (`crates/syllabus-tracker/src/videos/routes.rs:497,547`).

### Target state

- `videos.hidden_at` stays global (no student sees it anywhere).
- Today's `video_student_visibility` becomes **syllabus-scoped**: it only matters inside the syllabus view. Rename to make this obvious (e.g. `syllabus_video_student_visibility`).
- `camp_video_visibility` (CC-015) is camp-scoped: only matters inside that camp.
- Library browse, thread context, pinned context: only `videos.hidden_at` applies. No per-student overrides.

### Refactor friction

The shared `video_visible_to_student` guard doesn't know its calling context. Two ways to handle:

- **(A) Context-aware guard**: callers pass a context arg (`Library`, `Syllabus`, `Camp(camp_id)`). The guard checks the right table per context.
- **(B) Unified "any context" predicate**: separate predicate `video_visible_anywhere_to_student` for routes that just need yes/no access (playback / download endpoints). Callers in specific contexts use their own narrower predicate.

(A) is more explicit and probably safer. (B) is simpler but risks playback endpoints granting access based on syllabus visibility when the student is consuming the video in a context where it should be hidden.

### Call site audit

When this lands, every call to the current visibility predicate needs to be reviewed:

- `videos/routes.rs:497` (`api_video_playback_url`)
- `videos/routes.rs:547` (`api_video_download_url`)
- Anywhere else querying `video_student_visibility` directly

### CX-013 interaction

CX-013's "make visible" prompt depends on which hide is in play. With CX-019 in place, the cases are:

- Globally hidden → "Unhide globally?" (un-set `videos.hidden_at`, affects everyone)
- Syllabus-hidden for this student → "Unhide for them?" (delete the syllabus-scoped row, affects only this student in syllabus context)

The prompt text and branching logic is captured in CX-013's acceptance notes.

---

## 5. `/library` route, coach-only vs student access

### Current state

`frontend/src/App.tsx:164-171` gates `/library` to `coach` and `admin` only. Same for `/collections` and `/collections/:id`.

### Target state (SD-001)

Students can browse the library too. Scoped techniques (CC-010) belonging to other students should not surface for them.

### Two approaches

- **(A) Same route, role-branched page**: `/library` becomes accessible to all roles. The page renders differently per role (coach sees scoped techniques + edit affordances; student sees just the public library). Keeps the URL stable, leverages existing routing.
- **(B) Separate student route**: e.g. `/browse` for students, keep `/library` for coaches. Cleaner separation but adds a route.

(A) preferred: stable URLs, simpler menu wiring.

### What the student version needs to hide

- Technique edit buttons
- Tag management UI
- Scoped techniques from other students
- The "scoped techniques" filter (CC-012/CC-013 is coach-only)

---

## 6. Soft-delete / soft-flag convention

### Current pattern in the schema

- `videos.deleted_at` (soft delete)
- `videos.hidden_at` (soft global hide)
- `users.archived` (boolean, not timestamp; outlier)
- `users.graduated_at` (timestamp)
- `invite_tokens.used_at` (timestamp)

The dominant pattern is **nullable timestamp**. Boolean flags lose the "when did this happen" signal.

### Going forward

New "soft" states should follow the nullable timestamp pattern:

- `camps.archived_at` (CC-029)
- `pinned_techniques.unpinned_at` (SD-006)
- `threads.deleted_at` + `comments.deleted_at` (CX-023)

Reserve hard deletes for admin-only actions where audit value is low (e.g. spam cleanup).

---

## 7. Activity feed model (item-based, deduplicated)

### Model

The activity feed renders **top-level items**, not individual events. Each top-level item appears at most once in the feed; multiple activities on the same item collapse into one row that shows the most recent activity as a preview.

Think of it like a Slack channel sidebar (channels ordered by most-recent message), not a Twitter timeline (every event is its own row).

### Top-level item kinds

- **Technique** (in any of: syllabus, pinned list, library, camp). One feed row per technique regardless of how many contexts it appears in.
- **Camp** (generic or competition).
- **Match** (a row inside a competition camp, but a top-level item in the feed because it has its own footage and threads).
- **Profile thread** (a thread anchored to the student profile, not to a video or technique).
- **One-off events** (rank changes; possibly other future event types that don't have a durable parent). These don't dedupe; each instance is its own feed row.

### Activity types that bump an item's position

- Comments / replies on any video, thread, or attempt anchored to the item
- Video uploads attached to the item
- Video watches by the student on any video attached to the item (CX-003 explicitly includes these; see goal "student initiative visible to coaches")
- Status changes on the syllabus version of a technique (red → amber, etc)
- Pin / unpin events on a technique (pin bumps; unpin does NOT)
- New thread anchored to the item

### Parent resolution rules

When an activity event happens, we need to know which top-level item it bumps:

- Video watch / upload / comment → resolve via `videos.parent_kind/parent_id` to the parent (technique, camp, match, or thread). The parent IS the top-level item.
- Thread reply → bump the thread's parent (video → technique/camp/match; profile → profile thread itself; etc).
- Syllabus attempt → bump the underlying technique.
- Match log → bump the match (since matches are their own top-level items).

When a technique appears in multiple contexts for the same student (in syllabus, pinned, in camp), there is still **one** feed row for the technique. The row preview shows the latest activity regardless of which context it happened in. The user can drill in to see context.

### Phase-2 unification

CX-021 (attempt threads) and CX-022 (syllabus-technique threads) introduce new thread anchor kinds. Under the item-based model these just become new things that bump the parent technique. No need to add new feed item kinds; the existing technique item naturally absorbs them.

### Unseen activity boundary (CX-027)

Today, the syllabus view surfaces "needs my action" per-row via `student_technique_views` (`crates/syllabus-tracker/src/db/student_techniques.rs`). For the feed-level boundary indicator, we need a per-(viewer, item) `seen_at` so we can place a divider between unseen and seen items in the chronological list.

Likely shape:

- New table `feed_item_views` keyed by `(viewer_id, item_kind, item_id, seen_at)`.
- Update on scroll-past (debounced) or explicit interaction.
- Feed query joins this in and returns each item's seen status. Frontend places the divider at the boundary.

Cheaper alternative: single `last_visited_at(viewer, profile_owner)` and consider any item with `latest_activity_at > last_visited_at` as unseen. Loses granularity (interacting with one item doesn't mark just that one seen) but cheaper to query and simpler to reason about. Decide based on UX requirements.

### Performance note

The dedup-by-item query needs an efficient way to group activity events by parent item and find the max timestamp per group. SQLite can do this with a window function or a correlated subquery. Watch this query in particular as the dataset grows; might need a denormalised `item_latest_activity` cache eventually.

---

## 8. Activity feed: who gets the broadcast-comment event?

SD-012 (coach broadcasts a comment on a library video) doesn't specify whose activity feed gets the event. Options:

- Coach who left it (their own activity feed)
- Every recipient student's feed
- Nobody (broadcast is silent unless the recipient is watching the video)

Decide before implementing. Probably "coach's own feed + a navbar notification (CX-025) for any student currently watching"; we don't want to spam every student's feed with every coach broadcast.

---

## 9. CC-034: which camp does an approved suggestion go into?

If the student has multiple active camps, the approved suggestion needs a target. Acceptance to add to CC-034:

- Coach picks the target camp at approval time (small dropdown of the student's active camps)
- If only one active camp, default to it without prompting
- Cancel approval if no active camps exist (or offer "create a new camp for this")

---

## 10. Story ID gaps

The CSV intentionally skips `SD-005` and `SD-007`. These were original stories (`SD-005`: log attempts on self-assigned technique; `SD-007`: unarchive self-assigned technique) that were removed during revision after the user feedback that attempts are syllabus-only and pinning/unpinning replaces the archive mechanism. IDs are not renumbered to preserve dependency references in the `Depends on` column of other stories.

---

## 11. Pending decisions

These are listed in the story doc but need explicit calls before implementation:

- **Activity feed action-priority distinction** (CX-003 / CX-020): visual treatment for "needs my action" items vs pure history. See section 7 above. Needs UX direction.
- **CC-034 target-camp selection**: see section 9.
- **SD-012 broadcast feed scope**: see section 8.
- **Pinned notes storage shape (A vs B)**: see section 3.
- **Video parent shape (A vs B)**: see section 1.
- **Visibility guard refactor shape (A vs B)**: see section 4.

These should be revisited when the corresponding stories enter implementation, not during product validation.
