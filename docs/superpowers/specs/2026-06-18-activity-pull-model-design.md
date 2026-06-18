# Activity Feed: Pull Model (read-time relevance) Design

**Date:** 2026-06-18
**Branch:** `feat/social-media-tiles` (continues PR #84)
**Status:** Proposed (user chose full pull migration; pending spec review)

## Problem

Broadcast-style events (a coach adds a video to a global technique, edits a
technique, adds a technique to a syllabus) are **fanned out on write**:
`emit_fanout` writes one activity row per affected student. The gym feed (which
shows all gym activity) then renders N near-identical tiles for one event, and
each row carries a baked-in `target_student_id`, producing the misleading
"Matty Admin > Charlotte Chew > Global Technique Library / Added a video"
phrasing (it was added to the global library, not to Charlotte's).

Research (getstream, bytebytego, Instagram fanout writeups) shows fanout-on-write
buys fast reads at massive scale at the cost of write amplification and
duplication. At this app's scale (one gym, tens-to-low-hundreds of students,
SQLite, a few concurrent readers) none of the push benefits apply, and the write
fanout is the direct cause of the duplication and phrasing smells. Decision:
**move to a pull model** (one event, relevance computed at read time).

## What fans out today (to migrate)

`emit_fanout` is called for exactly five verbs:

| Verb | Relevance set (today's `affected_students_*`) |
|---|---|
| `video_added` | technique: assigned (active, not hidden) ∪ pinned |
| `video_visibility_set` | technique: assigned ∪ pinned |
| `technique_edited` (incl. tag edits) | technique: assigned ∪ pinned |
| `syllabus_technique_added` | syllabus: students with an active assignment |
| `syllabus_technique_removed` | syllabus: active assignment |

All other verbs are already single-row with a genuine `target_student_id` (a
status change on *one* student's sst, an assignment, a comment) or no student
(camp/competition). They are **not** touched.

## Architecture

### 1. Emission: one broadcast row

Add `emit_broadcast(tx, ev)` that writes a single activity row with
`target_student_id = NULL` (the event is about the technique/syllabus, not a
student). Replace the eight `emit_fanout` call sites (the five verbs above) with
`emit_broadcast`, dropping the now-unneeded `affected_students_*` precomputation
at those sites. `affected_students_for_technique` / `_for_syllabus` move to the
read path (see below) or are inlined into the relevance SQL.

`emit_fanout`'s empty-`affected` fallback already wrote a single NULL-target row;
`emit_broadcast` is that behavior unconditionally.

### 2. Read-time relevance (the core)

A reusable SQL predicate decides whether a **student viewer** sees a row:

```sql
(
  act.target_student_id = :viewer            -- targeted to me (status, assign, comment, own)
  OR (
    act.target_student_id IS NULL            -- broadcast event
    AND (
      ( act.verb IN ('video_added','video_visibility_set','technique_edited')
        AND act.technique_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM syllabus_assignments a
            JOIN student_syllabus_techniques sst ON sst.assignment_id = a.id
            WHERE a.student_id = :viewer AND a.unassigned_at IS NULL
              AND sst.technique_id = act.technique_id AND sst.hidden_at IS NULL
          UNION
          SELECT 1 FROM student_pinned_techniques p
            WHERE p.student_id = :viewer AND p.technique_id = act.technique_id
        )
      )
      OR
      ( act.verb IN ('syllabus_technique_added','syllabus_technique_removed')
        AND act.syllabus_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM syllabus_assignments a
            WHERE a.student_id = :viewer AND a.unassigned_at IS NULL
              AND a.syllabus_id = act.syllabus_id
        )
      )
    )
  )
)
```

This is the SAME membership logic the fanout used (`affected_students_*`),
evaluated live. It naturally reflects current state: unassigning a syllabus or
unpinning removes the event from that student's feed (arguably more correct than
the frozen fanout snapshot).

The predicate replaces `act.target_student_id = ?` in:
- `feed()` **student** branch.
- `unread_count()` student `feed_predicate`.
- `api_student_activity_feed` (same `feed()` student branch, so automatic).

The **coach/gym** branch is unchanged (already shows all rows). Broadcast events
now appear exactly once there, so the duplication is gone at the source. No
backend dedup needed.

`dashboard_activity_feed` (coach glance) is unchanged structurally; broadcast
events match its existing coach-verb allow-list and appear once.

### 3. Unread / cursors

`activity_cursors` (per-viewer `max_seen_id`) and `activity_seen_overrides`
(per `viewer + activity_id`) already key on the viewer, not on a per-recipient
row, so they work unchanged with single broadcast rows: a student marks a
broadcast event seen via an override on its single id; the cursor advances past
it. `unread_count` reuses the relevance predicate so a broadcast event counts as
unread only for relevant students, and `notifies()` still excludes own actions.

### 4. Historical data migration (one-off)

Existing fan-out rows (many per event) must collapse to one broadcast row. A new
one-off binary `src/bin/collapse_fanout_activity.rs`:

- For the five fanout verbs, group legacy rows by
  `(verb, actor_user_id, COALESCE(technique_id,0), COALESCE(video_id,0),
   COALESCE(syllabus_id,0), strftime('%Y-%m-%d %H:%M:%S', occurred_at))`
  (fanout rows in a group were emitted in one transaction, same second).
- Keep `MIN(id)` per group, set its `target_student_id = NULL`; delete the rest.
- Preserve `activity_seen_overrides` / cursors referencing kept ids; delete
  overrides referencing removed ids (they were per-recipient duplicates).
- Idempotent: re-running finds nothing to collapse (all groups already size 1
  with NULL target).

Destructive (DELETE). Run on staging first (or `refresh_db` then collapse). Prod
run is a later runbook step (the social feed is not on prod yet, so prod urgency
is low). See [[reference-prod-destructive-migration-deploy]].

### 5. Frontend (small, mostly automatic)

- Broadcast events have `target_student_id = NULL`, so the breadcrumb target
  segment disappears for them automatically. No special-casing needed; remove the
  earlier "drop target for library" idea as redundant.
- **Caption names the video**: `video_watched` -> "Watched {video_title}",
  `video_added` -> "Added {video_title}" (fall back to "a video" when the title
  is missing). This is the missing noun in image 5.
- `activityLine`'s `video_added` href / surface already resolve via
  `technique_id`; with target NULL the library surface chip stays correct.

## Out of scope

- Retiring `activity_cursors` / overrides (they keep working).
- Changing non-fanout verbs.
- A hybrid push/pull (unneeded at this scale).

## Affected files

**Backend:**
- `db/activity.rs` - add `emit_broadcast`; remove `affected_students_for_technique` / `_for_syllabus` if they become unused after the call sites swap (clippy `-D warnings` enforces), else keep whatever a remaining caller needs. Relevance now lives in read SQL.
- `db/videos.rs`, `db/techniques.rs`, `db/tags.rs`, `db/syllabi.rs` - swap the 8 `emit_fanout` calls to `emit_broadcast`; drop the `affected_students_*` precompute lines there.
- `db/activity_read.rs` - relevance predicate in `feed()` student branch and `unread_count()`; helper fn to build it (shared string) to avoid divergence.
- `src/bin/collapse_fanout_activity.rs` - new one-off migration.
- `test/activity_read.rs`, `test/activity.rs` - relevance + emission tests.
- `.sqlx/` - regenerated.

**Frontend:**
- `src/lib/activity-caption.ts` - video title in the watched/added captions.
- Tests updated for the new captions.

## Testing

- **Emission:** a `video_added` writes exactly one row, `target_student_id IS NULL`.
- **Relevance (student feed):** a broadcast `video_added` on technique T appears
  for a student who has T assigned, and for one who has T pinned, and NOT for a
  student without T; a `syllabus_technique_added` on syllabus S appears only for
  students assigned to S. Unassigning/unpinning removes it.
- **Gym feed:** the broadcast event appears exactly once (no dupes).
- **Unread:** the broadcast counts as unread only for relevant students; own
  actions never unread; marking-seen via override works on the single id.
- **Migration:** collapsing a seeded legacy fanout group leaves one NULL-target
  row and removes its duplicate overrides; idempotent on re-run.
- **Caption (node):** `video_watched`/`video_added` include the title.

## Verification gate

- Backend: `nix develop .#ci --command env SQLX_OFFLINE=true cargo clippy --workspace --all-targets --all-features -- -D warnings` and `... cargo nextest run --workspace --all-features`; regenerate `.sqlx/`.
- Frontend: `pnpm exec tsc -b && pnpm lint && pnpm vitest run --project node && pnpm build`.
- Run the migration on staging; smoke the gym feed (one tile per event) and a
  student feed (broadcast events only for relevant techniques).
- Rebase onto main, push, deploy staging.

## Risks

- **Relevance SQL complexity / sqlx offline cache.** Mitigated by a single shared
  predicate string and thorough tests.
- **Destructive migration.** Mitigated by idempotency, second-precision grouping,
  staging-first, and prod-low-urgency (feed not yet on prod).
- **Behavior change:** a student who later loses access to a technique no longer
  sees its past broadcast events. Judged correct (the feed reflects current
  relevance), but worth noting.
