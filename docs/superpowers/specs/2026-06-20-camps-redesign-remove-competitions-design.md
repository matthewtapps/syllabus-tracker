# Camps Redesign: Remove Competitions

**Date:** 2026-06-20
**Status:** Approved, pre-implementation

## Problem

The current model conflates two concepts: a generic "camp" and a "competition
camp". Competitions (gym events, registrations, logged matches, match-technique
analysis) are woven through the schema, backend, and frontend, but add
complexity we no longer want.

A camp should be one thing: a discrete unit a coach curates for one student,
to which techniques, videos, and threads attach. Students have many camps;
camps archive and unarchive. Competitions leave the app entirely.

## Launch context

Camps and competitions ship to staging/dev only, hidden on production behind a
build-time gate (`frontend/src/lib/features.ts`, `campsUiEnabled =
VITE_ENVIRONMENT !== "production"`). No production user data exists behind
either feature. Competition removal is therefore a clean destructive schema
delete, not a data migration. `config/schema.sql` is declarative; the migrator
handles drops (prod has no rows to violate constraints).

## Decisions

- A camp belongs to **one** student and is created and authored by the coach.
- A camp is structurally close to a syllabus: ordered techniques drawn from the
  global library or created one-off (scoped) just for the camp.
- Students contribute two things to a camp: footage uploaded directly to the
  camp, and threads (camp-level and on camp techniques).
- Only the coach edits global library content.
- Camp-technique discussion is a separate viewing context: a thread on a camp
  technique never appears on the global-library view of that technique.
- Because a camp has exactly one student, every camp-technique thread's audience
  is the camp's student plus the coaches, regardless of who started it. The
  "student thread visible to coaches" and "coach thread visible to the student"
  rules collapse to a single audience.
- Keep `camps.references_camp_id` ("builds on" lineage); it is orthogonal to
  competitions.

## Execution: two phases, two PRs

Removal first, then additive. Removal is low-risk (gated, no data) and clearing
the competition cruft shrinks the surface before the new threading lands.

---

## Phase 1 — Delete competitions

Remove entirely.

**Schema (`config/schema.sql`):**

- Drop tables: `competitions`, `competition_registrations`, `matches`,
  `match_techniques`, `camp_referenced_matches`.
- Drop column `camps.competition_id`.
- Remove `'match'` from `videos.parent_kind`: drop `videos.match_id` column,
  its CHECK arm, its index (`idx_videos_match`), and `match_id` from the
  composite video index.
- Drop `activity.match_id` and `activity.competition_id` columns and their
  indexes (`idx_activity_match`, and any competition index).
- Remove any `'match'` / `'competition'` members from activity context-kind or
  other enums.

**Backend (`crates/syllabus-tracker`):**

- Delete `src/db/competitions.rs`, `src/db/matches.rs`, `src/competitions/routes.rs`.
- Remove match/competition activity verbs from `db/activity.rs`.
- Remove competition/match permission functions (e.g. `can_manage_match`) from
  `auth/permissions.rs`.
- Remove competition/match wiring from `lib.rs`, `main.rs`, `api.rs`, `models.rs`.
- Remove `promote_camp_to_competition` and any `competition_id` handling from
  `camps/routes.rs` and `db/camps.rs`.
- Strip competition/match seed data from `bin/seed.rs`.

**Frontend (`frontend/src`):**

- Delete `app/competitions/page.tsx` and `app/competitions/[id]/page.tsx`.
- Remove competition/match references from `components/camp-summary-card.tsx`,
  `lib/mutations.ts`, `lib/queries.ts`, `lib/query-keys.ts`, `lib/entity-ref.ts`,
  navbar/bottom-nav, and any video/activity components referencing matches.

**Acceptance:**

- Competition tables, routes, and frontend pages are gone.
- Camp CRUD, camp techniques, camp footage, and camp threads still work.
- `references_camp_id` retained and functional.
- Backend offline build (`SQLX_OFFLINE`) and tests green; `just verify` passes.

---

## Phase 2 — Camp as a discrete attachable unit

Camp is already mostly built (generic camp, `camp_techniques`, `scoped_camp_id`
one-off techniques, camp-owned videos via `videos.parent_kind='camp'`). Add the
following.

### a. Student camp footage

Students can upload video directly to a camp they own
(`videos.parent_kind='camp'`). Coaches can too. The parent kind already exists;
open the upload route to students for their own camps. Students cannot attach
video to camp techniques (that is technique authoring, coach-only).

### b. Camp-level threads

Both coach and student start threads anchored to the camp
(`threads.anchor_kind='camp'`, already in schema). Audience = the camp's student
plus the coaches.

### c. Camp-scoped technique discussion (new mechanic)

- New `threads.anchor_kind='camp_technique'`, with both `camp_id` and
  `technique_id` set (new CHECK arm; both columns already exist on the table).
- Queried by the (camp, technique) pair. Never surfaced on the global-library
  technique thread list. This is the "separate viewing context".
- Both coach and student can start one.
- Audience = the camp's student plus the coaches (single rule, per Decisions).

### d. Camp-technique videos: camp-only vs global

- The coach adds a video to a camp technique and chooses scope:
  - **global**: a normal technique video (`parent_kind='technique'`), visible
    everywhere the technique appears.
  - **camp-only**: surfaced only inside this camp's view of the technique.
    Implement via the existing `camp_technique_referenced_videos (camp_id,
    technique_id, video_id)` association (extend if needed) so the video does
    not leak to the global library.
- Only the coach does this; global library content is coach-only.

### Permissions matrix

| Action | Coach | Student |
|---|---|---|
| Create / archive / unarchive camp | yes | no |
| Attach / reorder techniques (global or one-off scoped) | yes | no |
| Edit global library content | yes | no |
| Upload camp footage | yes | yes (own camps) |
| Start camp-level thread | yes | yes |
| Start camp-technique thread | yes | yes |
| Add video to a camp technique (camp-only / global) | yes | no |

**Acceptance:**

- Student can upload footage to own camp; cannot to another student's camp;
  cannot attach video to a camp technique.
- A `camp_technique` thread is visible in the (camp, technique) context and
  absent from the global-library technique view.
- Camp-level thread visible to camp's student and coaches.
- Camp-only technique video appears only in the camp; global one appears
  everywhere.
- Backend route + db tests cover the above; frontend vitest (stub
  `window.fetch`) covers the new student actions.

---

## Testing strategy

- Per phase: backend route + db tests.
- Phase 1: assert competition tables/routes removed; camp suite still green.
- Phase 2: footage-by-student authorization, `camp_technique` thread isolation
  from global library, camp-only video scoping, permission matrix enforcement.
- Frontend: vitest browser tests with `window.fetch` stubbed (per repo
  convention) for new student-facing camp actions.
- Gate per repo: offline build + tests; `just verify` (sqlx-check excluded).

## Out of scope

- Multi-student camps.
- Student-created or student-authored camps (coach-only authoring stays).
- Rich social tiles for camps (deferred, tracked separately).
- Any reintroduction of competition/match concepts.
