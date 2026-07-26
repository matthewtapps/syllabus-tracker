# Camps as full-fat components: handoff brief

**Status:** brief only. Not a spec, not decided. Written 2026-07-26 to hand off to
a spec + prototype session.

**Supersedes in intent:** the second amendment in
[`feed-tile-interaction-spec.md`](./feed-tile-interaction-spec.md), which solved
the camp detail regression with per-item routes. The routes still stand (see
"What exists" below), but they are no longer the answer to "how do I read a camp".

## The model

A camp is a **Facebook group**, not a slice of an activity feed.

- The camp view shows its content as **full-fat, directly interactive
  components**. You reply, play, and act on a technique without leaving the camp.
- Elsewhere (dashboard, activity feed) the same content keeps its **activity feed
  properties**: a teaser tile that navigates to the full camp view of that
  component.
- The camp orders its components **chronologically by last update**, so a
  component bumps when it is touched.

The framing that changed: the camp feed is not a projection of content living
elsewhere, and it is also not an event log rendered as tiles. It is **the
content**, arranged by recency.

## The novel problem

Every component type normally appears **among siblings, inside a parent**:

| Component | Its usual home |
| --- | --- |
| Technique | a technique list (library, syllabus, pinned), as an accordion row |
| Discussion | a `DiscussionBlock` under a technique, one of several threads |
| Video | a video list under a technique |

In a camp each one stands **alone as its own tile**, with no list to belong to and
no parent row to expand out of. Two techniques added to a camp are two separate
full-fat tiles, not two rows of one list.

So each component needs a standalone presentation that reads as a deliberate
card, not as a list row that lost its list. This is the main thing to design and
prototype.

## What exists today, and what happens to it

Nothing needs reverting. The pivot changes how the camp view **renders** tiles;
the data layer, routes, verb and caches all survive and most get more useful.

| Commit | Fate under the new model |
| --- | --- |
| `ca7c62d` blank teaser body fallback | Keep. Orthogonal. |
| `d98910f` `camp_technique_added` verb | Keep, and more load-bearing: it records a technique component's existence separately from its discussion. See the regression below. |
| `f4b205b` camp item routes | Keep, role changes. No longer the primary way to read a camp technique; becomes the permalink / share target and the likely destination for a dashboard teaser. Open question 2. |
| `8d21503` `GET /camps/:id/techniques`, `GET /threads/:id` | Keep. Both are more valuable now; full-fat technique tiles need the camp technique list. |
| `99269d5` camp-surface hydration | Keep. |
| `d48b1a0` optimistic write to both thread caches | Keep. |

What does become dead: the **teaser rendering path on the camp page**
(`TechniqueRowTeaser` + `TeaserRegion` in camp context). Both stay alive for the
dashboard and activity feed, which keep teaser-navigates.

`TechniqueRowDetail` (added in `f4b205b`) is probably the seed of the full-fat
technique tile: it is already the row's blocks with no row chrome.

## Known regression to resolve (introduced by `d98910f`)

An attached technique that then receives a comment produces **two** camp feed
rows, and both render as a technique tile, so the technique appears twice.

Verified by probe on 2026-07-26:

```
row verb=thread_comment_posted technique_id=Some(1)
row verb=camp_technique_added  technique_id=Some(1)
total technique rows = 2
```

Cause: the coalescing CTE in `db/activity_read.rs` partitions by `thread_id` over
`verb = 'thread_comment_posted'` only, and the predicate is
`act.verb != 'thread_comment_posted' OR tr.rn = 1`. The attach row now carries a
different verb, so it bypasses the collapse. Before `d98910f` the attach was
itself a `thread_comment_posted` row and the two collapsed into one.

Two ways out:

1. **Point fix, inside the current model.** Widen the CTE to
   `verb IN ('thread_comment_posted','camp_technique_added')`, keep `rn = 1`, and
   make `comment_count` a `SUM(CASE WHEN verb = 'thread_comment_posted' ...)` so
   the attach row is not counted as a comment. About 15 lines. Side effect, which
   is desirable: a technique tile then sorts by its newest comment, which is
   already bump-on-activity.
2. **Fold into the component read** below, which has to dedupe to one row per
   component anyway.

Option 1 is throwaway if the component read lands soon, but it keeps staging
honest for device testing in the meantime.

## Technical implications worth pricing before designing

- **Ordering and dedupe need a component-oriented read.** Today the camp view
  reads an activity stream (`feed(..., camp_id)`), which is events, and one
  component can produce several. The new model wants **one row per component,
  ordered by last touch**. Note the existing CTE is already half of this: thread
  rows collapse to the newest per thread, so a discussion tile already sorts by
  last update. Techniques are what need merging.
- **Full-fat by default reopens the N x K query problem.** `TechniqueRow` mounts
  its blocks lazily behind the accordion precisely to avoid keeping N x K queries
  alive (see the `useDelayedFalse` comment in `technique-row.tsx`). Twelve
  expanded technique tiles, each fetching its own threads and videos, is a lot of
  requests. This probably argues for a single paginated
  `GET /api/camps/:id/components` returning hydrated components, and is likely the
  core backend work of this pivot.
- **Bounded height.** A camp with a dozen full techniques is unusable if nothing
  is clamped. Facebook's own answer is full-but-bounded: clamped body with
  "See more", latest two comments with "View all N".

## Open questions for the spec session

1. **What is "full-fat" exactly, per component type?** Fully expanded, or
   full-but-bounded with progressive disclosure of overflow (clamped description,
   video strip, latest two replies)? Interaction should be inline either way; the
   question is only what is visible before you ask for more. Recommendation:
   full-but-bounded.
2. **Where does a dashboard / activity teaser land?** The camp page scrolled and
   anchored to the component (`/camps/:id?focus=...`), or the per-component route
   from `f4b205b`? The new model says the camp view *is* the full view, which
   favours the anchored camp page and demotes the item routes to permalinks.
3. **Is the component set closed at technique, discussion, video?** Anything else
   postable into a camp?
4. **Do camp-level events still appear as items** (camp created, archived,
   technique added), or does the camp view show only components, with events
   living in the activity feed? Recommendation: components only.
5. **Which affordances does a standalone camp technique get?** Camp block
   visibility today is description / tags / videos / discussion, plus
   edit-definition for a coach. Does a camp technique also get status and
   attempts, and does it get camp-specific chrome (remove from camp, pin)?
6. **Where does a new component land**, given ordering is by last update? Top,
   presumably, but confirm against the composer's position.
7. **What bumps a component?** Any comment, or also an edit, a video add, a
   status change?

## Suggested shape of the session

1. Prototype the three standalone tiles first, throwaway, before speccing. The
   standalone-presentation problem is visual and will not resolve on paper.
   `/prototype` exists for this.
2. Decide question 1 on device, since it is a density judgement.
3. Then spec the component read endpoint, which the rest depends on.
4. Keep the existing regression gate green: `technique-row.test.tsx`,
   `student-syllabus-row.test.tsx`, `discussion-block.test.tsx`,
   `camp-item-routes.test.tsx`.

## State at handoff

- Branch `feat/technique-row-wrappers`, PR #118, head `d48b1a0`, pushed.
- Deployed to staging at `staging-d48b1a0`, DB forked from prod earlier the same
  day. `just verify` green: 365 backend, 399 frontend.
- The duplicate technique tile above is live on staging and unfixed.
