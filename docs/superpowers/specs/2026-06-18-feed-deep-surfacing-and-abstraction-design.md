# Feed Deep-Surfacing + Activity-Tile Abstraction Design

**Date:** 2026-06-18
**Branch:** `feat/social-media-tiles` (continues PR #84)
**Status:** Proposed (pending spec review). No code in this doc; refactor + feature plan only.

## Two problems, one root

### Problem A — the feature (deep-surfacing)

Feed tiles embed the wrong-altitude noun. A comment on a **video** shows a
collapsed *technique* row; a **video watch** shows a collapsed *technique* row;
a thread on a **technique** shows a collapsed technique row with the discussion
hidden. The breadcrumb stops at the surface ("Demo Coach › Global Technique
Library") and never names or links the actual subject.

Desired (per review of images 13/14/15):

- The embedded element is the **most specific interactable noun**:
  - video present (video comment, video watch, video added) → the **video player**
    (`VideoReviewPanel`: inline player + timestamped moment composer/overlay +
    thread). User chose the full review panel.
  - technique thread (no video) → the technique + its thread, visible.
  - other technique verbs (attempt/status/pin) → the technique row.
- The breadcrumb is the full deep-linked path: **actor → surface → technique**
  ("Demo Coach → Global Technique Library → Scissor Sweep"), each its own link.
- Same principle extends to camp/competition subjects where a noun exists.

### Problem B — the abstraction (why A keeps being painful)

This is the **fourth** redesign of the same tile system in this branch, and each
pass has fixed *drift bugs* rather than feature gaps. That is the real signal:
**the model is fighting us.** A single activity row's meaning ("who did what to
which noun, in what context, and how do I render/deep-link it") is re-derived
independently in four places that branch on the same verb/anchor taxonomy:

| Module | Decides | Form |
|---|---|---|
| `lib/activity-line.ts` | verb → copy phrase + subject + deep `href` | `switch(verb)`, 29 arms |
| `lib/activity-caption.ts` | verb → tile caption text | `switch(verb)`, 17 arms (overlaps activity-line) |
| `lib/view-context.ts` | row → `ViewContext` (deep link), surface chip, gating | `switch`/`Set`, 10 arms + verb sets |
| `components/activity-feed/tile-kind.ts` | row → which embedded tile | verb `Set`s + anchor branching |

These four must agree but have no shared source of truth, so they drift. Every
bug fixed this session was drift:

- **Pins / technique_edited / syllabus_technique_add·remove / visibility had no
  tile** — `TECHNIQUE_VERBS` (tile-kind) was a *superset* of the verbs
  `rowToViewContext` (view-context) could resolve, so tile-kind promised a tile
  the renderer couldn't build.
- **Profile / camp comments had no tile** — tile-kind only routed 3 of 5 thread
  anchors.
- **Suggestions said "performed an action" and leaked past the prod gate** —
  activity-line had no arm and the gate (view-context) keyed on surface kind,
  which suggestions don't have.

Underneath, the wire format is a **wide bag of nullable typed FK columns**
(`technique_id`, `video_id`, `sst_id`, `syllabus_id`, `thread_id`, `camp_id`,
`competition_id`, `match_id`) plus a loose `context_kind` string. "What noun is
this activity about?" is implicit in *which columns happen to be non-null*, and
every consumer re-implements the read. We are reverse-engineering the object
type on the client, repeatedly and inconsistently.

The kicker: **the backend already knows the object type.** `db/activity.rs` has
`EntityKind { Technique, Syllabus, Sst, Video, Thread, Camp, Competition, Match }`
and `Verb::primary_entity() -> EntityKind`. It computes this for coalescing, then
throws it away at the wire — the client rebuilds it from nullable columns.

## Research — established patterns

The canonical model for activity feeds is **ActivityStreams** (W3C AS2.0):
`actor` + `verb`/`type` + `object` + optional `target` + `context`. "Jack added
Hawaii to his places-to-visit" = actor:jack, verb:add, object:Hawaii,
target:places. Our row *is* a flattened AS activity; we just don't carry the
`object` type explicitly.

The canonical *rendering* pattern is **polymorphic dispatch on the object type**
(thoughtbot, "Using Polymorphism to Make a Better Activity Feed"): replace the
big `if subject_type == 'X'` with one small, self-contained partial per
object/subject type, selected by naming convention. Stated benefits: new types =
new partial, **no change to dispatch logic**; each partial has no conditionals;
copy/markup stay local to the type. Stream/GetStream's feed designs follow the
same AS2.0 actor-verb-object decomposition.

The lesson for us: **resolve the object/subject once, then render polymorphically
off its kind.** Don't switch on `verb` in four presenters.

Sources:
- [W3C Activity Streams 2.0](https://www.w3.org/TR/activitystreams-core/)
- [Activity Streams (format) — Wikipedia](https://en.wikipedia.org/wiki/Activity_Streams_(format))
- [thoughtbot — Using Polymorphism to Make a Better Activity Feed in Rails](https://thoughtbot.com/blog/using-polymorphism-to-make-a-better-activity-feed-in-rails)
- [GetStream — Designing a News Feed / Activity Stream to the W3C spec](https://getstream.io/blog/designing-activity-stream-newsfeed-w3c-spec/)

## Proposed abstraction — one resolver, polymorphic presenters

Collapse the four parallel derivers into **one** canonical resolver that returns
a discriminated **`FeedItem`** view-model. Everything else (tile, breadcrumb,
copy, deep links, gating) is a pure projection of that model. No consumer
switches on `verb` again.

```ts
// The subject: WHAT the activity is about. One arm per renderable noun.
type Subject =
  | { kind: "video";     videoId; techniqueId; context: SurfaceRef; tsSeconds?: number }
  | { kind: "technique"; techniqueId; context: SurfaceRef }      // library OR syllabus(sst)
  | { kind: "thread";    threadId; anchor: ThreadAnchor }        // profile/camp (no noun)
  | { kind: "syllabus";  syllabusId; studentId }                 // assign/graduate (header-only)
  | { kind: "camp" | "competition" | "match"; ... }
  | { kind: "none" };                                            // pure header-only

interface FeedItem {
  actor: PersonRef;
  targetStudent?: PersonRef;
  verb: string;                 // kept for copy + icon only
  subject: Subject;
  caption: string;              // ONE place verb→text lives
  path: Crumb[];                // actor → surface → noun, each a typed deep link
  embed: "video" | "technique" | "thread" | "none";   // == subject.kind, drives the tile
  gated: boolean;               // camp/competition/match epic gate
  unread: boolean;
}

function resolveFeedItem(row: ActivityRow): FeedItem { /* the ONLY verb/anchor switch */ }
```

Renderers become dumb:

```tsx
function ActivityTile({ item }: { item: FeedItem }) {
  switch (item.embed) {                 // dispatch on subject kind, not verb
    case "video":     return <VideoTile subject={item.subject} />;
    case "technique": return <TechniqueTile subject={item.subject} />;
    case "thread":    return <ThreadTile subject={item.subject} />;
    case "none":      return null;
  }
}
```

- `tile-kind.ts`, the verb `Set`s, and `rowToViewContext` collapse into
  `resolveFeedItem` + the `Subject` union. `activity-line.ts` and
  `activity-caption.ts` merge into one caption map keyed by verb (the only
  remaining verb switch, and it's *only* text). Deep links come from
  `Subject`/`Crumb`, computed once.
- Adding a noun (e.g. `video`) = one `Subject` arm + one presenter. The drift
  class becomes structurally impossible: tile-kind can't promise a tile the
  resolver didn't produce, because they are the same function.

### Backend: send the object type (small, high-leverage)

Stop discarding what the backend knows. Add **`object_kind`** (the
`EntityKind` `Verb::primary_entity()` already yields, lower-cased) to the
`ActivityRow` JSON. The resolver keys on `object_kind` + `context_kind` instead
of sniffing which FK column is non-null. This removes the most error-prone part
(column-presence inference) and makes the wire self-describing — closer to AS2.0.

This is additive (one column in the three `feed`/dashboard SELECT mappings; it's
a pure function of `verb`, so it can even be computed in Rust without a join).
Frontend `Subject` resolution then reads `object_kind` first, columns second.

### What does NOT change

- The pull-model read relevance, keyset pagination, and server-side thread
  coalescing (`thread_ranked` CTE) are orthogonal and stay.
- The wide row stays on disk; this is about the **wire view-model + client
  resolution**, not a schema migration.

## The feature, expressed in the new model

With `resolveFeedItem` in place, deep-surfacing is a localized change:

1. **`Subject` gains `video`.** When `object_kind === "video"` (video_watched,
   video_added) OR a `thread` whose anchor is `video`/`video_timestamp`, resolve
   to `{ kind: "video", videoId, techniqueId, context, tsSeconds? }`.
2. **`VideoTile`** (new presenter): fetch the `Video` (via
   `useTechniqueVideos(techniqueId)`, find `videoId`; add a `useVideo(videoId)`
   if cleaner) and render `VideoReviewPanel` with `surface` derived from context
   (library vs student). For a thread subject, the panel already shows the
   timestamped moments/thread; pass `tsSeconds` to focus it.
3. **Breadcrumb = `item.path`.** Build `actor → surface(root) → technique` (and,
   for video, the technique still names the context; the video is the embed, not
   a crumb). Each `Crumb` carries `{ label, href }`:
   - actor → `/student/:id` (coach only)
   - surface → `viewContextSurfaceHref` (library / syllabus root)
   - technique → `viewContextHref` (deep `?focus=` link to the technique)
   The header renders `path.map(Crumb)`; the deep-vs-root link question that
   caused image 11/12 disappears because root and noun are *distinct crumbs*.
4. **Technique threads (no video)** resolve to `{ kind: "technique" }` with the
   discussion shown (the `TechniqueTile` `defaultOpen` for comment-origin rows
   already added).
5. **Camp/competition** subjects get presenters when their surfaces ungate; for
   now they remain `embed: "none"` (header-only) but flow through the same path/
   gating, so nothing special-cases them.

## Incremental migration plan (no big-bang)

1. **Introduce `resolveFeedItem` + `Subject`** alongside the existing four
   modules; unit-test it against the current behavior (golden tests per verb ×
   anchor — this also documents the taxonomy).
2. **Re-point `ActivityTile` + `ActivityTileHeader`** at `FeedItem`. Delete
   `tile-kind.ts`; fold `rowToViewContext`/`activitySurface` into the resolver
   (keep thin `viewContextHref`/`viewContextSurfaceHref` URL builders).
3. **Merge `activity-line` + `activity-caption`** into one caption source; the
   classic one-line `ActivityFeedList` consumes `FeedItem.caption` + `path` too.
4. **Add `object_kind` to the wire** and switch the resolver to it (columns
   become a fallback, then removed).
5. **Add `VideoTile` + the `video` Subject arm** (the actual feature). Ship.

Steps 1–3 are pure refactor (behavior-preserving, test-locked). 4 is additive.
5 is the feature. Each step is independently shippable and reviewable.

## Decisions / open questions

- **D1 — backend `object_kind` now or defer?** Recommend now (step 4); it's
  small and removes the column-sniffing class permanently. Could defer and do a
  pure-frontend resolver first if we want zero backend change this PR.
- **D2 — `VideoReviewPanel` weight inline.** Chosen (full panel). Lite embeds
  keep N players cheap (poster until play). If feed density suffers, a `compact`
  prop on the panel (hide scrubber pins until play) is the escape hatch — not a
  re-architecture.
- **D3 — fetch a video by id.** Reuse `useTechniqueVideos` + find, or add a
  thin `useVideo(videoId)`. Lean to the latter for video subjects that may not
  carry a technique (none today, but cleaner).
- **D4 — scope of this PR.** Option (a) refactor + feature together (steps 1–5),
  or (b) land the refactor (1–4) first, feature (5) in a follow-up. The refactor
  is the thing that stops the "redesign every week" loop; recommend at least 1–3
  before 5 so the feature lands on solid ground.

## Why this is the right call

We have rebuilt the same tiles four times because the *taxonomy* has no home —
it lives smeared across four files that must agree by hand. The established
answer (AS2.0 object model + polymorphic-by-object rendering) says: name the
object once, render by its kind. Doing that turns the next ten feed tweaks
(camp tiles, competition tiles, match tiles, "X and N others", richer video)
from "edit four switches and hope they agree" into "add a `Subject` arm and a
presenter." That is the abstraction working *for* us.
