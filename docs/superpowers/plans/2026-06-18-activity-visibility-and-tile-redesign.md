# Activity Feed Visibility + Tile Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Gym feed shows the viewer's own actions; hide/unhide noise is suppressed by a net-visibility rule; tiles use a link-rich breadcrumb header + minimal caption. Continues PR #84 on `feat/social-media-tiles`.

**Architecture:** One contained backend predicate change (coach `feed()` branch) + two pure frontend transforms (`suppressHideUnhide`, `activityCaption`) + a rebuilt `ActivityTileHeader`.

**Tech Stack:** Rust/Rocket/sqlx (SQLite, offline cache), React 19 + Vite, TanStack Query, Vitest.

Conventions: commit `feat(scope): Past tense.`; no co-author trailer; no em-dashes; status copy New/Doing/Done. Frontend gate `pnpm exec tsc -b && pnpm lint && pnpm vitest run --project node`. Backend `nix develop .#ci --command cargo nextest run -p syllabus-tracker`; regen `.sqlx/` via `nix develop .#ci --command just sqlx-prepare` after the query edit. Never `git stash`.

---

## Task A: Gym feed shows own actions

**Files:** `crates/syllabus-tracker/src/db/activity_read.rs`, `.../test/activity_read.rs`, `.sqlx/`.

- [ ] Backend test (red): seed a coach + their own notifiable action (e.g. `SyllabusAssigned` actor=coach target=alice); `feed(coach, Role::Coach, None, 50)` returns the row; assert `!row.unread`.
- [ ] Remove the `WHERE act.actor_user_id != ?` clause from the coach/admin branch (and its `viewer` bind for that position; keep the cursor/override binds). Update the doc comment to "Coach/Admin: all gym activity".
- [ ] `nix develop .#ci --command just sqlx-prepare`; `... cargo nextest run -p syllabus-tracker` green.
- [ ] Commit: `feat(activity): Show the viewer's own actions in the gym feed.`

## Task B: Hide/unhide net-visibility suppression

**Files:** `frontend/src/lib/activity-hide-unhide.ts` (+ `.unit.test.ts`).

- [ ] Unit test (red) covering: bare `sst_hidden` dropped; lone `sst_unhidden` kept; `sst_hidden` 5 min before an `sst_unhidden` (same sst) -> unhide dropped; `sst_unhidden` then `sst_hidden` 1 h later (same sst) -> unhide dropped; `sst_unhidden` with a `sst_hidden` 48 h later -> kept; unrelated rows untouched; pairing is per `sst_id`.
- [ ] Implement `suppressHideUnhide(rows: ActivityRow[]): ActivityRow[]`. Constants `HIDE_UNHIDE_UNDO_MS = 10*60*1000`, `UNHIDE_REHIDE_MS = 24*60*60*1000`. Drop all `sst_hidden`. Drop an `sst_unhidden` if any `sst_hidden` with same `sst_id` has `|t_hide - t_unhide|` within window: hide-before within UNDO_MS, or hide-after within REHIDE_MS. Pure; preserves order.
- [ ] `pnpm vitest run --project node activity-hide-unhide` green.
- [ ] Commit: `feat(activity): Suppress hide/unhide noise by net visibility.`

## Task C: Minimal verb caption

**Files:** `frontend/src/lib/activity-caption.ts` (+ `.unit.test.ts`).

- [ ] Unit test (red): `sst_status_changed` -> `{ text: "Set to", statusLabel: "Doing", statusColor: "amber" }` (payload to:amber); `attempt_logged` -> "Logged an attempt"; `video_watched` -> "Watched a video"; `technique_pinned` -> "Pinned"; `sst_unhidden` -> "Made visible"; `thread_comment_posted` -> "Commented"; unknown -> falls back to `activityLine(row).verb`.
- [ ] Implement `activityCaption(row): { text: string; statusLabel?: string; statusColor?: Status }`. Reuse `STATUS_LABELS` for the status arm; `parsePayload` mirror. Default arm returns `{ text: activityLine(row).verb }`.
- [ ] `pnpm vitest run --project node activity-caption` green.
- [ ] Commit: `feat(activity): Add the minimal activity caption renderer.`

## Task D: Rebuild ActivityTileHeader (breadcrumb + caption)

**Files:** `frontend/src/components/activity-feed/activity-tile-header.tsx`.

- [ ] Breadcrumb of links (each its own `<Link>`, `ChevronRight` separators):
  - Actor: link to `/student/${row.actor_user_id}` when `isCoachOrAdmin(viewer) && row.actor_user_id !== viewer.id`, else plain text. Avatar shown when `showAvatar`.
  - Target student: only when `scope.kind === "gym"` and `row.target_student_id != null && row.target_student_id !== row.actor_user_id` -> link `/student/${row.target_student_id}` with the `target_student_name`.
  - Context surface: from `activitySurface(row)`; link to `line.href` (the existing deep-link) with the surface label; omit when neither exists.
  - Trailing timestamp `formatRelativeShort`.
- [ ] Caption line: `activityCaption(row)`; render `text`, and when `statusLabel` present append a `statusToDotClass(statusColor)` dot + label. Keep the verb icon prefix (`verbIconMeta`).
- [ ] `pnpm exec tsc -b && pnpm lint` green.
- [ ] Commit: `feat(activity): Rebuild the tile header as a link breadcrumb with a minimal caption.`

## Task E: Wire suppression into the feeds

**Files:** `frontend/src/components/activity-feed/activity-tile-feed.tsx`, `frontend/src/components/activity-feed-list.tsx`.

- [ ] In `ActivityTileFeed`, apply `suppressHideUnhide` to `rows` before the existing `campsUiEnabled` visibility filter.
- [ ] In `ActivityFeedList`, apply `suppressHideUnhide` to `visibleRows` (so the profile/timeline compact feed also drops the noise) before coalescing.
- [ ] `pnpm exec tsc -b && pnpm lint && pnpm vitest run --project node` green (existing feed tests still pass).
- [ ] Commit: `feat(activity): Drop hide/unhide noise from the activity feeds.`

## Task F: Component test + final

**Files:** `frontend/src/components/activity-feed/activity-tile-header.test.tsx` (CI-only).

- [ ] Browser test (stub not needed; pure render): a gym-scope `sst_status_changed` row renders actor link, target-student link, surface link, and caption "Set to" + "Doing" with a dot; a student-scope row omits the target segment.
- [ ] Final: frontend gate green; backend nextest green; `.sqlx/` committed; rebase onto main; push; deploy staging.
