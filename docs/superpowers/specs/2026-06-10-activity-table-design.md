# Activity Table Design

Captured 2026-06-10. Supersedes the working notes in `PLAN_ACTIVITY.md`
(that file stays as the brainstorm record; this is the agreed design).
Companion to `PLAN.md` and `docs/LEGACY_DECOMMISSION_PLAN.md`.

## Goal

A single, extensible `activity` table is the source of truth for
"something happened that someone cares about." It drives, over two PRs:

- An append-only event log written inline from every live write path
  (PR 1).
- A read side with per-viewer unread tracking, a redesigned coach
  dashboard, and the student "recent activity" surface rebuilt on top of
  the log (PR 2).

The full social-feed-style activity page is explicitly a later PR beyond
these two.

## Scope split

Both PRs are designed here in full. The split is a sequencing and review
boundary, not a "decide later" line.

| PR 1 (event log) | PR 2 (read side + dashboard) |
|------------------|------------------------------|
| `activity` table + indexes | `activity_cursors`, `activity_seen_overrides` tables |
| `db/activity.rs`: emit + coalesce + fan-out helpers | feed query (paginated) + unread-count query |
| Emission wired into every live write path | mark-read / mark-unread + override GC |
| Historical backfill | coach dashboard redesign on the verb/actor stream |
| Verb registry (verb + notifiable metadata) | student "recent activity" rebuilt on the log |
| Tests | tests |

### Not in scope for either PR

- The dedicated social-feed-style activity page (later PR).
- Notifications / push delivery off activity rows.
- Pruning / archival of old rows (noted as a future follow-up; SQLite
  handles our row counts fine for now).
- The coach -> which-students cohort mapping (e.g. "only my evening-class
  students"). This is an app-layer feed filter that builds on
  `target_student_id`; no schema commitment now.
- `feed_key` / multiple disjoint feeds. Single cursor per viewer until a
  genuinely disjoint feed (e.g. camps) exists; adding `feed_key` then is
  an additive column with a trivial backfill.
- Multi-tenant / per-gym scoping (see deferred multi-tenant plan).

## Established patterns this follows

- **Actor / verb / object / target (+ audience)** is the W3C Activity
  Streams 2.0 shape. Our `actor_user_id` / `verb` / entity-FK columns /
  `target_student_id` is a relational projection of it, with
  `target_student_id` playing the audience ("to:") role.
- **Fan-out on write** for student-facing feeds (one row per affected
  student) is the standard choice at our scale: writes get uglier, reads
  stay trivial. Delivery strategy is treated industry-wide as separable
  from the schema, so the row shape is what matters most to get right.
- **Hybrid columns + slim JSON**: real FK columns for the dimensions we
  filter / group / cascade on, a small `payload_json` for the
  verb-specific display tail. Chosen over a pure generic-target + JSON
  design because (a) real FKs give `ON DELETE SET NULL` so history
  survives target deletion, (b) real columns are indexable and
  sqlx-typed, and (c) this codebase's declarative migration engine makes
  "add a nullable column later" nearly free, neutralising JSON's main
  advantage.

---

# PR 1: Activity event log

## The table

```sql
CREATE TABLE IF NOT EXISTS activity (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    occurred_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    verb              TEXT    NOT NULL,
    actor_user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- The student this row is ABOUT (whose feed it belongs in). For
    -- student-initiated rows this equals actor_user_id; for coach-initiated
    -- rows the coach is the actor and the student is here. NULL = coach-only
    -- row (e.g. an edit to an unassigned syllabus), surfaced only on coach
    -- views.
    target_student_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    -- Query / grouping dimensions. Nullable; ON DELETE SET NULL so the row
    -- survives as greyed history when its target is deleted.
    technique_id      INTEGER REFERENCES techniques(id) ON DELETE SET NULL,
    syllabus_id       INTEGER REFERENCES syllabi(id)    ON DELETE SET NULL,
    sst_id            INTEGER REFERENCES student_syllabus_techniques(id) ON DELETE SET NULL,
    video_id          INTEGER REFERENCES videos(id)     ON DELETE SET NULL,
    -- Verb-specific display tail. NULL for most verbs, whose columns say
    -- everything. See the payload table below.
    payload_json      TEXT
);

CREATE INDEX IF NOT EXISTS idx_activity_student
    ON activity (target_student_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_activity_syllabus
    ON activity (syllabus_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_activity_technique
    ON activity (technique_id, occurred_at DESC, id DESC);
-- Coach feed: all rows ordered by recency. The (actor != viewer) filter is
-- non-selective, so this index serves the top-N scan.
CREATE INDEX IF NOT EXISTS idx_activity_recent
    ON activity (occurred_at DESC, id DESC);
-- Coalesce lookup: narrow by actor + verb, scan recent within the 30s
-- window, then filter entity col + target in memory.
CREATE INDEX IF NOT EXISTS idx_activity_coalesce
    ON activity (actor_user_id, verb, occurred_at DESC);
```

Notes:

- `id INTEGER PRIMARY KEY AUTOINCREMENT` is deliberate (not bare rowid):
  the read-side cursor references max-seen id, and `AUTOINCREMENT`
  guarantees a future pruning step can never recycle an id a cursor still
  points at.
- Feeds order by `occurred_at DESC, id DESC`, not bare `id DESC`, because
  coalescing (below) bumps a row's `occurred_at` while keeping its id, so
  the two can diverge inside a 30s window. The partition indexes lead with
  their filter column then `occurred_at DESC, id DESC` to serve this; the
  coach "all students" feed uses `idx_activity_recent`.
- `ON DELETE CASCADE` on the two user FKs matches the prevailing
  convention in this schema (users are archived, not hard-deleted, in
  normal operation). The history-survival rationale behind `ON DELETE SET
  NULL` on the entity FKs does not apply to users precisely because they
  are archived rather than deleted: no live path cascades a user's rows
  away.

## Audience model

Coaching is gym-wide (no coach->student mapping table exists;
`get_students_by_recent_updates` selects every `role='student'`). So:

- **Student feed** = rows where `target_student_id = me`.
- **Coach feed** = all rows authored by someone other than the viewing
  coach (`actor_user_id != me`). Coaching is gym-wide, so a coach is
  interested in every row: all student-targeted activity, plus coach-only
  (`target_student_id IS NULL`) rows authored by *other* coaches (e.g.
  edits to the global, coach-specific catalogue). The viewer's own actions
  are excluded from the feed. For a single coach this collapses to "all
  student activity," since the only coach-only rows are their own.

`target_student_id` is uniformly "the student this row concerns," which
is the single handle a future coach-cohort filter will build on.

## Verb registry

Verbs are named `<target>_<past_tense>`. Each verb carries one piece of
static metadata, `notifiable` (see "Notify vs record"). This lives in
code (a verb registry / enum in `db/activity.rs`), not in a DB column.

| Verb | Actor | Primary entity col | Fan-out | notifiable | Emit site (live code) |
|------|-------|--------------------|---------|------------|-----------------------|
| `video_watched` | student | video_id | no | yes | `ingest_watch_events` on crossing `min(10s, 20% of duration)` |
| `attempt_logged` | student or coach | sst_id | no | yes | `db/syllabus_attempts.rs` create |
| `attempt_edited` | actor | sst_id | no | yes | syllabus_attempts note/date edit |
| `attempt_deleted` | actor | sst_id | no | **no** | syllabus_attempts delete |
| `sst_status_changed` | actor | sst_id | no | yes | `update_sst` (status present) |
| `sst_student_notes_edited` | student | sst_id | no | yes | `update_sst` (student_notes present) |
| `sst_coach_notes_edited` | coach | sst_id | no | yes | `update_sst` (coach_notes present) |
| `technique_pinned` | student | technique_id | no | yes | `db/pinned.rs` add |
| `technique_unpinned` | student | technique_id | no | **no** | `db/pinned.rs` remove |
| `syllabus_assigned` | coach | syllabus_id | no | yes | `syllabus_assignments` assign |
| `syllabus_unassigned` | coach | syllabus_id | no | **no** | unassign |
| `syllabus_graduated` | coach | syllabus_id | no | yes | per-assignment graduate |
| `sst_added` | coach | sst_id | no | yes | `add_technique_to_assignment` |
| `sst_hidden` | coach | sst_id | no | **no** | `set_hidden` (hide) |
| `sst_unhidden` | coach | sst_id | no | **no** | `set_hidden` (unhide) |
| `syllabus_technique_added` | coach | syllabus_id | **yes** | yes | global `syllabus_techniques` add |
| `syllabus_technique_removed` | coach | syllabus_id | **yes** | **no** | global `syllabus_techniques` remove |
| `video_added` | coach | video_id | **yes** | yes | `db/videos.rs` add video |
| `video_visibility_set` | coach | video_id | global only | **no** | global hide/show (`videos.hidden_at`) or per-student override write |
| `technique_edited` | coach | technique_id | **yes** | yes | `techniques` name/description or tag change |

### Notes on specific verbs

- **`update_sst` can emit up to 3 rows** (status, student-notes,
  coach-notes) from one call, since the doc treats them as distinct
  activity. Each coalesces independently. The emit reads which optional
  fields were present in `SstUpdate`.
- **`sst_*` verbs** denormalise `technique_id` and `syllabus_id` onto the
  row alongside `sst_id` (derivable via join, but stored to keep feed
  reads join-free and filterable by syllabus / technique).
- **`technique_edited` is merged** (name + description + tags in one verb,
  delta in `payload_json`) rather than three verbs, to avoid verb sprawl.
  The PR-2 renderer branches on the payload.
- **`video_visibility_set` is merged** across global and per-student
  scope. `payload_json.scope` is `"global"` or `"student"`. Global hide /
  show fans out to affected students; a per-student override writes a
  single row. Not notifiable either way (curation nicety; the doc itself
  flagged per-student overrides as "less interesting").

### Fan-out target set

The four fan-out verbs (`syllabus_technique_added`,
`syllabus_technique_removed`, `video_added`, `technique_edited`, plus the
global branch of `video_visibility_set`) write one row per affected
student:

- For `syllabus_technique_*`: the affected students are those with an
  active (`unassigned_at IS NULL`) assignment to that syllabus.
- For `video_added` / `technique_edited` / global `video_visibility_set`:
  the affected students are the **union** of {students with the technique
  in an active assigned syllabus} and {students who pinned the technique}.
- If the affected set is empty, write **one** coach-only row with
  `target_student_id = NULL` (so the coach view still records it; e.g. an
  edit to a syllabus assigned to no one).

A shared helper in `db/activity.rs` resolves the affected-student set for
a `(technique_id)` and for a `(syllabus_id)` so the per-verb call sites
stay one line.

## payload_json contents

Four verbs carry a real display tail; the three attempt verbs carry only
a leaf deep-link pointer; all other verbs leave it NULL.

| Verb | payload_json |
|------|--------------|
| `video_watched` | `{"cumulative_seconds": i64, "duration_seconds": i64}` |
| `sst_status_changed` | `{"from": "red"\|"amber"\|"green", "to": "red"\|"amber"\|"green"}` |
| `video_visibility_set` | `{"scope": "global"\|"student", "visible": bool}` |
| `technique_edited` | `{"fields": {"name"?: bool, "description"?: bool, "tags"?: {"added": [..], "removed": [..]}}}` |
| attempt verbs | `{"attempt_id": i64}` (leaf deep-link pointer only) |

Payloads are built by typed per-verb constructor functions in
`db/activity.rs` and serialised to text. PR 1 writes payloads but does
not deserialise them (no reader yet); the typed read side lands in PR 2.

## Emission mechanism

**Inline, in the originating transaction.** Each live write path calls a
`db/activity.rs` helper inside its existing `tx`, so the activity row is
atomic with the event it records (no lost rows, no orphans). This follows
the existing convention: a composite write owns the outer transaction and
fans out one-way to leaf modules.

The emit helper signature accepts the open transaction, e.g.:

```rust
pub async fn emit(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    ev: NewActivity,
) -> Result<(), AppError>;
```

where `NewActivity` is a typed struct (verb, actor, target_student,
optional entity ids, optional payload). Fan-out verbs call a sibling
`emit_fanout(tx, ev_template, affected_student_ids)`.

Only the **new (syllabus) stack** write paths are instrumented. The
legacy `student_techniques` / `attempts` / `collections` modules are
dormant (nothing new writes to them from PR 3 of the migration onward),
so they get no emit calls.

## Coalescing

On the write side, before inserting, the emit helper checks for the most
recent row matching
`(actor_user_id, verb, <primary entity col>, target_student_id)` whose
`occurred_at` is within **30 seconds** (constant, tunable later). If
found, it **updates that row's `occurred_at`** (and merges payload where
relevant) instead of inserting. For `sst_status_changed` the merge keeps
the row's original `from` and takes the latest `to`, so a red->amber then
amber->green burst within the window coalesces to `{from: red, to: green}`
rather than losing the real starting point. This stops "student edits the
same note five times in 30s" becoming five rows.

Because the coalesce key includes `target_student_id`, fan-out rows
coalesce per affected student correctly: a coach editing the same
syllabus twice in 30s updates each student's existing row rather than
doubling them.

## Notify vs record (metadata only in PR 1)

Every verb is **recorded**. Whether a row drives an unread badge is
computed on the read side (PR 2) by a derived rule, not stored per row,
because notifiability is viewer-relative (the same row notifies the coach
but not the acting student):

```
notifies(row, viewer) =
      verb_is_notifiable(row.verb)     // static registry metadata
  AND row.actor_user_id != viewer.id   // never notified about your own action
  AND row is in viewer's feed          // target_student_id = viewer, or non-null for a coach
```

The non-notifiable verbs cluster as the delete / remove / hide / un-*
verbs (see the registry table). They remain visible as history; they just
never badge or deep-link into a void. PR 1's only obligation is to carry
`verb_is_notifiable` as registry metadata so PR 2's unread query can read
it.

## Historical backfill

A one-shot backfill (a `bin/` command, run once at deploy; idempotent via
"only if `activity` is empty" guard) seeds rows from existing tables so
the read surfaces are not blank on day one:

| Source | Verb(s) | occurred_at from |
|--------|---------|------------------|
| `syllabus_attempts` | `attempt_logged` | `created_at` |
| `student_syllabus_techniques.last_student_update_at` | `sst_student_notes_edited` | that column |
| `student_syllabus_techniques.last_coach_update_at` | `sst_coach_notes_edited` | that column |
| `video_watch_aggregates` | `video_watched` | `first_watched_at` |
| `syllabus_assignments` | `syllabus_assigned` / `syllabus_graduated` | `assigned_at` / `graduated_at` |
| `student_pinned_techniques` | `technique_pinned` | `pinned_at` |

Backfill cannot reconstruct status transitions, library/global edits, or
visibility changes (no historical record of the before/after), so those
verbs start empty. That is acceptable: they are the noisiest verbs and
the absence only affects pre-deploy history.

## PR 1 tests

- Each emit site writes the expected row(s) with correct `actor_user_id`,
  `target_student_id`, entity columns, and payload.
- Fan-out writes one row per active-assignment / union student, and a
  single NULL-targeted row when the affected set is empty.
- Coalescing: two same-key emits within 30s yield one row with the later
  `occurred_at`; outside 30s yield two rows.
- `update_sst` with multiple fields emits one row per changed field.
- Backfill is idempotent (second run is a no-op) and produces the
  expected counts from a seeded DB.
- `cargo sqlx prepare --check -- --tests` passes after the new queries.

---

# PR 2: Read side, unread, and dashboard

## Tables

```sql
-- One cursor per viewer: everything with id <= max_seen_id is implicitly
-- seen. Single feed per viewer (see scope notes); feed_key is deferred.
CREATE TABLE IF NOT EXISTS activity_cursors (
    viewer_user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    max_seen_id    INTEGER NOT NULL DEFAULT 0,
    updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Per-row overrides on top of the cursor. seen=1 marks a single row above
-- the cursor as read without advancing it; seen=0 marks a row at/below the
-- cursor as unread again. Rows made redundant by cursor movement are GC'd.
CREATE TABLE IF NOT EXISTS activity_seen_overrides (
    viewer_user_id INTEGER NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
    activity_id    INTEGER NOT NULL REFERENCES activity(id)  ON DELETE CASCADE,
    seen           BOOLEAN NOT NULL,
    PRIMARY KEY (viewer_user_id, activity_id)
);
CREATE INDEX IF NOT EXISTS idx_aso_viewer ON activity_seen_overrides (viewer_user_id);
```

### Cursor initialization at deploy

PR 1's backfill seeds historical rows but no cursors exist yet. When PR 2
ships, a fresh cursor defaults to `max_seen_id = 0`, which would count the
entire backfilled history as unread on first login. So the PR 2 deploy
seeds every existing user's cursor to the current `MAX(activity.id)`: all
pre-deploy history reads as already-seen, and only genuinely new rows
badge. Users created after deploy get the default-0 cursor as usual.

## Unread semantics

A row is unread for a viewer when:

```
unread(row, viewer) =
      notifies(row, viewer)                       // the PR-1 derived rule
  AND NOT (
        (row.id <= cursor.max_seen_id AND no override, OR override.seen = 1)
      )
  -- i.e. id > cursor, unless an override marks it seen; or id <= cursor but
  -- an override marks it explicitly unseen.
```

Operations:

- **Viewing the feed** snapshots `MAX(id)` over the viewer's feed at load
  time and advances `max_seen_id` to it, then GCs override rows now below
  the cursor. Note this is the max *id* in the feed, not the id of the row
  rendered at the top: feeds order by `occurred_at DESC`, so coalescing can
  float a lower-id row to the top, and the cursor is purely id-based.
  Snapshotting on the read avoids racing newly-arrived rows.
- **Mark all read** advances `max_seen_id` to current max id, GCs
  overrides.
- **Mark one read** inserts `(viewer, activity_id, seen=1)`; does not move
  the cursor (older items stay unread).
- **Mark one unread** inserts `(viewer, activity_id, seen=0)`, but is a
  no-op when the row is already unread (`activity_id > max_seen_id` with no
  `seen=1` override): the cursor alone already makes it unread, so a
  `seen=0` override there would be redundant and would never be GC'd.
- **GC**: whenever the cursor advances, delete override rows with
  `activity_id <= max_seen_id AND seen = 1` (redundant) and keep
  `seen = 0` ones (still meaningful below the cursor).

## Feed and count queries

- `feed(viewer, before?, limit)`: rows in the viewer's feed
  (`target_student_id = viewer` for a student; `actor_user_id != viewer`
  for a coach, i.e. all gym activity except the coach's own), ordered
  `occurred_at DESC, id DESC`, keyset-paginated on the `(occurred_at, id)`
  cursor. Joins actor + entity names for rendering. Annotates each row with
  `unread` per the rule above.
- `unread_count(viewer)`: count of unread rows. Cheap because it is
  bounded by `id > max_seen_id` plus the small override set.

## Coach dashboard redesign

The coach dashboard is rebuilt around the verb/actor stream:

- "Recently active students" is driven by recent `activity` rows grouped
  by `target_student_id`, rendering each student's latest activity inline
  with verb-aware copy ("logged an attempt on Armbar", "watched Triangle
  setup", "went green on Kimura").
- The standalone "recently watched videos" widget is **dropped**; video
  watches are just one verb in the general stream now.
- This replaces the legacy `get_students_by_recent_updates` /
  `useStudentTechniques`-backed dashboard reads. Coordinate the removal
  with `docs/LEGACY_DECOMMISSION_PLAN.md` (its dashboard section defers to
  this work).

Per-verb rendering uses a single mapping from `verb` + joined names +
`payload_json` to a display line, reused by the dashboard now and the
later full activity page. Non-notifiable rows render as plain history
(greyed, no deep-link when the entity column is NULL).

## Student "recent activity"

The student profile hub "Recent activity" section is rebuilt to read the
student's own feed (`target_student_id = me`) from the same feed query,
replacing the legacy SST / attempt aggregate read. This also exercises the
cursor model end-to-end before the full activity page exists.

## PR 2 tests

- Cursor advance on view sets `max_seen_id` to the snapshot top id, not a
  later-arriving row's id.
- Mark-one-read does not change unread status of older rows ("clear newest
  keeps older unread").
- Mark-one-unread on a below-cursor row makes it unread again.
- GC deletes redundant `seen=1` overrides on cursor advance, keeps
  `seen=0`.
- `notifies` excludes the actor's own rows and non-notifiable verbs from
  the unread count, while the feed still lists them.
- Dashboard query returns the expected recently-active-students ordering
  from seeded activity.
- Keyset pagination returns stable, non-overlapping pages.

## PR 2 frontend / UI

- Coach dashboard: design the redesigned screen when we reach it; a visual
  mock is worth doing at that point rather than specifying layout in prose
  here.
- Student "recent activity" section: reuse the shared per-verb renderer.
- Unread badge + "mark all read" affordance wired to the count / cursor
  endpoints.
- Follow the existing RHF + Zod + TracedForm and shadcn/ui conventions per
  the frontend skill; reuse the unified `TechniqueRow` where an activity
  row expands to technique context.

---

## Open follow-ups (explicitly later)

- Pruning / archival of rows older than ~1 year out of the hot table.
- The dedicated social-feed-style activity page (its own top-level route
  per the student-pages IA).
- `feed_key` + a second disjoint feed (camps), if/when that exists.
- `video_rewatched` verb for returning after a long gap.
- Comment / thread-reply and video-timestamp-comment verbs (the schema
  already accommodates them: new verb string, reuse entity columns +
  payload).
