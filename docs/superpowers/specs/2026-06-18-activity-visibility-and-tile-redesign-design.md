# Activity Feed Visibility Audit + Tile Redesign: Design

**Date:** 2026-06-18
**Branch:** `feat/social-media-tiles` (continues the social-feed work in PR #84)
**Status:** Approved (4 core decisions confirmed by user)

## Problem

Three issues surfaced from staging review of the social feed:

1. **Gym feed drops the viewer's own actions.** Camp/competition activity done
   by the admin is invisible in that admin's own gym feed.
2. **Hide/unhide noise.** Bare "hid X" / "unhid X" rows clutter student feeds.
3. **Tile layout buries the signal.** The header repeats the technique name the
   tile already shows, and actor/target/context are plain text, not links.

## Audit: how each feed is built (current)

| Surface | Endpoint | Backend predicate | Shows |
|---|---|---|---|
| Gym feed (coach) | `/api/activity/feed` | `actor_user_id != viewer` | all gym activity **except viewer's own** |
| Your feed (student) | `/api/student/:id/activity_feed` (Role::Student) | `target_student_id = viewer` | activity *about* them |
| Profile "Recent activity" | same, for studentId | `target_student_id = studentId` | activity about that student |
| Dashboard glance | `/api/dashboard/activity_feed` | verb allow-list | curated subset (hide/unhide already excluded) |

`feed()`'s coach branch backs **only** the gym feed (`api_activity_feed`); the
student/profile surfaces force `Role::Student` (target-keyed). So changing the
coach branch is contained to the gym feed. `notifies()` already returns false
when `actor == viewer`, and `unread_count` keeps its own `actor != viewer`
predicate, so showing own rows in the feed list does not affect unread badges.

## Decisions (confirmed)

1. **Gym feed = full gym, including own actions.** Drop `actor != viewer` from
   the coach `feed()` branch.
2. **Hide/unhide = net-visibility rule** (frontend transform).
3. **Suppression lives in the frontend** alongside coalescing.
4. **Tile redesign applies to all tile kinds.**

## Part A: Gym feed shows own actions

`activity_read.rs::feed()` coach/admin branch: remove the `act.actor_user_id != ?`
WHERE clause (and its bind). The branch now returns all gym activity (subject to
the existing deleted-video/thread guards), ordered `occurred_at DESC, id DESC`.
Update the doc comment ("Coach/Admin: all gym activity") and the sqlx cache.
Per-row `unread` stays correct via `notifies()`. Backend test: a coach's own
notifiable action now appears in `feed(coach, Role::Coach)` and is **not** unread.

No change to the student branch, `unread_count`, or `dashboard_activity_feed`.

## Part B: Hide/unhide net-visibility suppression

A pure frontend transform `suppressHideUnhide(rows)`, applied before coalescing
in the tile feed (and reused by the compact `ActivityFeedList`). Pairs on
`sst_id` (the hidden/unhidden subject); independent of actor.

Rules:
- Every `sst_hidden` row is dropped (hiding is curation, never feed-worthy).
- An `sst_unhidden` row is dropped when EITHER:
  - an `sst_hidden` for the same `sst_id` occurred within **10 minutes before**
    it (quick hide-then-unhide undo), OR
  - an `sst_hidden` for the same `sst_id` occurs within **24 hours after** it
    (unhidden, then re-hidden: net hidden).
- Otherwise the `sst_unhidden` survives and renders as a technique tile (a
  genuine "made visible again").

Constants `HIDE_UNHIDE_UNDO_MS = 10*60*1000` and `UNHIDE_REHIDE_MS = 24*60*60*1000`,
named and exported so they are tunable. Implemented in a new
`frontend/src/lib/activity-hide-unhide.ts` with unit tests. Rows arrive newest-first
(feed order); the transform scans the whole list to find the paired hide in
either direction by timestamp. Pure, does not throw.

This is display-only; it does not change emission or the backend. Dropped rows
still ship from the API (acceptable at feed sizes).

## Part C: Tile redesign (all kinds)

Restructure `ActivityTileHeader` into a consolidated, link-rich breadcrumb plus
a minimal caption, so the embedded noun tile carries the detail.

**Header line 1 (breadcrumb + time):**
`[avatar] Actor › Target student › Context surface            18h`

- **Actor**: name, links to the actor's profile when the viewer may open it
  (coach/admin viewer, actor not self) using the existing `/student/:actorId`
  rule. Avatar shown in gym scope.
- **Target student**: shown only in gym scope when the action targets a
  different student (`target_student_id` present and `!= actor`). Links to
  `/student/:targetId`. Omitted on a single-student surface (target implicit)
  and for self-actions.
- **Context surface**: the syllabus / library / camp the action happened on,
  from `activitySurface(row)`. Links to that surface (`line.href` target).
  Omitted when there is no surface.
- Separator is a `›` chevron (`ChevronRight`), each segment individually
  tappable. The breadcrumb is a row of links, not one big stretched link, so
  each segment routes to its own destination.

**Header line 2 (caption):** the minimal verb, from a new pure
`activityCaption(row)` returning `{ text, statusLabel?, statusColor? }`. It omits
anything the tile already shows (the technique name, the syllabus name). Examples:
- `sst_status_changed` -> "Set to ● Doing" (dot + label).
- `attempt_logged` -> "Logged an attempt". `attempt_edited` -> "Edited an attempt".
- `video_watched` -> "Watched a video". `video_added` -> "Added a video".
- `technique_pinned` -> "Pinned". `technique_unpinned` -> "Unpinned".
- `sst_unhidden` -> "Made visible". `technique_edited` -> "Edited".
- `syllabus_technique_added` -> "Added to syllabus".
- `thread_comment_posted` -> "Commented" (the comment tile shows the body).
- default -> the existing `activityLine(row).verb` as a fallback.

**Tile** below the header is unchanged (the embedded `TechniqueRow` /
`ThreadView`). Entries with no tile (header-only kinds) keep showing the caption
so the line still reads as a sentence.

`activityLine` (the compact `ActivityFeedList` renderer) is **untouched**;
`activityCaption` is additive and only used by the tile header. The breadcrumb
reuses `activitySurface` and the existing actor-link rule, so routing stays
consistent with the rest of the feed.

## Out of scope

- Broadening suppression to other curation verbs (remove, visibility_set). Only
  hide/unhide was flagged; revisit if needed.
- Camp/match dedicated tiles (still header-only; gated off in prod).
- Backend-side hide/unhide filtering or pagination-aware limits.

## Affected files

**Backend:**
- `crates/syllabus-tracker/src/db/activity_read.rs` - drop `actor != viewer` in the coach `feed()` branch; update doc.
- `crates/syllabus-tracker/src/test/activity_read.rs` - assert own actions appear in the coach feed and are not unread.
- `.sqlx/` - regenerated.

**Frontend (new):**
- `src/lib/activity-hide-unhide.ts` (+ `.unit.test.ts`) - net-visibility suppression.
- `src/lib/activity-caption.ts` (+ `.unit.test.ts`) - minimal verb caption.

**Frontend (changed):**
- `src/components/activity-feed/activity-tile-header.tsx` - breadcrumb + caption.
- `src/components/activity-feed/activity-tile-feed.tsx` - apply `suppressHideUnhide` before render.
- `src/components/activity-feed-list.tsx` - apply `suppressHideUnhide` (so the profile/timeline compact feed also drops the noise).

## Testing

- Backend (nextest): coach feed includes own notifiable action, not unread.
- Unit (node): `suppressHideUnhide` covers all four cases (bare hide dropped;
  net unhide kept; hide->unhide undo dropped; unhide->rehide dropped) and leaves
  unrelated rows untouched. `activityCaption` returns the minimal text per verb
  with the status dot for status changes.
- Component (CI browser): the tile header renders actor/target/surface as
  separate links and the minimal caption; a status tile shows "Set to Doing"
  with a dot and no repeated technique name.

## Verification gate

- Backend: `nix develop .#ci --command just lint` and `... cargo nextest run -p syllabus-tracker`; regenerate `.sqlx/`.
- Frontend: `pnpm exec tsc -b && pnpm lint && pnpm vitest run --project node && pnpm build`.
- Rebase onto main, push, deploy to staging.
