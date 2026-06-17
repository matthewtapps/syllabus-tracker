# Camps on the student profile, and retiring the standalone matches surface

Date: 2026-06-17
Status: Approved (design)
Branch: `feat/camp-ui-tweaks` (rebased onto `feat/profile-page-tweaks-and-student-account-controls`)

## Problem

Camps and matches are currently modelled in the UI as two separate "spaces" reached
from a list on the student profile (`Camps`, `Matches`, alongside `Library`).

Two things are wrong with this:

1. **Matches are not a top-level concept.** A match only exists inside a competition
   camp. The standalone `/student/:id/matches` page presents matches as a free-standing
   cross-camp history, which misrepresents the model. Matches are already keyed to a
   competition registration, and a competition camp already owns that registration, so
   matches belong inside the camp detail page (where they are already shown and editable).

2. **Camps deserve to be visible inline, not hidden behind a link.** The profile should
   show the student's camps directly (up to 5), as trailhead cards that open the camp.

Separately, the branch we are rebasing onto
(`feat/profile-page-tweaks-and-student-account-controls`) has already converted Syllabi
and Pinned from single links into full preview sections, and added Account/Archive
controls to the profile header. After that work plus ours, the "Spaces" list holds only a
`Library` link (own view) plus the `Camps`/`Matches` links we are removing. Library is
already reachable from both the top navbar and the bottom nav, so the entire "Spaces"
section can be removed.

## Scope

This is **Chunk A** of a larger effort. In scope:

- Remove the "Spaces" section from the student profile entirely.
- Add a **Camps preview section** to the profile (up to 5 cards), matching the
  Syllabi/Pinned preview pattern already on the page, with the "Add camp" action retained.
- Enrich the camps list payload so cards can show competition name, technique/video
  counts, and a last-activity timestamp.
- Retire the standalone matches surface (page, route, cross-camp aggregate query/hook)
  and repoint match activity deep-links to the owning camp.

Explicitly **out of scope** (later chunks):

- **Chunk B, match model overhaul:** match titles, a "mark complete" workflow, score,
  win condition (including overtime), win/loss, duration (total/elapsed), the finishing
  submission as a first-class technique link, threads on matches, and letting the owning
  student manage matches. None of that is touched here.
- **Rich aggregated social tiles.** Research (Stream's "aggregated feed"; NN/g's rule that
  a card is a trailhead, not the full detail) confirmed that embedding an entire camp
  (discussion + video player + match log + technique list) into a feed tile is an
  anti-pattern: a live sub-app in a feed row gives nested scroll/gesture conflicts,
  unbounded height, and an unscannable feed. The proven pattern is one event per tile,
  deep-linked, with grouping on `(actor, verb, target, time-window)` and count rollups.
  Our `ActivityFeedList` already does most of this (one deep-linked row per event,
  `coalesceActivity` grouping, "and N more" expand-in-place, per-row surface labels). The
  rich social tile is therefore a later evolution of the activity feed, not part of A.

## Design

### 1. Profile page (`frontend/src/app/student-profile/page.tsx`)

Post-rebase the page is a stack of sections: header (with Account/Archive), Spaces,
Syllabi preview, Pinned preview, Discussion, Recent activity.

Changes:

- **Delete the entire "Spaces" `<section>`** (the `{(isOwnView || campsUiEnabled) && ...}`
  block holding the Library/Camps/Matches `HubLink`s). The `HubLink` component is no
  longer used here; remove it if nothing else references it.
- **Add a Camps preview section**, gated behind `campsUiEnabled`, following the exact
  shape of the Syllabi/Pinned sections:
  - Heading "Camps" (own view) / "<Name>'s camps" with a "See all" link to
    `/student/:id/camps`.
  - The **Add camp** action stays here, with today's gating
    (`canCreateCamp && campsUiEnabled`, i.e. coach viewing a student), reusing the
    existing `CreateCampDialog`.
  - Body: up to 5 active camps as `CampSummaryCard`s; `EmptyState` when none; loading
    skeleton consistent with the sibling sections.
- **Placement:** Camps section first among the content sections (above Syllabi), since the
  active camp is the student's current focus. Adjustable.
- Library access is unaffected (it lives in `navbar.tsx` and `bottom-nav.tsx`).

When `campsUiEnabled` is false (production today), the profile simply shows Syllabi,
Pinned, Discussion, and Recent activity, with no Camps section and no Spaces list.

### 2. `CampSummaryCard` (new shared component)

A presentational trailhead card. The whole card is one link to `/camps/:id`.

Shows:

- Camp name.
- Competition name as a chip when the camp is linked to a competition.
- Description (truncated).
- A thin meta line: technique count, video count, and last-activity time
  ("updated 2d ago"). **No win/loss record.**

It is intentionally not interactive beyond the link. It is reusable on the full camps
list page later.

### 3. Backend: enrich the camps list payload

Extend the camps-for-student list endpoint (`GET /api/camps`, served from
`crates/syllabus-tracker/src/db/camps.rs`) so each row additionally carries:

- `competition_name: Option<String>` (join through `competition_id`).
- `technique_count: i64` (count of camp techniques).
- `video_count: i64` (count of videos whose parent is this camp).
- `last_activity_at: Option<...>` (most recent relevant timestamp for the camp; derived
  via subquery, exact source decided in the plan).

Keep this to a single query with joins/subqueries. Update the `Camp` TypeScript type and
the `useCampsForStudent` consumers accordingly. The detail endpoint
(`CampDetail`) is unchanged.

### 4. Retire the standalone matches surface

- Delete `frontend/src/app/student-matches/page.tsx`, its test, and the
  `/student/:id/matches` route in `App.tsx`.
- Remove the cross-camp aggregate: `useStudentMatches`, the `/api/students/:id/matches`
  fetch in `api.ts`, and the backend `list_matches_for_student` (and its route). Matches
  remain fully viewable and editable in the camp detail page's `MatchesSection`; only the
  free-standing aggregate goes away.
- **Repoint match activity deep-links.** Today `view-context.ts` routes `match_logged`
  and `match_technique_linked` rows to `/student/:id/matches?focus=match:<id>`. Repoint
  them to the owning camp detail (`/camps/:campId`). Match activity rows carry
  `match_id`, `competition_id`, and `target_student_id` but not `camp_id`; resolve the
  owning camp via the same student + competition join `list_matches_for_student` used.
  Scroll-to-match anchoring on the camp page (a `?focus=match:<id>` behaviour) is deferred
  to Chunk B; for now the link simply opens the camp.

### 5. Tests

- Update `student-profile-activity.test.tsx` for the removed Spaces section and the new
  Camps section.
- Delete `student-matches.test.tsx`.
- Fix the `view-context` and `activity-line` unit tests that assert the
  `/matches?focus=match:` href, to assert the new camp href.
- Add coverage for the enriched camps list payload (counts, competition name) at the db
  layer (`crates/syllabus-tracker/src/test/camps.rs`).

## Assumptions

- The profile shows up to 5 **active** camps, ordered by last activity descending.
  Archived camps appear only on the full camps list page.
- The "Add camp" action remains coach-only (coach viewing a student), unchanged from
  today.

## Risks / notes

- Removing `list_matches_for_student` is safe only because matches stay reachable via the
  camp detail page. Confirmed: `MatchesSection` renders for any competition-linked camp.
- The match deep-link repoint changes behaviour for historical activity rows; they now
  land on the camp rather than a match-focused list. Acceptable for A; the precise anchor
  comes in B.
