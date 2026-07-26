# Handoff: camps as full-fat components

**Status:** handoff brief. The model and five decisions are settled; the design is
not. Written 2026-07-26, updated 2026-07-27.

**Start here:** read this file, then
[`feed-tile-interaction-spec.md`](./feed-tile-interaction-spec.md) (both
amendments at the top) and
[`../superpowers/specs/2026-06-21-camps-feed-redesign-design.md`](../superpowers/specs/2026-06-21-camps-feed-redesign-design.md)
(#101, which made a camp page an activity feed). Then prototype before speccing:
see "Suggested order" below.

**Do not** start by reading the whole camp page. The work is a rewrite of how its
tiles render, not a patch to them.

## The model

A camp is a **Facebook group**, not a slice of an activity feed.

- The camp view shows its content as **full-fat, directly interactive
  components**. You reply, play, and act on a technique without leaving the camp.
- Elsewhere (dashboard, activity feed) the same content keeps its **activity feed
  properties**: a teaser tile that navigates to the full camp view of that
  component.
- The camp orders its components **chronologically by last update**, so a
  component bumps when it is touched.

What changed in the framing: the camp feed is not a projection of content living
elsewhere, and it is also not an event log rendered as tiles. It is **the
content**, arranged by recency.

## The novel problem to solve

Every component type normally appears **among siblings, inside a parent**:

| Component | Its usual home |
| --- | --- |
| Technique | a technique list (library, syllabus, pinned), as an accordion row |
| Discussion | a `DiscussionBlock` under a technique, one of several threads |
| Video | a video list under a technique |

In a camp each one stands **alone as its own tile**, with no list to belong to and
no parent row to expand out of. Two techniques added to a camp are two separate
full-fat tiles, not two rows of one list.

Each component therefore needs a standalone presentation that reads as a
deliberate card rather than a list row that lost its list. This is the main thing
to design, and it is visual: prototype it.

## Decided

1. **A dashboard / activity teaser lands anchored on the camp page**, not on a
   per-component route. The item routes added in `f4b205b` are demoted to
   permalinks.
2. **Every kind of content that can be a base component in a camp gets its own
   full-fat camp component.** The set is not assumed; see the audit.
3. **Camp created and archived are activity-feed events only.** They do not appear
   as items on the camp itself.
4. **A standalone camp technique keeps today's camp block visibility**
   (description / tags / videos / discussion, plus edit-definition for a coach).
   No status, no attempts.
5. **Any activity on a component is an update for ordering.** Not comments only.

## Open questions

1. **What is "full-fat" exactly, per component type?** Fully expanded, or
   full-but-bounded with progressive disclosure (clamped description, video strip,
   latest two replies)? Interaction is inline either way; the question is only what
   is visible before you ask for more. Recommendation: full-but-bounded. Decide on
   device, it is a density judgement.
2. **Is a note-with-video one component or two?** See the taxonomy question below,
   and whether `VideoParent::Camp` survives.
3. **Where does a new component land**, given ordering is by last update? Top,
   presumably, but confirm against the composer's position.
4. **Does an update by the viewer bump a component?** "Any activity" ordering
   means your own reply re-sorts the page under you.

## Audit: what can be a base component in a camp

Established by reading the code on 2026-07-26.

| Kind | How it is created | Rendered today? |
| --- | --- | --- |
| **Technique** | "Attach technique" on the camp: pick existing, or create global / camp-scoped. Posts a `camp_technique` thread, which IS the membership. | Yes, as `TechniqueTile`. |
| **Discussion (note)** | `CampComposer`, text with an optional attached video. Posts a `camp` thread. | Yes, as `ThreadTile`. |
| **Camp-owned video** | `POST /api/camps/:id/videos/upload`, giving `VideoParent::Camp`. | **No. Orphaned.** |

The camp-owned video kind is fully alive in the backend
(`list_videos_for_camp`, `GET /api/camps/:id/videos`, the camp visibility override
route) and has a live `setCampVideoVisibility` frontend mutation, but:

- `CampVideoList` (`components/videos/camp-video-list.tsx`) has **zero call sites**
  since #101 removed it from the page.
- A camp-owned video has `technique_id = NULL`, so `VideoTile` returns null
  (`video-tile.tsx:71`) and its `video_added` activity row renders as a bare header
  line with no tile.

So a directly uploaded camp video is invisible in the product today. It is the
clearest example of a missing base component.

**Sub-components**, which belong to a parent component rather than standing alone:

- a video attached to a camp note's root post (reparented to `VideoParent::Thread`,
  or *referenced*, in which case it keeps its original parent and the same clip
  also lives in the library)
- a video attached to a comment (a video reply, `thread_comments.video_id`)
- timestamped comments on a video (`video_ts_seconds`)
- the videos in a camp technique's `VideosBlock`

### The taxonomy question

A note carrying a video is one post, Facebook-style, not a note plus a video
component. If that holds, a **camp-owned video is the odd one out**: the same
intent ("put this clip in the camp") produces two different shapes depending on
which button was pressed.

Worth weighing as a simplification: make every camp video arrive as a discussion
post carrying a video, and retire `VideoParent::Camp` as a user-facing kind. That
collapses three base kinds to two and deletes the orphan instead of building a
surface for it. Needs a call on existing prod rows.

## Defects the new work must absorb

1. **A technique appears twice once discussed.** `d98910f` gave the attach its own
   verb, and the coalescing CTE in `db/activity_read.rs` partitions only over
   `verb = 'thread_comment_posted'` with the predicate
   `act.verb != 'thread_comment_posted' OR tr.rn = 1`, so the attach row bypasses
   the collapse. Verified by probe:

   ```
   row verb=thread_comment_posted technique_id=Some(1)
   row verb=camp_technique_added  technique_id=Some(1)
   total technique rows = 2
   ```

   **Deliberately not fixed**, because a component-oriented read has to dedupe to
   one row per component anyway. If you ever need the point fix instead: widen the
   CTE to `verb IN ('thread_comment_posted','camp_technique_added')`, keep
   `rn = 1`, and make `comment_count` a
   `SUM(CASE WHEN verb = 'thread_comment_posted' THEN 1 ELSE 0 END)` so the attach
   is not counted as a comment. Its side effect is desirable: a technique tile then
   sorts by its newest comment, which is already the ordering this model wants.

2. **Camp-owned videos have no surface**, per the audit. Predates this branch.

## Technical implications to price before designing

- **Ordering and dedupe need a component-oriented read.** Today the camp view
  reads an activity stream (`feed(pool, viewer, role, before, limit, camp_id)` in
  `db/activity_read.rs`), which returns *events*, and one component can produce
  several. The new model wants **one row per component, ordered by last touch**.
  The existing CTE is already half of it: thread rows collapse to the newest per
  thread, so a discussion tile already sorts by last update. Techniques are what
  need merging.
- **Full-fat by default reopens the N x K query problem.** `TechniqueRow` mounts
  its blocks lazily behind the accordion precisely to avoid keeping N x K queries
  alive (see the `useDelayedFalse` comment in `technique-row.tsx`). Twelve expanded
  technique tiles, each fetching its own threads and videos, is a lot of requests.
  This probably argues for a single paginated
  `GET /api/camps/:id/components` returning hydrated components. **This endpoint is
  likely the core backend work of the pivot.**
- **Bounded height.** A camp with a dozen full techniques is unusable if nothing is
  clamped. Facebook's answer is full-but-bounded: clamped body with "See more",
  latest two comments with "View all N".

## Code map

Frontend, `frontend/src/`:

| Path | Role |
| --- | --- |
| `app/camps/[id]/page.tsx` | The camp page. `CampFeedBody` (the feed), `CampComposer` wiring, `attachTechniqueAsThread` (posts the `camp_technique` thread with an empty body), `onJump` + `useThreadDeepLink` for `?thread=` scroll, search sheet. **The rewrite lands here.** |
| `app/camps/[id]/techniques/[techniqueId]/page.tsx`, `.../threads/[threadId]/page.tsx` | The demoted item routes. Keep as permalinks. |
| `components/activity-feed/activity-tile.tsx` | Dispatches on `subject.kind`. Where a camp-aware branch would go, or where a camp renderer replaces it. |
| `components/activity-feed/{technique,thread,video}-tile.tsx` | The teaser tiles. Stay as-is for dashboard / activity feed. |
| `components/activity-feed/{teaser-line,tile-shell}.tsx` | Teaser anatomy and the shared card shell. |
| `components/activity-feed/activity-tile-feed.tsx` | The feed list, unread divider, `getRowDataAttrs` hook used by the camp jump. |
| `components/technique-row/technique-row-detail.tsx` | Provider + `ExpandedPanel`, no row chrome. **Probable seed of the full-fat technique tile.** |
| `components/technique-row/{expanded-panel,block-visibility}.tsx` | Which blocks render per (surface, role). The `camp` row is decision 4. |
| `components/technique-row/{discussion-block,videos-block}.tsx` | `DiscussionBlock` already scopes to `camp_technique` + `campId`; `VideosBlock` handles `scrollToVideoId` / `resumeSeconds`. |
| `components/threads/thread-view.tsx` | Root + replies + inline composer. Already standalone-ready; seed of the discussion component. |
| `components/videos/review/video-review-panel.tsx` | Player + timestamped comments + composer; `feedPresentation` is the teaser branch. Seed of a video component. |
| `components/videos/camp-video-list.tsx` | The orphan. Zero call sites. |
| `lib/feed-item.ts` | `resolveFeedItem`, the one place a row's meaning is decided. Note the `camp_technique` branch. |
| `lib/view-context.ts` | `viewContextHref`, `feedTileHref`, `rowToViewContext`. Camp branch now returns item routes; decision 1 means it should return the anchored camp page. |
| `lib/{queries,mutations,query-keys,api}.ts` | `useCampTechniques`, `useThread`, `useThreadsForAnchor`, `useCampVideos`, and the thread cache invalidations. |

Backend, `crates/syllabus-tracker/src/`:

| Path | Role |
| --- | --- |
| `db/activity_read.rs` | `feed()` and the coalescing CTE. The component read either lives beside this or replaces its camp path. |
| `db/camps.rs` | Camp CRUD, `create_camp_technique_new`, camp search. Note the module comment: membership is a `camp_technique` thread, there is no `camp_techniques` table. |
| `db/techniques.rs` | `list_techniques_scoped` (one query, `None` = library, `Some(camp)` = camp), behind `list_library_techniques` and `list_camp_techniques`. |
| `db/threads.rs` | `create_thread` (verb choice per anchor kind), `get_thread`, `list_threads_for_anchor`, visibility. |
| `db/activity.rs` | The `Verb` registry, including `CampTechniqueAdded`, its coalescing and primary-entity rules. |
| `db/videos.rs` | `VideoParent`, `list_videos_for_camp`. |
| `camps/routes.rs`, `threads/routes.rs` | `GET /camps/:id/techniques`, `GET /camps/:id/videos`, `GET /camps/:id/feed`, `GET /threads/:id`. |

## Suggested order

1. **Prototype the standalone tiles, throwaway.** Technique, discussion, and
   whatever the video answer turns out to be. The standalone-presentation problem
   will not resolve on paper. The `/prototype` skill exists for this; do not merge
   the prototype (#102's lived on its own branch).
2. **Decide open question 1 on device**, then 2.
3. **Spec the component read**, since everything else depends on its shape. Include
   dedupe (one row per component), ordering (last touch), pagination, and how much
   nested content it hydrates.
4. **Build the camp view against it**, replacing the teaser render path on the camp
   page only.
5. **Point `feedTileHref`'s camp branch at the anchored camp page** per decision 1,
   keeping the item routes as permalinks.

## Test gates

Must stay green; they cover the surfaces this refactors under but does not
redesign:

```
frontend: components/technique-row/{technique-row,student-syllabus-row,discussion-block,technique-row-teaser}.test.tsx
frontend: app/camps/[id]/{camp-detail,page,camp-item-routes}.test.tsx
frontend: components/activity-feed/{activity-tile,activity-tile-header,camp-technique-tile}.test.tsx
frontend: lib/{view-context,feed-item,activity-line}.unit.test.ts
backend:  test::camps::*, test::threads::*
```

Commands:

```
just verify                      # backend lint + test, frontend lint + build; the gate
cd frontend && pnpm vitest run   # browser tests, Chromium; NOT run by just verify
```

`camp-item-routes.test.tsx` and `camp-technique-tile.test.tsx` stub `window.fetch`
and will need their doubles updated for any new endpoint;
`/api/threads/:id` returns a bare thread while `/api/threads?anchor…` returns a
list, so match them apart. `renderWithProviders` sets `gcTime: 0`, which collects
seeded-but-unobserved cache entries: build a local `QueryClient` with
`gcTime: Infinity` for cache-level tests (see `lib/use-create-comment.test.tsx`).

## Working agreements

- Commits: `type(scope): Capitalized imperative`, at most ~3 sparse body bullets,
  never prose paragraphs, never a co-author trailer.
- No em-dashes in code comments, UI copy, or chat.
- Hooks block `git push`, `git branch -D` and `git stash`. Hand those to the user.
  Never stash: the stash stack holds their paused WIP.
- Run `just verify` before committing.
- Any commit touching a `sqlx::query!` needs the regenerated cache:
  `nix develop .#ci --command just sqlx-prepare`. Never bare `cargo sqlx prepare`
  against the dev DB, and note the dev DB may lag the branch schema, so build with
  `SQLX_OFFLINE=true`.

## State at handoff

- Branch `feat/technique-row-wrappers`, PR #118, base `main`.
- Head `53a04f4`. Everything through `d48b1a0` is pushed; the two docs commits
  (`dfddd81`, `53a04f4`) were local at the time of writing.
- Staging runs `staging-d48b1a0`, DB forked from prod on 2026-07-26. Not worth
  device-testing: the camp view is being replaced, and the duplicate technique tile
  above is live there.
- `just verify` green at head: 365 backend, 399 frontend.

### What shipped on this branch, and its fate

| Commit | Fate under the new model |
| --- | --- |
| `ca7c62d` blank teaser body fallback | Keep. Orthogonal. |
| `d98910f` `camp_technique_added` verb | Keep, more load-bearing: it records a technique component's existence separately from its discussion. Source of defect 1. |
| `f4b205b` camp item routes, breadcrumbs, `TechniqueRowDetail` | Keep, demoted to permalinks per decision 1. `TechniqueRowDetail` is reusable. |
| `8d21503` `GET /camps/:id/techniques`, `GET /threads/:id` | Keep. Both more valuable now. |
| `99269d5` camp-surface hydration | Keep. Camp-scoped techniques resolve everywhere a global one does. |
| `d48b1a0` optimistic write to both thread caches | Keep. |

Nothing needs reverting. What dies is narrow: the **teaser render path on the camp
page** (`TechniqueRowTeaser` + `TeaserRegion` in camp context). Both stay alive for
the dashboard and activity feed, which keep teaser-navigates.
