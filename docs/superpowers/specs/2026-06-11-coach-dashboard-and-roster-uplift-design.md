# Coach Dashboard and Student Roster Uplift

**Status:** Design approved, ready for planning
**Date:** 2026-06-11
**Author:** Matt (with Claude)

## Problem

The coach dashboard leads with a status donut (New / Doing / Done summed across every syllabus technique). It is a cumulative *state* metric, so as students progress it converges toward "all Done" and stops telling the coach anything new. The same staleness afflicted the old syllabus tracking.

When asked what a coach most wants from the dashboard, the answer was "what's happened lately", not "how much is done". That reframes the hero from an aggregate state chart into a view of recent activity, which never settles because it always reflects a rolling window.

Separately, the dashboard's Initiative / Recent / Quiet roster mixes a triage tool into the glance view, and the student-list page carries lifecycle tabs (Active / Graduated / Archived / All) whose distinctions have become arbitrary.

We have the raw material to fix all of this: the activity log records 20 verbs, including the student-engagement signals a coach cares about (video watched, attempt logged, status changed, notes edited, technique pinned) and coach-side actions, each with an actor whose role we know.

## Goals

1. Replace the coach dashboard donut with an **activity digest** (B): four rolling-7-day metric tiles.
2. Replace the dashboard's "Recent student activity" panel with a true **event feed** (C).
3. Move student triage off the dashboard and onto the student-list page as **activity-based tabs**, dropping the lifecycle tabs.
4. Introduce **deterministic per-student colors** so a student reads as "the blue one" across surfaces.

Non-goals: the student dashboard (its donut stays), comments (a future verb that will slot into both B and the feed when it lands), recoloring every avatar in the app (we do the feed and the roster now; profile pages can follow later), and a full browsable activity page (the planned social-style feed is a separate feature with its own design; the dashboard feed here is a compact summary only).

---

## 1. Coach dashboard

New top-to-bottom order for `CoachDashboard` in `frontend/src/app/dashboard/page.tsx`:

1. Greeting + `DashboardTotals` (unchanged).
2. **Activity digest (B)** in place of `StatusDonut`.
3. Approvals `QueuePanel` (unchanged).
4. **Recent activity feed (C)** in place of `RecentlyActivePanel`.

Removed from the coach dashboard: the `StatusDonut`, the Initiative / Recent / Quiet `Tabs` + `Roster`, the `RecentlyActivePanel`, and the `useRecentlyActiveStudents` query. `StatusDonut` stays in `StudentDashboard` untouched.

### 1a. Activity digest (B)

Four tiles, counting **student-actor** activity across the viewer's students (gym-wide for admin), over a **rolling 7-day window vs the previous 7 days**:

| Tile | Source verb / rule |
|------|--------------------|
| Attempts logged | `attempt_logged` events |
| Videos watched | `video_watched` events |
| Active students | distinct students with any own-activity event in the window |
| Techniques pinned | `technique_pinned` events (counted as pins, not net of unpins) |

Each tile shows: a big count, a 7-day daily sparkline, and a signed delta vs the previous period (absolute, e.g. "up 4", "3 fewer"; small gym counts make percentages noisy).

This set is deliberate: two "how much" metrics (training + studying), one breadth metric (how many students), one intent metric (what they choose to focus on). It is intentionally **not** a progression chart, which is the thing that goes stale.

**Backend:** new `db/dashboard.rs::activity_digest(viewer, role) -> ActivityDigest`. Query the `activity` table over the last 14 days, scoped to the viewer's students and to rows whose actor is a student, grouped by verb and by `date(occurred_at)`. Build, per metric: current-window total, previous-window total, and a 7-element daily series for the current window. `active_students` uses distinct actor counts (distinct per day for the sparkline, distinct over each window for the totals). Reuse the existing visibility scoping used by `feed` / `recently_active_students`.

**Endpoint:** `GET /api/dashboard/activity_digest` (coach/admin only) returning:

```jsonc
{
  "window_days": 7,
  "generated_at": "2026-06-11T...",
  "metrics": [
    { "key": "attempts_logged", "label": "Attempts logged", "count": 37, "prev_count": 33, "delta": 4, "daily": [3,5,4,7,6,9,3] },
    { "key": "videos_watched",  "label": "Videos watched",  "count": 24, "prev_count": 23, "delta": 1, "daily": [...] },
    { "key": "active_students", "label": "Active students", "count": 11, "prev_count": 12, "delta": -1, "daily": [...] },
    { "key": "techniques_pinned","label": "Techniques pinned","count": 8, "prev_count": 5, "delta": 3, "daily": [...] }
  ]
}
```

**Frontend:** `useActivityDigest` hook; `dashboard/components/activity-digest.tsx` (2x2 tile grid) with a small `Sparkline` (inline SVG or flex-of-bars). Handle loading (skeleton tiles), empty (zeros), and error states.

### 1b. Recent activity feed (C)

A per-event stream (not the current one-row-per-student), **student-engagement events only**: `video_watched`, `attempt_logged`, `attempt_edited`, `sst_status_changed`, `sst_student_notes_edited`, `technique_pinned`, and `syllabus_graduated` as a milestone. Coach-side / library actions are hidden (they are not news to the coach who did them).

- **Six rows**, with no "see all" link. A richer, browsable social-style feed is a separate future feature, out of scope here.
- Each row: a tinted avatar colored by **student identity** (see section 3), the formatted line via the existing `activityLine` helper, and a relative timestamp. The row deep-links via `activityLine`'s href. **No type-color and no legend** (type is already clear from the verb text).
- **Coalescing:** consecutive same-verb events from the same student collapse into one line ("logged 3 attempts across Rear Naked Choke and 2 more") so one keen student does not flood the feed.

**Backend:** new `db/activity_read.rs::dashboard_activity_feed(viewer, role, limit) -> Vec<ActivityRow>`. It mirrors `feed()`'s scoping and row shape but (a) filters to the engagement verb set and (b) is **read-only / peek**: it does **not** advance the viewer's read cursor. This matters because the navbar unread badge is driven by the cursor; a dashboard glance must not silently mark everything read.

**Endpoint:** `GET /api/dashboard/activity_feed?limit=30` (coach/admin only), returning `ActivityRow[]`. It returns a slightly larger raw window (e.g. 30) so the client can coalesce and still show six groups.

**Frontend:** `useDashboardActivityFeed` hook; `dashboard/components/recent-activity-feed.tsx` replacing `RecentlyActivePanel`, with the coalescing logic and loading / empty / error states.

---

## 2. Student-list page (activity triage)

Rebuild `frontend/src/app/students-list/page.tsx` around recent activity instead of lifecycle.

**Controls:**
- Search input, placeholder **"Search for any student"**. When it has text it searches across **all** students regardless of the active tab.
- Primary tabs: **Active** (default) / **Coach-led** / **Quiet**, with count badges.
- Inside Active, a chip refine (reusing the `Badge` filter-chip pattern from the library tags): **Everyone** (default) / **Student-led**.
- The existing Sort select (Recently active / Alphabetical) stays.
- One line of neutral flavour text below the controls, describing the current selection.

**Removed:** the lifecycle tabs (Active / Graduated / Archived / All) and the `StatusTab` machinery. Per-row graduate / archive actions remain in the row overflow menu; they are simply no longer a top-level filter. All students load (the data already includes archived); archived / graduated students will naturally fall into Quiet.

**Categories** (recency boundary reuses the existing `STALE_THRESHOLD_DAYS = 14`):

Per student, derive `last_student_activity_at` (most recent activity where the **actor is the student**) and `last_coach_activity_at` (most recent activity targeting the student where the **actor is a coach/admin**, i.e. not the student). Then:

| Category | Rule |
|----------|------|
| Active | `last_student_activity_at` within 14 days |
| Active > Student-led | Active **and** no `last_coach_activity_at` within 14 days |
| Coach-led | no `last_student_activity_at` within 14 days **and** `last_coach_activity_at` within 14 days |
| Quiet | neither within 14 days |

Active contains both-active and Student-led; Coach-led and Quiet are the no-student-activity cases. Tab/chip counts are derived client-side from the loaded list.

**Flavour text:**
- Active / Everyone: "Students with activity of their own lately, whether or not you've updated them."
- Active / Student-led: "Active on their own, with no recent updates from you."
- Coach-led: "You've updated them recently, with no recent activity from the student."
- Quiet: "No recent activity from either side."

**Backend:** extend the existing students-list query (behind `getStudents` / `useStudents`) to return `last_student_activity_at` and `last_coach_activity_at` per student, computed as correlated subqueries / joins on the `activity` table by actor role. No new endpoint; the frontend derives categories, filtering, and counts.

---

## 3. Deterministic student color (shared)

A pure helper so a student's color is stable forever and never stored.

- `frontend/src/lib/student-color.ts`: `studentColor(id: number): { bg: string; fg: string }`. Hash the **id** (immutable, unlike names) with a Knuth multiplicative hash (`(id * 2654435761) >>> 0`), index into a curated palette of ~12 dark-mode-tuned hue pairs. Each pair is a low-opacity wash background plus a bright, legible foreground (e.g. `bg: hsla(h, s%, l%, 0.20)`, `fg: hsl(h, s'%, l'%)`).
- Curated palette over free-form HSL: a hand-tuned set guarantees every student reads well on the dark background. Collisions past the palette size are acceptable because color is a **secondary** cue; the initials and name still carry identity. This is also an accessibility improvement over type-color: nothing essential lives in color alone, so no legend and no colorblind hazard.
- `frontend/src/components/student-avatar.tsx`: a tinted-circle avatar rendering initials using `studentColor(id)`. Used by the dashboard feed and by `StudentRow` in the roster; reusable elsewhere later.

---

## 4. Files

**Backend**
- New: `crates/syllabus-tracker/src/db/dashboard.rs` (activity_digest).
- Modify: `crates/syllabus-tracker/src/db/activity_read.rs` (+ `dashboard_activity_feed` peek fn).
- Modify: the students-list query module (add `last_student_activity_at` / `last_coach_activity_at`).
- Modify: `crates/syllabus-tracker/src/api.rs` (+ `/api/dashboard/activity_digest`, `/api/dashboard/activity_feed`; extend students response).
- Modify: `crates/syllabus-tracker/src/main.rs` (mount new routes).
- Regenerate `.sqlx/` cache against a seeded DB (see the sqlx-check seed-dependency note in project memory; never rebuild the dev DB while the app runs).
- Optional cleanup: `recently_active_students` + its route become unused once the dashboard stops calling them; remove in a follow-up.

**Frontend**
- New: `lib/student-color.ts`, `components/student-avatar.tsx`, `dashboard/components/activity-digest.tsx`, `dashboard/components/sparkline.tsx` (or inline), `dashboard/components/recent-activity-feed.tsx`.
- Modify: `dashboard/page.tsx` (CoachDashboard surgery described in section 1; StudentDashboard untouched).
- Modify: `students-list/page.tsx` (activity triage; section 2).
- Modify: `components/student-row.tsx` (tinted avatar via `StudentAvatar`).
- Modify: `lib/queries.ts` (+ `useActivityDigest`, `useDashboardActivityFeed`; students data carries the two timestamps).
- Modify: `lib/api.ts` (types: `ActivityDigest`, digest metric, the two timestamps on the student type).

---

## 5. Testing

- Backend unit tests: digest counts and windows (current vs previous, distinct active students, daily series); triage timestamp derivation by actor role; feed peek does **not** advance the cursor and filters to the engagement verbs.
- Frontend unit tests: `studentColor` determinism (same id maps to same pair) and palette bounds; feed coalescing of consecutive same-verb same-student rows; triage category derivation and counts at the 14-day boundary.
- Component tests: digest tiles render loading / empty / error / success; feed renders rows, coalesced lines, and the "See all" link; student-list tabs and the Student-led chip filter correctly and search overrides the tab.

---

## 6. Decisions on record

- Hero metric must be a rolling-window flow metric, not a converging state metric.
- Digest tiles: Attempts logged, Videos watched, Active students, Techniques pinned; rolling 7 days vs previous 7; pins counted, not net of unpins.
- Feed: student-engagement verbs only, six rows (no see-all; a social-style feed is a separate future feature), consecutive same-verb same-student coalescing, peek (no cursor advance).
- Color encodes **student identity**, not activity type; deterministic from id via a curated dark-tuned palette; tinted avatars; no legend.
- Triage labels are purely descriptive (no obligation): Active / Student-led / Coach-led / Quiet. Attribution is by actor role; recency boundary is the existing 14-day threshold.
- Student-list lifecycle tabs are dropped; reaching all students is the search box's job; per-row graduate/archive actions remain.
