# Social Activity Tiles: Design

**Date:** 2026-06-17
**Branch:** `feat/social-media-tiles`
**Status:** Approved (autonomous; user AFK, explicit "spec, plan, implement" mandate)

## Problem

The student activity feed is a list of one-line narratives: an avatar, a bold
verb phrase ("set Armbar to Doing"), a timestamp, and a small surface chip. It
reads like a changelog, not a feed. The user wants a true social-media-esque
feed: each entry surfaces **the noun that was acted on, rendered the way you'd
see it on the surface it lives on**.

- A coach changes a syllabus technique's status -> the entry embeds that
  technique's row, in the student-syllabus context (status dot, attempt count,
  expandable to videos/notes/attempts).
- A student watches a video on a library technique -> the entry embeds that
  technique's row in the global-library context.

The verb/actor narrative stays (who did what, when), but it becomes a **header
above an embedded object tile**, not the whole entry.

## Key insight: the tiles already exist

The feed acts on several nouns, and the project already has the surface
component for each one:

- **Technique** -> `frontend/src/components/technique-row/` is a unified compound
  that renders a technique in five surface contexts (`global-library`,
  `student-pinned`, `student-syllabus`, `syllabus-management`, `camp`), driven by
  a discriminated `RowContext`, expanding in place to videos/notes/attempts/
  discussion. Every native surface renders this same component.
- **Thread / comment / reply** (incl. on videos) -> `components/threads/ThreadView`
  renders a thread, its comments, and reply chain, anchor-addressed by
  (`technique` | `sst` | `video`). One component covers threads, replies,
  threads-on-videos, and replies-on-threads-on-videos: they are all the
  `thread_comment_posted` verb with a different anchor.

So this feature is **not** new tile renderers. It is:

1. A hydration layer that turns a lightweight `ActivityRow` (verb + entity ids +
   names) into the props the matching existing component needs, by reading the
   same queries the native surfaces already cache.
2. A feed entry component that stacks a social header over the embedded tile and
   dispatches to the right tile type by verb.
3. A small `embedded` flag on `TechniqueRow` to suppress mutation chrome in the
   feed (the feed is for viewing/previewing, not curation).

## Tile taxonomy

The noun, and therefore the tile, is chosen by verb:

| Verbs | Noun | Tile | Hydration |
|-------|------|------|-----------|
| `attempt_*`, `sst_status_changed`, `sst_*_notes_edited`, `technique_pinned`/`unpinned`, `sst_added`/`hidden`/`unhidden`, `syllabus_technique_added`/`removed`, `technique_edited`, `video_watched`, `video_added`, `video_visibility_set` | technique (video verbs point at the video) | **TechniqueTile** -> embedded `TechniqueRow` in its surface context; for video verbs the row expands scrolled to the video | library / syllabus list query |
| `thread_comment_posted` | the thread / comment / reply (on a technique, sst, or video) | **CommentTile** -> embedded `ThreadView` for the thread, with an anchor chip naming the technique or video it lives on | `listThreads(anchorKind, anchorId)` -> find by `thread_id` |
| `syllabus_assigned`/`unassigned`/`graduated` | syllabus (no in-context row noun) | **header-only** (today's narrative line) | none |
| `camp_*`, `competition_*`, `match_*`, `student_registered`, `camp_promoted_to_competition` | camp / competition / match | **header-only** in v1; UI gated off in prod. Clear seam for `CampTile`/`MatchTile` later | none (deferred) |

Video verbs fold into TechniqueTile (the video is surfaced inside the row's
video block, scrolled into view) rather than a standalone video-player card;
splitting out a dedicated `VideoTile` is a later refinement, not v1.

## Architecture

### Entry anatomy (`ActivityTile`)

```
+-----------------------------------------------------------+
|  (avatar)  Matty Admin                          2h ago    |   <- social header
|            ● set Armbar to Doing  ·  Blue Belt Syllabus   |      (existing narrative
|                                                           |       line + surface chip)
|  +-----------------------------------------------------+  |
|  | ● Armbar                                    ▸  ▾    |  |   <- embedded TechniqueRow
|  |   ▶ 3   🎯 5                                        |  |      (student-syllabus ctx,
|  +-----------------------------------------------------+  |       expand-in-place)
+-----------------------------------------------------------+
```

- **Header** carries navigation: it is the existing `activityLine` rendering
  (verb, status dot, subject, surface chip) and remains a deep-link to the real
  surface (`line.href`). Tapping the header navigates.
- **Tile** carries preview: the embedded `TechniqueRow`. Tapping it expands in
  place; it does not navigate. This cleanly separates the two affordances and
  avoids the nested-interactive-inside-a-link accessibility trap the current
  whole-row `<Link>` wrestles with.

### Hydration (`useActivityTechnique`)

Per entry, resolve the row's `ViewContext` (the existing `rowToViewContext`),
then read the already-cached list query for that surface and locate the entity:

**TechniqueTile** (resolve the row's `ViewContext` via existing
`rowToViewContext`, then read the cached list query and locate the entity):

| ViewContext kind | Source hook                                   | RowContext built        |
|------------------|-----------------------------------------------|-------------------------|
| `library`        | `useLibraryTechniques` (coach) / `useStudentLibrary` (student viewer) | `global-library` |
| `syllabus`       | `useStudentSyllabusTechniques(studentId, syllabusId)` -> find sst by `sst_id` -> `toLibraryShape(sst)` | `student-syllabus` (sst, assignment) |
| `camp` / `competition` / `match` | not hydrated in v1 (UI gated off in prod) | n/a |

**CommentTile** (`thread_comment_posted`): pick the anchor from the row
(`context_kind === "syllabus"` -> `sst`/`sst_id`; `context_kind === "library"`
-> `technique`/`technique_id`; `video_id` present -> `video`/`video_id`), call
`useThreadsForAnchor(anchorKind, anchorId)`, find the thread by `thread_id`, and
render `ThreadView`. Anchor chip names the video title or technique name.

The TanStack Query cache dedups: a 100-row feed referencing three syllabi and
the library fires ~4 list fetches, not 100. This reuses the exact endpoints and
cache keys the native pages use, so a tile and its real surface never diverge.

Because hooks can't be called in a loop, each entry is its own component and
**switches on `ViewContext.kind` into a per-kind subcomponent** (`SyllabusTile`,
`LibraryTile`), each of which always calls the same single list hook. Rules of
hooks satisfied; the subcomponent type is stable for a given row.

### Fallbacks (graceful, no broken tiles)

An entry renders **header-only** (today's behavior, no tile) when:

- The verb has no single technique noun (syllabus assigned/unassigned/graduated,
  camp/competition/match verbs, broadcast profile comments).
- The row resolves to a context but the entity is gone (deleted technique,
  unassigned syllabus, hidden sst not in the list) -> hydration returns nothing.
- The surface is gated off (camp/competition while `campsUiEnabled` is false).

While the list query is loading, the tile slot shows a **fixed-height skeleton**
matching the collapsed `TechniqueRow` header, so hydration never shifts layout
(CLS = 0).

### `embedded` flag on `TechniqueRow`

A new optional `embedded?: boolean` prop. When true, the row-chrome action
buttons (pin, remove-from-syllabus, hidden toggle, add-to-camp) are suppressed.
The header, status dot, meta strip, and expand-in-place panel stay. This keeps
the feed a viewing/preview surface and avoids cluttering entries with curation
controls (the "trim interaction options" feed heuristic), while the in-panel
blocks keep their existing per-role permissions for anyone who does want to act.
Surgical: one file (`technique-row.tsx`), gating the four `show*` booleans.

### Where tiles render

`ActivityFeedList` gains `variant?: "compact" | "tiles"` (default `compact`).

- **`tiles`**: student timeline (`/student/:id/activity`) and the profile
  embedded feed. The full social feed.
- **`compact`**: dashboard gym glance and any coalesced member rows stay the
  current one-line narrative (a glance is not a feed; tiles there would be
  noise).

Coalesced groups render **one tile** for the representative entry plus the
existing "and N more" expander listing member subjects as compact lines. We do
not stack N heavy tiles for "watched 5 videos".

## Anti-patterns explicitly avoided

Research (getstream.io activity-feed-design, uxcel feed best practices,
greatfrontend news-feed system design, speedvitals/debugbear on CLS):

1. **Context loss in a mixed feed** -> every tile renders in its real surface
   context and keeps the surface chip; the embedded component is literally the
   same one that surface uses, so affordances never drift.
2. **Layout shift as async tiles hydrate** -> fixed-height skeleton per tile
   slot; new items only ever append below; reserved space before content loads.
3. **Unbounded fetch fan-out** -> hydrate off shared cached list queries (dedup
   by surface), not a per-row fetch. No N+1.
4. **Narrative loss** -> the "who did what when" header is preserved above every
   tile; the tile augments, it does not replace, the social line.
5. **Nested interactivity / a11y** -> header = navigation link, tile = in-place
   expander; they never wrap each other. No `<button>` inside `<a>`.
6. **Interaction overload** -> `embedded` strips curation chrome; the feed is
   scan + preview + deep-link, not a control panel.
7. **Duplicate/repetitive entries** -> existing coalescing kept; one tile per
   group.

## Out of scope (v1)

- Tiles for camp / competition / match entries (UI gated off in prod). The
  taxonomy switch leaves a clear seam to add `CampTile`/`MatchTile` later.
- A standalone video-player card (`VideoTile`). Video verbs fold into
  TechniqueTile with the video scrolled into view; split later if wanted.
- A "syllabus card" for assign/unassign/graduate. These stay header-only.
- A dedicated batch hydration endpoint. The shared-cache approach is sufficient
  at current gym data sizes; note it as a future optimization if a feed ever
  references many distinct syllabi.
- Changing the gym-wide dashboard glance to tiles.

## Affected files

**Frontend (new):**
- `frontend/src/components/activity-feed/activity-tile.tsx` - the entry (header + tile slot); dispatches to the tile type by verb.
- `frontend/src/components/activity-feed/technique-tile.tsx` - hydrates + renders the embedded `TechniqueRow`.
- `frontend/src/components/activity-feed/comment-tile.tsx` - hydrates the thread + renders the embedded `ThreadView` with an anchor chip.
- `frontend/src/components/activity-feed/tile-kind.ts` - pure `activityTileKind(row)` -> `"technique" | "comment" | null` + anchor resolution; the one place the taxonomy lives.
- `frontend/src/components/activity-feed/to-library-shape.ts` - shared `SstRow -> LibraryTechniqueRow` adapter (lifted from the student-syllabus page so both use one copy).
- Unit tests for `tile-kind` + hydration selection (`*.unit.test.ts`) and component tests (`*.test.tsx`, CI-only).

**Frontend (changed):**
- `frontend/src/components/technique-row/technique-row.tsx` - add `embedded` prop, gate the four chrome buttons.
- `frontend/src/components/activity-feed-list.tsx` - `variant` prop; render `ActivityTile` per entry when `variant === "tiles"`; keep compact path unchanged.
- `frontend/src/app/student-activity/page.tsx` - pass `variant="tiles"`.
- `frontend/src/app/student-profile/page.tsx` - pass `variant="tiles"` to its feed.
- `frontend/src/app/student-syllabi/[syllabusId]/page.tsx` - import the shared `toLibraryShape` instead of its local copy (no behavior change).

**Backend:** none. The existing `ActivityRow` already carries every id needed
(`technique_id`, `sst_id`, `syllabus_id`, `video_id`, `target_student_id`,
`context_kind`). Hydration reads existing endpoints.

## Testing

- **Unit (node, runnable here):** `tile-kind` -- technique verbs -> `"technique"`,
  `thread_comment_posted` -> `"comment"` with the right anchor, syllabus/camp
  verbs -> `null`. Technique resolution -- given a syllabus row + a cached sst
  list, returns the right sst and `student-syllabus` context; library row ->
  `global-library`; missing entity -> `null`. `to-library-shape` maps fields
  correctly.
- **Component (CI-only browser `*.test.tsx`):** an `ActivityTile` for a syllabus
  status row renders an embedded `TechniqueRow` with the status dot and no
  chrome buttons; a `thread_comment_posted` row renders the embedded thread; a
  non-technique/non-comment row renders header-only; a loading state renders the
  fixed-height skeleton. Stub `window.fetch`; no `vi.spyOn` on `@/lib/api`; no
  `as` casts.
- **Existing feed tests** (`activity-feed-list.test.tsx`) keep passing with the
  default `compact` variant.

## Verification gate

- `cd frontend && npx tsc --noEmit && pnpm lint && pnpm vitest run --project node`
- `nix develop .#ci --command just lint` (backend untouched, but keep green)
- Manual smoke via `/run` if practical: open a student timeline, confirm a
  status-change entry shows the technique tile in syllabus context, expands in
  place to videos/notes, and the header still deep-links to the syllabus.
