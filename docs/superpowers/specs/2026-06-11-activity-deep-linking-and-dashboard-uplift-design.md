# Activity Deep-Linking and Coach Dashboard Uplift, Design

**Status:** Approved (brainstorming complete, pending spec review)
**Date:** 2026-06-11
**Author:** Matt + Claude

## Goal

Make the coach dashboard's recent-activity feed legible on phones and turn every
activity row into a deep link that lands the coach in the exact surface the
student acted in. Capture the view-context for video watches explicitly, using a
typed, extensible model that we can grow to profiles, camps, matches, and
(nested) comment threads later without a redesign.

## Background

The coach dashboard's "Recent activity" feed (the shared `ActivityFeedList`,
`frontend/src/components/activity-feed-list.tsx`) currently truncates each
description and spends the whole right column on a long absolute timestamp
("Today at 02:54 am"). Only the inner text line is a link, and the link targets
are coarse: `activityLine()` (`frontend/src/lib/activity-line.ts`) sends every
technique-scoped verb to `/library` with no student, syllabus, or scroll target,
and sends videos to `/library?technique=&video=` (an already-working expand +
scroll + highlight on the library page).

The activity log is already ActivityStreams-shaped (verbs, actor, target,
denormalized entity columns). What it lacks is an explicit record of *where* a
student was when a video was watched, so the feed cannot route a watch back to
its context. Reconstructing context by inspecting which FK column is non-null
breaks down the moment a video can live in several places at once (a video in a
comment thread that is itself on a video on a syllabus).

## Established patterns we are following

A deep link is a typed reference to a subject plus an optional typed reference to
the context it should be viewed in; the type is always explicit, never inferred.

- **Slack permalinks**: a path of typed ids with the focus as the leaf and the
  parent carried separately (`/archives/<channel>/p<ts>?thread_ts=<parent>`);
  the native scheme puts the object type in the path (`slack://channel?id=`).
- **Rails polymorphic associations**: `(commentable_type, commentable_id)`,
  self-referential for nesting. The shape of our future threads/replies.
- **Relay Global Object Identification**: one opaque, typed handle
  `base64(Type:id)` from which the object can be refetched; type embedded in the
  identifier.
- **ActivityStreams 2.0** (already partly adopted here): objects carry `id`,
  `type`, and a `context` property, plus `inReplyTo`/`replies` for threading.

## Scope

### In scope
1. Remove the "Ready for a syllabus" block from the coach dashboard.
2. Redesign the shared activity row: compact relative time top-right, bold verb,
   full wrapping description, whole row tappable.
3. A typed deep-linking model: `EntityRef` + `ViewContext` + a `focus=<type>:<id>`
   URL token, with `viewContextHref()` and `parseFocusToken()` as the two seams.
4. Capture video-watch view-context explicitly (`context_kind` discriminator plus
   the existing typed reference columns) at watch time.
5. Teach the student-syllabus detail page to consume the `focus` token (expand,
   scroll, highlight), and migrate the library page onto the same token.

### Out of scope (future, but the model is built to absorb them additively)
- Camps, matches, comment threads, video-on-video threads, and the social feed.
- Capturing view-context for non-video verbs (attempts/notes are inherently
  syllabus-scoped, so their context is implied by the verb).
- A "copy permalink / share" UI.

## The deep-linking model (the durable core)

Two primitives plus two pure functions. This is the part designed to outlive the
current cut.

```ts
// A typed reference to any addressable entity. Closed enum -> exhaustive
// switches in both TS and Rust. (Rails-polymorphic / Relay-node / AS2 type+id,
// but constrained for compiler-checked safety.)
type EntityRef =
  | { type: 'technique'; id: number }
  | { type: 'video';     id: number }
  | { type: 'sst';       id: number }
  | { type: 'syllabus';  id: number }
  | { type: 'student';   id: number };
  // future: 'camp' | 'match' | 'video_thread' | 'comment'

// The surface a student was on when the activity happened (AS2 `context`).
type ViewContext =
  | { kind: 'library';  technique: EntityRef; video?: EntityRef }
  | { kind: 'syllabus'; student: EntityRef; syllabus: EntityRef; sst: EntityRef; video?: EntityRef };
  // future: { kind: 'camp'; ... } | { kind: 'match'; ... } | { kind: 'video_thread'; ... }
```

### Serialization seams

```ts
const refToken = (r: EntityRef): string => `${r.type}:${r.id}`;     // "sst:42"

function parseFocusToken(raw: string | null): EntityRef | null;     // "sst:42" -> {type:'sst', id:42}
                                                                    // rejects unknown types / malformed input -> null

function viewContextHref(ctx: ViewContext): string {
  switch (ctx.kind) {
    case 'library':
      return `/library?focus=${refToken(ctx.technique)}` +
             (ctx.video ? `&video=${ctx.video.id}` : '');
    case 'syllabus':
      return `/student/${ctx.student.id}/syllabi/${ctx.syllabus.id}` +
             `?focus=${refToken(ctx.sst)}` +
             (ctx.video ? `&video=${ctx.video.id}` : '');
    // adding a kind makes this switch non-exhaustive -> compile error -> a guided edit
  }
}
```

- `parseFocusToken` lives in a new `frontend/src/lib/entity-ref.ts` alongside
  `refToken` and the `EntityRef` type.
- `viewContextHref` and the `ViewContext` type live in a new
  `frontend/src/lib/view-context.ts`.
- The `focus=<type>:<id>` token replaces the library page's current
  `?technique=<id>` param. `&video=<id>` stays a plain id (it is already scoped
  under the focused technique). So the library URL change is `technique=9`
  becoming `focus=technique:9`.

### Round trip

activity row typed columns -> `ViewContext` (built on the frontend) ->
`viewContextHref()` -> URL with typed `focus` token -> target page parses the
token back into an `EntityRef` -> a shared "expand + scroll + highlight" consumer
acts on it. Two seams, `viewContextHref` and `parseFocusToken`; everything else
is data.

## Backend: capture video-watch context

### Schema

Add one nullable discriminator column to the activity table
(`config/schema.sql`, `CREATE TABLE activity`):

```sql
-- Names the surface a student was on when the activity happened, so the feed
-- can deep-link back to it without inferring from which reference column is
-- non-null. NULL for verbs whose context is implied by the verb itself
-- (attempts/notes are always syllabus-scoped). Today: 'library' | 'syllabus'.
context_kind TEXT
```

The typed reference ids reuse the existing `technique_id`, `syllabus_id`, and
`sst_id` columns (all already FK-backed with `ON DELETE SET NULL`). No new id
columns are needed for this cut.

### Emit

`NewActivity` (`crates/syllabus-tracker/src/db/activity.rs`) gains a
`context_kind: Option<&'static str>` field plus a builder method, and the `emit`
INSERT writes the new column. Only `video_watched` sets it for now.

The `record_watch` path (`crates/syllabus-tracker/src/db/watch.rs`) currently
emits:

```rust
NewActivity::new(Verb::VideoWatched, user_id)
    .target_student(user_id)
    .video(video_id)
    .payload(payload::video_watched(new_cumulative, duration_seconds))
```

It will additionally attach the captured context. The `WatchInput` /
watch-events request body gains an optional typed context:

```rust
struct WatchContextInput {
    technique_id: i64,           // the video's technique; required when context present
    syllabus_id: Option<i64>,    // set only for the syllabus surface
    sst_id: Option<i64>,         // set only for the syllabus surface
}
```

Mapping at emit time:
- syllabus surface (`syllabus_id` + `sst_id` present): `context_kind = "syllabus"`,
  `.technique(technique_id).syllabus(syllabus_id).sst(sst_id)`.
- otherwise (technique only): `context_kind = "library"`, `.technique(technique_id)`.
- no context sent (legacy callers, analytics surfaces): emit unchanged, no
  `context_kind`, `technique_id` stays null. Such rows fall back to a plain
  `/library` link.

### Read

`activity_read.rs` SELECTs add `act.context_kind` to every activity projection
that the feed and profile consume, exposed on the read row.

## Frontend: wire DTO and ViewContext construction

`ActivityRow` (`frontend/src/lib/activity-line.ts`) gains
`context_kind: string | null`. The frontend builds a `ViewContext | null` from a
row:

- `video_watched`: switch on `context_kind`.
  - `"syllabus"` and `target_student_id`/`syllabus_id`/`sst_id`/`technique_id`
    present -> `{ kind:'syllabus', student, syllabus, sst, video }`.
  - otherwise, `technique_id` present -> `{ kind:'library', technique, video }`.
  - neither resolvable -> null (fall back to `/library`).
- `attempt_logged` / `attempt_edited` / `attempt_deleted` / `sst_status_changed`
  / `sst_student_notes_edited` / `sst_coach_notes_edited`: context is implied
  syllabus. If `target_student_id` + `syllabus_id` + `sst_id` present ->
  `{ kind:'syllabus', student, syllabus, sst }`; else null.
- `technique_pinned`: route to the student's pinned page (see routing table);
  not modeled as a `ViewContext` for this cut.
- all other verbs: keep their existing direct hrefs (assignment/curation verbs
  to `/syllabi/<id>`), unchanged.

## Frontend: `activityLine()` restructure

`activityLine(row)` returns `{ verb, subject?, href? }` instead of a flat
`{ text, href }`:

- `verb`: the bold phrase, e.g. `"logged an attempt on"`, `"updated student notes on"`, `"watched"`.
- `subject`: the entity name in normal weight, e.g. `"Back Take"`. Optional
  (some lines, like `"performed an action"`, have no subject).
- `href`: computed as `ctx ? viewContextHref(ctx) : legacyHref(row)`, where
  `legacyHref` covers the unchanged assignment/curation/pin verbs and returns
  `undefined` when no target is resolvable.

`coalescedSuffix(item)` (`activity-coalesce.ts`) appends after `subject`
unchanged (" and N more").

### Routing table (per verb, what a row tap does)

| Verb(s) | Destination |
|---|---|
| `attempt_logged`, `attempt_edited`, `attempt_deleted` | `/student/<target>/syllabi/<syllabus>?focus=sst:<sst>` |
| `sst_status_changed`, `sst_student_notes_edited`, `sst_coach_notes_edited` | `/student/<target>/syllabi/<syllabus>?focus=sst:<sst>` |
| `video_watched` (syllabus context) | `/student/<target>/syllabi/<syllabus>?focus=sst:<sst>&video=<video>` |
| `video_watched` (library context) | `/library?focus=technique:<technique>&video=<video>` |
| `technique_pinned` | `/student/<target>/pinned` (focus token included if `technique_id` present; consumer optional) |
| `syllabus_assigned`, `syllabus_unassigned`, `syllabus_graduated`, `syllabus_technique_added`, `syllabus_technique_removed` | `/syllabi/<syllabus>` (unchanged) |
| any verb with no resolvable target | no link (row renders non-interactive) |

## Frontend: row layout

Chosen layout (compact time top-right). One change in `ActivityFeedList`, so it
lands on both the dashboard feed and the student-profile feed.

```
+----------------------------------------+
| (AR) Alex Rivera               3h      |
|      updated student notes on          |   <- verb bold, subject normal,
|      Knee Cut Pass                     |      full width, wraps, no truncation
+----------------------------------------+
```

- Avatar on the left (unchanged `StudentAvatar`, hidden when `showAvatar={false}`
  on the single-student profile feed).
- Line 1: bold actor name, with a compact relative time pinned top-right.
- Line 2+: the full description, wrapping (remove the `truncate` class), verb in
  `font-medium`/`font-semibold`, subject normal.
- The entire row is a single `<Link to={href}>` when `href` is set; the inner
  text link is removed (no nested anchors). Rows without an `href` render as a
  non-interactive container. Hover affordance (`hover:bg-muted/40`) applies to
  the whole row when it is a link.

### Compact time

New `formatRelativeShort(input)` in `frontend/src/lib/dates.ts`:
- `< 60s` -> `"now"`
- `< 60m` -> `"<N>m"`
- `< 24h` -> `"<N>h"`
- `< 7d`  -> `"<N>d"`
- else    -> short date (`"Jun 3"`), reuse the existing absolute formatter.

`formatRelative` is left unchanged for its other callers.

## Frontend: focus-token consumers

### Student-syllabus detail page

`frontend/src/app/student-syllabi/[syllabusId]/page.tsx` currently has no focus
handling. Add a consumer that mirrors the proven library-page effect:

- Read `focus` via `useSearchParams`, `parseFocusToken` it, accept only
  `{ type: 'sst' }`.
- On first arrival (guarded by a `useRef`), once `techniques` is loaded and the
  target sst is present in the unfiltered list: set `expandedValue` to
  `sst-<id>`, read optional `&video=<id>` into a `scrollToVideoId`, strip the
  consumed params with `{ replace: true }`, then `requestAnimationFrame` ->
  `document.getElementById('technique-row-<techniqueId>')?.scrollIntoView({ behavior:'smooth', block:'start' })`.
- Pass `scrollToVideoId` / `onVideoScrolled` to the focused `TechniqueRow`
  (the same props the library page already uses to highlight a video).

This logic is shared with the library page, so factor it into a
`useFocusTarget` hook (`frontend/src/components/hooks/useFocusTarget.ts`) that
both pages mount. The hook is generic over the resolved `EntityRef`; each page
supplies how to expand/scroll/highlight for the ref types it hosts.

### Library page

`frontend/src/app/library/page.tsx` migrates its existing inline effect onto
`parseFocusToken` + `useFocusTarget`, accepting `{ type: 'technique' }`. Behavior
is unchanged; only the param name moves from `technique=<id>` to
`focus=technique:<id>`, with `&video=<id>` retained.

## Frontend: watch-context capture

The video player and its `useWatchTracker` (`frontend/src/components/videos/useWatchTracker.ts`)
live inside a `TechniqueRow`, which exposes its surface via `useTechniqueRow()`
(`technique-row-context.ts`, a `RowContext` discriminated union) and the row's
technique via `state.technique`. The component that mounts the player derives a
`WatchContext` and passes it into the tracker; the tracker includes it in the
`/api/videos/<id>/watch-events` POST body.

- `student-syllabus` surface -> `{ technique_id, syllabus_id, sst_id }`.
- `global-library` / `student-pinned` / `syllabus-management` -> `{ technique_id }`.
- callers with no `TechniqueRow` context (analytics panels) -> omit context.

The context is per-play and constant, so it is sent alongside the buffered
events on each flush.

## Remove "Ready for a syllabus"

`frontend/src/app/dashboard/page.tsx`: delete the `needsSyllabus` `useMemo` and
stop passing it to `QueuePanel`. `frontend/src/app/dashboard/components/queue-panel.tsx`:
remove the `needsSyllabus` prop and the block that renders it. No other consumers.

## Data flow

1. Student watches a video inside a `TechniqueRow`. `useWatchTracker` posts
   buffered events plus the derived `WatchContext`.
2. `record_watch` crosses the watch threshold and emits `VideoWatched` with
   `context_kind` + the typed reference columns.
3. The coach opens the dashboard. `dashboard_activity_feed` reads the rows
   including `context_kind`.
4. `ActivityFeedList` renders each row: `activityLine()` -> `{verb, subject, href}`,
   where `href` came from `viewContextHref(ViewContext)`.
5. The coach taps a row. The browser navigates to the typed-`focus` URL.
6. The target page's `useFocusTarget` parses the token, expands the accordion
   row, scrolls it to the top, highlights the video if present, and strips the
   params. Back returns to the dashboard natively.

## Error handling and edge cases

- **No resolvable target**: `href` is `undefined`; the row renders as a plain
  container, no link, no hover affordance.
- **Deleted entity** (FK `SET NULL`): the relevant id is null, so the
  `ViewContext` builder returns null and the row falls back per the table (or to
  no link). `activityLine` never throws.
- **Coalesced rows** ("and N more"): the row links to the representative (most
  recent) row's `href`.
- **Malformed / unknown `focus` token**: `parseFocusToken` returns null; the
  consumer no-ops and leaves the page in its default state.
- **Focus target filtered out**: the consumer runs against the unfiltered list
  on fresh arrival (search/tags default empty), so the target is present. If a
  target id is genuinely absent, the consumer no-ops.
- **Legacy watch events** (no context): emit unchanged; row falls back to
  `/library`.

## Testing

- **Node unit (`*.unit.test.ts`, runs locally):**
  - `parseFocusToken` parses valid tokens and rejects unknown types / malformed
    input.
  - `viewContextHref` produces the expected URL for each `ViewContext` kind,
    with and without `video`.
  - `activityLine` returns the correct `{verb, subject, href}` for each verb,
    including the syllabus-vs-library `video_watched` split and the null-target
    fallbacks.
  - `formatRelativeShort` buckets (`now`/`m`/`h`/`d`/date).
- **Browser (`*.test.tsx`, CI-only Chromium):** stub `window.fetch` (never
  `vi.spyOn` ESM exports; see `reference-vitest-browser-fetch-stub`). Use
  `renderWithProviders`.
  - `ActivityFeedList`: whole row is a link to the right href; verb is bold;
    compact time shows; description is not truncated.
  - Student-syllabus page: arriving with `?focus=sst:<id>` expands the matching
    row (scroll mocked).
- **Backend (`cargo nextest`, offline):**
  - `record_watch` with a syllabus context writes `context_kind='syllabus'` and
    the `syllabus_id`/`sst_id`/`technique_id` columns on the `video_watched` row.
  - `record_watch` with a library context writes `context_kind='library'` and
    `technique_id` only.
  - `record_watch` with no context is unchanged.
  - `dashboard_activity_feed` and the student feed still return rows including
    `context_kind`.

## Migration and sqlx notes

- `config/schema.sql` adds `context_kind` to `activity`; the `emit` INSERT and
  the `activity_read` SELECTs change, so the `.sqlx/` offline cache must be
  regenerated. CI seeds the DB before `cargo sqlx prepare --check`, so regenerate
  against a seeded DB (see `project-sqlx-check-seed-dependency`). Never rebuild
  `data/sqlite.db` while the dev app is running; regenerate against a temp DB via
  the `.env`-edit recipe.
- No data backfill is required; existing `video_watched` rows simply have
  `context_kind = NULL` and fall back to `/library`.

## File touchpoints

**Backend**
- `config/schema.sql` (add `context_kind`)
- `crates/syllabus-tracker/src/db/activity.rs` (`NewActivity` field + builder, `emit` INSERT)
- `crates/syllabus-tracker/src/db/watch.rs` (`WatchInput` context, `record_watch` emit)
- `crates/syllabus-tracker/src/db/activity_read.rs` (SELECT `context_kind`)
- `crates/syllabus-tracker/src/api.rs` (watch-events request body, if the DTO lives here)
- `.sqlx/` (regenerated cache)

**Frontend**
- `frontend/src/lib/entity-ref.ts` (new: `EntityRef`, `refToken`, `parseFocusToken`)
- `frontend/src/lib/view-context.ts` (new: `ViewContext`, `viewContextHref`, row -> context builder)
- `frontend/src/lib/activity-line.ts` (restructure to `{verb, subject, href}`, add `context_kind` to `ActivityRow`)
- `frontend/src/lib/dates.ts` (`formatRelativeShort`)
- `frontend/src/components/activity-feed-list.tsx` (layout + whole-row link)
- `frontend/src/components/hooks/useFocusTarget.ts` (new: shared focus consumer)
- `frontend/src/app/library/page.tsx` (migrate to focus token + hook)
- `frontend/src/app/student-syllabi/[syllabusId]/page.tsx` (add focus consumer)
- `frontend/src/components/videos/useWatchTracker.ts` (send watch context)
- the player-mounting component (derive `WatchContext` from `useTechniqueRow`)
- `frontend/src/app/dashboard/page.tsx` + `frontend/src/app/dashboard/components/queue-panel.tsx` (remove "Ready for a syllabus")
