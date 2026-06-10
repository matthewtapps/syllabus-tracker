# Activity table redesign

Working notes for a dedicated `activity` table that replaces the legacy
"recent activity" and dashboard visualisations. Captured 2026-06-10
from the chat with Claude.

## Goal

A single, extensible `activity` table is the source of truth for
"something happened that someone cares about." Drives:

- The student profile hub "Recent activity" section (currently still
  reading from legacy SST/attempt aggregates).
- The coach dashboard (currently almost entirely legacy collection
  content + visualisations).
- A future activity feed per student and per coach.
- Future features that haven't been built yet (comments / thread
  replies, video comments at timestamps, camp-related activity, etc.)
  must slot in without a schema rewrite.

## What counts as activity (initial list)

From the original brainstorm:

- Student watching a video
- Student modifying their notes on a technique
- Student pinning a technique
- Student adding an attempt to a syllabus technique
- Student editing an attempt (date or notes)
- Coach assigning a syllabus to a student
- Coach modifying a student's syllabus (add / hide / remove
  techniques), either globally or per-student
- Coach adding an attempt to a student's syllabus technique
- Coach changing the status of a syllabus technique
- Coach adding a video to a syllabus technique
- Coach adding a video to a pinned technique

Additional categories Claude flagged that we want in:

- Coach editing `coach_notes` on a student's syllabus technique. The
  existing `last_coach_update_at` pointer already treats this as
  activity in spirit, so it should be a first-class verb.
- Student deleting an attempt (mirror of add / edit).
- Coach graduating a student from a syllabus (lifecycle event).
- Coach unassigning a syllabus from a student (less interesting but a
  real state change, worth keeping as a verb).
- Coach setting per-student video override visibility (the
  `SyllabusVisibilityControl` introduced in PR 4).
- Coach hiding / unhiding a syllabus technique for a specific student
  (per-student curation, distinct from global syllabus edits).
- Library / global edits that cascade to assigned students: coach
  editing a technique's name / description, or adding / removing tags.
  These need a per-affected-student row so a student can answer "what
  changed for me," not just a single global row.

Future verbs (planned, not in v1 but the schema has to accommodate
them):

- Comments / thread replies on techniques, attempts, syllabi.
- Video comments anchored to a timestamp.
- Camp-related activity (whatever shape that ends up taking).

## Design decisions (working)

### 1. Shape of an activity row

Working sketch:

```
activity (
  id              integer primary key autoincrement,
  occurred_at     datetime not null default current_timestamp,
  actor_user_id   integer not null references users(id),
  verb            text    not null,    -- enum-ish, see verbs.rs
  target_kind     text    not null,    -- technique | syllabus | sst | attempt | video | video_timestamp | comment | camp | ...
  target_id       integer,             -- nullable for cases where the target is composite
  target_student_id integer references users(id),  -- denormalised: the student whose feed this belongs in
  payload_json    text                 -- verb-specific delta / extras
)
```

Notes:

- `target_student_id` denormalised so "feed for student X" is a single
  index lookup, regardless of whether the underlying event was a coach
  edit on a global syllabus that happens to fan out to N students.
- `payload_json` carries the verb-specific bits (e.g. the attempt id,
  the technique id that was added to a syllabus, the cumulative
  watch-time at the moment we emitted the `video_watched` row). Keeps
  the schema stable as new verbs get added.
- New verbs and target kinds are just new string values; no migration
  needed to add them.

### 2. Fan-out vs derive-on-read for library / syllabus edits

Decided: **fan-out** for student-facing feeds.

When a coach edits a syllabus that's assigned to 30 students, write 30
rows (one per assigned student, with `target_student_id` set
appropriately). Writes get uglier but reads stay trivial. Deriving on
read would require unioning across global edits + per-student events
on every feed query, which gets messy fast.

Skip fan-out for events only the coach cares about (e.g. creating a
brand-new syllabus that's not yet assigned to anyone) — those just go
in with `target_student_id = NULL` and surface only on the coach's
view.

### 3. Unseen-by-viewer model

Decided: **cursor + per-row override**.

Each viewer has a single cursor — "everything with `id <=
cursor.max_seen_id` is implicitly seen." On top of that, per-row
overrides handle the case where the viewer explicitly clicks a single
recent item.

Behaviour:

- Viewing the feed advances the cursor to the current max id (or to
  the max id at the top of the feed at load time, to avoid race
  conditions with newly-arrived rows).
- "Mark all read" advances the cursor to current max id.
- Explicit "mark this one as seen" creates a per-row override row in
  e.g. `activity_seen_overrides (viewer_user_id, activity_id)`. This
  does *not* advance the cursor, so older unread items stay unread.
- When the cursor advances naturally past an overridden row, the
  override row gets garbage collected (it's now redundant).

This is the pattern that prevents the "clear the most recent item,
lose unread status on everything older" problem.

The existing per-(viewer, target) `last_seen_at` timestamps in
`student_technique_views` etc. are a different mechanism for a
different question ("does this specific row have unseen activity")
and stay where they are; they're not replaced by the cursor model.
The two coexist.

### 4. Coalescing

Decided: yes, coalesce mostly-duplicate activity on the write side.

If the previous row for `(actor_user_id, verb, target_kind, target_id)`
is within N seconds (probably 30s, tune later), update the existing
row's `occurred_at` instead of inserting a new one. Optionally merge
the payload (e.g. for note edits, the latest `after_text` wins).

This stops "student edits the same note 5 times in 30 seconds" from
turning into 5 feed entries while still capturing the activity.

### 5. Video watch threshold

Open. The intent is:

- Finishing the video should *not* be required.
- A fixed duration is the right shape, but it has to handle the
  "rewatched the same 4 seconds 20 times" case, which is genuinely
  "watched" behaviour.

Working idea, to validate:

- Emit a single `video_watched` activity row the first time the
  (user, video) pair crosses a cumulative-watch-time threshold (e.g.
  10s of total play time across any number of sessions).
- After that, no new rows for that pair, except possibly a
  `video_rewatched` verb if the user comes back after a long gap
  (define "long" later — maybe a week+).
- The cumulative watch time is already trackable from
  `video_watch_aggregates` + `video_watch_events`.

Open questions on the threshold:

- Is 10s the right number? Probably depends on video length. For a
  20s clip, 10s is half; for a 5-minute breakdown, 10s is barely
  engagement. Might want `min(10s, 20% of runtime)` or similar.
- Does coach-uploaded video have different semantics from
  pinned-by-coach video? Probably not from the activity perspective —
  a watch is a watch.
- Where in the stack do we emit the activity row? On the next
  `video_watch_event` ingest that pushes the aggregate over the
  threshold is the cheapest place. Means the activity emission is a
  side effect of the existing ingest pipeline, not a separate worker.

## Scope question (asked by Claude)

Two options:

1. **Source-of-truth replacement.** Build the activity table, rip out
   `last_coach_update_at`, `last_student_update_at`, the dashboard
   counts, the legacy activity surfacing, and rebuild the affected UI
   on top of the new table. Bigger PR, cleaner end state, more
   coordinated cut-over.
2. **Additive feature.** Ship the table + new dashboard / "recent
   activity" widget reading from it, but leave the legacy pointers in
   place for now. Migrate the rest piecemeal in follow-up PRs.

**Not yet decided.** Lean is probably (2) given the size of the legacy
surface area (dashboard charts, student profile aggregates, etc.) and
the fact that the legacy code is already going to live alongside the
new code under `/legacy/*` for the prod migration.

## Open questions before implementation

1. **Cursor scope: per-viewer global, or per-viewer per-feed?** A coach
   has a "students feed" and might in future have a "library feed";
   they probably want a separate unread count per feed, not one
   merged number. Decide on cursor scope before building the table.
2. **Do we need a target audience predicate at write time?** e.g. for
   student attempts, the audience is `{owning student, their
   coaches}`. Encode in `target_student_id` + a derived "who is a
   coach for that student" lookup, or denormalise audience into the
   activity row itself? Latter is simpler; former matches the
   existing permission model.
3. **Pruning / archival.** Activity will grow forever. Acceptable for
   v1 (SQLite handles millions of rows fine for our scale) but worth
   noting a follow-up to archive rows older than e.g. 1 year out of
   the hot table.
4. **What's the verb naming convention?** `video_watched` /
   `attempt_logged` / `sst_status_changed` etc. — pick a style and
   stick to it. Probably `<target>_<past_tense_verb>`.
5. **How does this interact with the planned activity feed UI?** Some
   verbs might want to render very differently (e.g. a comment thread
   reply needs the parent context). Probably solved by the
   `payload_json` carrying enough context for the renderer, but worth
   pinning down the renderer contract before adding new verbs in
   anger.

## Not in scope for v1

- The activity feed UI itself (this plan covers the data model only).
- Notifications / push delivery off the back of activity rows.
- Multi-tenant / per-gym scoping (see deferred multi-tenant plan).
