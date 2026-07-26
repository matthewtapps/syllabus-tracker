# Feed tile interaction spec

**Status:** built, then partly reversed. See the amendment below before reading §5.

## Amendment, 2026-07-26: the detail sheet is withdrawn

Slices 1-7 shipped as specced and were reviewed on device. The teaser tiles hold
up and stay. **The full-screen detail sheet does not, and has been removed.** A
tile now navigates to its subject in the surface that owns it, which is the same
destination the row's own breadcrumb links to.

What the sheet got wrong, in order of weight:

1. **It strips context.** On a route the surface *is* the context: which
   syllabus, whose library, which technique. A sheet has one `text-sm` title to
   carry all of it, and for a thread with no video or technique noun that title
   was literally `Discussion`. There is no title string that fixes this; the
   page chrome is the context.
2. **The scroll premise was wrong.** §3 and §5.1 justify the sheet with "scroll
   position is preserved because nothing navigates", and #104 rejected
   tap-to-navigate on the same grounds. But `ScrollManager` already restores
   pixel-exact scroll on POP. Back from a pushed route returns you to the feed
   where you left it, which is the thing the sheet existed to protect.
3. **It duplicated a destination that already existed.** `viewContextHref` has
   built deep links to exactly these targets all along, and the breadcrumb two
   lines above each tile already used them. The sheet was a second, weaker
   rendering of a page we already had.

Consequently withdrawn: `FeedDetailSheet` (§5.1), the video player handoff and
its accepted duplicate-watch cost (§5.2, §14), the pinned composer and
`ThreadView composer` (§5.3), `TechniqueRowDetail` (§5.4), and `pause()` on the
controller (§8), which existed only to serve the handoff.

Kept in a different form: the player handoff. Navigating away from a clip you
were watching restarts it, which is worse than the sheet was. A video teaser
link now carries `?t=<seconds>` and the destination opens that clip in its
player and seeks there once. One player, one watch event, and a shareable URL,
which is what the sheet's two-player handoff was approximating. `?video=` on its
own is unchanged and still only scrolls to the row, so the breadcrumb path
behaves as before.

Retained and still correct: the teaser anatomy (§4), the copy (§9), the
accessibility floor (§10) with teaser regions now links rather than buttons,
sheet motion (§7, which still governs every other sheet in the app), and the
`useHistoryDismiss` overlay stack (§5.5), which remains a correctness fix even
though the nesting that motivated it is gone.

## Amendment, 2026-07-26 (second): a camp owns its content, so its items get routes

The rule above ("a tile navigates to its subject in the surface that owns it")
assumes a feed is a projection of content living elsewhere. For a camp that is
false: #101 made the camp page BE an `ActivityTileFeed`, and the camp is the
surface that owns everything in it. So every camp tile linked to `/camps/:id`,
which on a camp page is the page you are already reading. A camp technique could
not be expanded, a thread could not be read in full, and a video's whole comment
list was unreachable.

Fixed by making camp items addressable under the camp rather than by reviving the
sheet:

| Route | Body |
| --- | --- |
| `/camps/:campId/techniques/:techniqueId` | `TechniqueRowDetail` in camp `RowContext` |
| `/camps/:campId/threads/:threadId` | `ThreadView` with its inline composer |

- `viewContextHref` for a camp context returns the technique route when the row
  names a technique, carrying `?video=` when it names a video too, because a camp
  technique's clip lives in that technique's video list. A camp-owned video with
  no technique keeps `/camps/:id?video=`, which scrolls to its tile in the feed
  where it already plays.
- `TechniqueRowDetail` (§5.4, withdrawn as a sheet body) is reinstated as a
  **page** body. The sheet's defect was that it could not carry page context; a
  route carries it by definition, and `AppBreadcrumbs` now renders the full
  Students > Sam > Camps > X-guard > Scissor Sweep chain.
- Routes are keyed by anchor, not by activity row id, which keeps content
  identity out of the activity table (it records events, not content).
- A third route for camp videos was considered and dropped: camp videos hang off
  a thread or a technique's video list, both already covered, and
  `list_videos_for_camp` only returns camp-parented videos.

Two endpoints came with it:

| Endpoint | Why |
| --- | --- |
| `GET /api/camps/:id/techniques` | The library list filters to `is_global = 1`, so a camp-**scoped** technique (created inside the camp) was absent from it and no camp surface could hydrate one. Reads membership from `camp_technique` threads. Same one query as the library list, with the scope as its only parameter. |
| `GET /api/threads/:id` | The thread page addresses one thread, so it should not list a whole anchor and search it. Applies `get_thread`'s visibility rule, so an unreadable thread 404s. |

The camp feed tile, the camp technique page and its breadcrumb all read
`useCampTechniques`, so they share one cache entry and a camp-scoped technique
now renders everywhere a global one does.

Separately, attaching a technique to a camp posts a `camp_technique` thread with
an empty body, which emitted `thread_comment_posted` and captioned as
"Commented". #101 deleted the `CampTechniqueAdded` verb as dead while leaving the
frontend cases for it in place; the verb is restored and the attach now reads
"Added". Replies on that thread still emit `thread_comment_posted`.

Everything below is the original spec as written and built. §5 is superseded.

---

**Status (original):** locked, ready to build. Nothing in here is an open question.

**Source map:** wayfinder [#102 Feed tile UX uplift: interaction spec](https://github.com/matthewtapps/syllabus-tracker/issues/102).
Decisions this doc assembles:

| Ticket | Settled |
| --- | --- |
| [#103](https://github.com/matthewtapps/syllabus-tracker/issues/103) | Research: no mature feed collapses visible content on expand; disclosure is additive or a modal layer. Asset: [`docs/research/social-feed-tile-interaction-patterns.md`](../research/social-feed-tile-interaction-patterns.md) |
| [#104](https://github.com/matthewtapps/syllabus-tracker/issues/104) | Model B uniformly: fixed-budget teaser tiles, all depth in a full-screen Sheet. No thresholds, no tap-to-navigate |
| [#105](https://github.com/matthewtapps/syllabus-tracker/issues/105) | Model confirmed on-device; the `rich` teaser anatomy wins (avatars, clamped bodies, up to two preview comments) |
| [#107](https://github.com/matthewtapps/syllabus-tracker/issues/107) | Motion: stock Sheet geometry, M3 emphasized easing, press dim only, targeted Reduce Motion cross-fade |
| [#108](https://github.com/matthewtapps/syllabus-tracker/issues/108) | Row API: `TechniqueRow` / `TechniqueRowTeaser` / `TechniqueRowDetail` over one private provider |
| [#106](https://github.com/matthewtapps/syllabus-tracker/issues/106) | This doc. Items marked **Call (#106)** were decided here |

Prototype (throwaway, do not merge): branch `prototype/feed-tile-teaser-sheet`, commit `adae049`.

---

## 1. Scope

**In:** the composition of activity feed tiles at `/dashboard` (`ActivityTileFeed`), the detail surface each tile opens, the motion between them, and the component API changes those force.

**Out:**

- Redesigning row or expand UX on library, syllabus, pinned or camp surfaces. They keep accordion expand-in-place, untouched.
- Feed header, breadcrumb, caption, verb icons, unread divider, pagination. Unchanged.
- Camps tile richness. Gated camp rows stay header-only; the camps redesign owns them.
- @-mentions (threads epic Phase B).

## 2. Vocabulary

- **Teaser tile:** the in-feed body under a feed entry's header. Fixed budget, never mutates on interaction.
- **Teaser line:** one previewed comment inside a teaser tile: avatar, author, relative time, clamped body.
- **Detail sheet:** the full-screen bottom Sheet a teaser opens. The only place depth lives.
- **Focus thread:** the thread the feed event is *about* (`resolveFeedItem` gives it as `subject.thread` / `subject.focusThreadId`). Absent on watch/add/status events.
- **Feed player:** the inline player in a video teaser tile.
- **Sheet player:** the separate player instance inside a video detail sheet.

## 3. The model

One gesture, one surface. A teaser tile shows a fixed budget of content and is one tap target. The tap opens a full-screen bottom sheet holding everything: the full conversation, the composer, the expanded technique panel. Back closes the sheet. The feed underneath never expands, collapses, re-orders or hides anything, and scroll position is preserved because nothing navigates.

## 4. Feed anatomy

Shared shell for every teaser tile (unchanged from today's tiles):

```
mx-3 mb-3 overflow-hidden rounded-md border border-border bg-card
```

### 4.1 Video tile

```
┌────────────────────────────────┐
│ [ feed player, full-bleed ]    │  <- not part of the tap target
├────────────────────────────────┤
│ ◯ Coach Lee  2h                │  ┐
│   1:24 keep the elbow tight…   │  │ one tap target ->
│ ◯ Sam Khan  1h                 │  │ detail sheet
│   felt way better this round…   │  │
│   View all 7 comments          │  ┘
└────────────────────────────────┘
```

- Player is unchanged from today: `VideoReviewPanel`'s player subtree, with `MomentOverlay`, `ScrubberPins`, watch tracking, native fullscreen and rotate-to-fullscreen. Tapping the frame plays/pauses, so the player is **never** part of the sheet tap target.
- Teaser budget: **at most two** teaser lines.
  - Focus thread present: focus thread first, then the newest other thread if one exists.
  - No focus thread (a watch or an add row): the two newest threads. Video tiles preview comments even when the event is not a comment, per #105.
- `View all {n} comments` renders when `n` exceeds the number of teaser lines shown, where `n` counts roots plus replies across every thread on the video (`threads.reduce((n, t) => n + 1 + t.comments.length, 0)`).
- **Call (#106):** with zero threads, the teaser region still renders, as a single muted line `No comments yet`, and is still the tap target. It preserves the capability today's `Comment on video` toggle provides (the sheet holds the composer), and it is a state line, not the ghost composer row #104 rejected.

### 4.2 Thread tile

```
┌────────────────────────────────┐
│ 💬 on Armbar from guard        │  <- anchor chip, only when an anchor is named
├────────────────────────────────┤
│ ◯ Sam Khan  3h                 │  ┐
│   Tried this three times and…  │  │ one tap target
│   │ ◯ Coach Lee  2h            │  │
│   │   Shift your hips first…   │  │
│   View all 4 replies           │  ┘
└────────────────────────────────┘
```

- Root post body clamped to **3 lines** (`line-clamp-3`).
- Latest reply as a second teaser line when one exists, indented with `border-l-2 border-border pl-3`, body clamped to 2 lines.
- `View all {n} replies` renders when `thread.comments.length > 1`.
- Anchor chip text is `on {row.video_title ?? row.technique_name}`, omitted when neither resolves. The comment count moves out of the chip and into the view-all line (today's `CommentTile` put it in the chip).

### 4.3 Technique tile

```
┌────────────────────────────────┐
│ Armbar from guard          ›   │  <- TechniqueRowTeaser, tap target A
├────────────────────────────────┤
│ ◯ Coach Lee  2h                │  ┐ tap target B (same sheet,
│   Keep the elbow tight…        │  │ scrolled to this thread)
│   View all 3 comments          │  ┘
└────────────────────────────────┘
```

- Row body is `TechniqueRowTeaser` (#108): the provider plus `Header` inside a plain `<button>`, `ChevronRight`, no `aria-expanded`, no curation chrome. The row **never** expands in the feed.
- Comment teaser lines render only when the event carries a focus thread. One line for the thread root, then `View all {n} comments` when `n = 1 + thread.comments.length` exceeds 1.
- Both regions open the same sheet. Region B additionally passes `scrollToThreadId`.

### 4.4 Header-only tiles

Assignment, graduation and gated camp entries render no tile, exactly as today. They are outside this model.

### 4.5 Teaser line anatomy

```tsx
<div className="flex items-start gap-2">
  <StudentAvatar id={authorId} name={authorName} size="sm" />
  <div className="min-w-0 flex-1">
    <p className="text-sm">
      <span className="font-medium">{authorName}</span>
      <span className="ml-1.5 text-xs text-muted-foreground">{formatRelativeShort(createdAt)}</span>
    </p>
    <p className="line-clamp-2 text-sm text-foreground/90">
      {tsSeconds != null && (
        <span className="mr-1 font-medium text-primary">{formatTimestamp(tsSeconds)}</span>
      )}
      {body ?? <span className="italic text-muted-foreground">video reply</span>}
    </p>
  </div>
</div>
```

Rules:

- Timestamp chips for `video_timestamp` comments render **inline in the teaser text**, as a plain `<span>`, never a button. Teaser lines carry no interactive children (#104): the whole region is one button, and nesting a button inside a button is invalid.
- Body fallbacks when `body` is null: `video reply` on a reply teaser line, `video post` on a thread tile's root post. Both italic and muted. A null body with no attached video keeps `ThreadView`'s existing `thread removed` treatment inside the sheet.
- View-all line: `text-sm text-muted-foreground`, inside the same button, last child.

## 5. The detail sheet

### 5.1 Shell

New shared component, `frontend/src/components/activity-feed/feed-detail-sheet.tsx`:

```tsx
function FeedDetailSheet({
  open,
  onOpenChange,
  title,
  /** "scroll": the shell owns a scrolling body. "raw": the child owns its own
   *  layout and scrolling (the video sheet, which pins a composer). */
  body = "scroll",
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body?: "scroll" | "raw";
  children: React.ReactNode;
  footer?: React.ReactNode;
})
```

Geometry, on stock `SheetContent side="bottom"`:

```
className="inset-0 h-dvh w-full max-w-none gap-0 rounded-none border-0 p-0"
```

- Header: `border-b border-border px-4 py-3`, `SheetTitle` centered at `text-sm` with `pr-8` so it clears the stock close X at `top-4 right-4`.
- `body="scroll"` wraps children in `min-h-0 flex-1 overflow-y-auto`. `body="raw"` renders children into `min-h-0 flex-1` and the child owns scrolling.
- `footer`, when given: `border-t border-border p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]`.
- Back closes it: stock `Sheet` already wires `useHistoryDismiss` (`ui/sheet.tsx:27`), which is the modal back-close policy for full-screen view-like overlays.
- The composer is **not** autofocused on open (#104), so the keyboard does not cover the conversation you just opened.

**Call (#106) on ownership:** the Sheet is rendered **per tile, inside the tile's own subtree**, not once at feed level. Each tile already holds the queries and context its sheet body needs, and the video tile's sheet must sit inside the feed player's `PlayerControllerProvider` to pause it and read its `currentTime` (section 5.2). Radix mounts no portal content while closed, so N closed sheets cost a `Root` each.

### 5.2 Video sheet

The sheet hosts a **full** `VideoReviewPanel`: its own player, its own `PlayerControllerProvider`, `MomentOverlay`, `ScrubberPins`, the complete `MomentFeed`, and the composer pinned at the bottom.

```
┌────────────────────────────────┐
│ ×  Armbar drill, round 2       │
├────────────────────────────────┤
│ [ sheet player ]               │ ┐ scrolls
│ ▶ 1:24  Coach Lee              │ │
│   keep the elbow tight…        │ │
│   ◯ Sam Khan  reply…           │ │
│ ▶ 3:02  Coach Lee …            │ ┘
├────────────────────────────────┤
│ [ Add a comment…        ] [ ▶ ]│ pinned
└────────────────────────────────┘
```

- **Title:** `video.title ?? "Video"`. The sheet is the video, not just its comments.
- **Timestamp chips seek the sheet player and the sheet stays open.** `MomentFeed`'s `onSeek` wires to the sheet panel's own `controller.seekTo`, which is what the non-feed layout already does. Scroll up in the sheet to watch. Nothing closes, nothing is handed back.
- **Player handoff on open (one-way):** pause the feed player, then seek the sheet player to the feed player's `currentTime`, paused. On close, nothing is written back: the feed player stays where it was.
- **Two players, two controllers.** `PlayerControllerProvider` holds a single `seekRef` and a single `currentTime` (`player-context.tsx:53,60`), so two players under one provider fight: last registration wins the seek and progress reports thrash. Each panel instance keeps its own provider. That is already how `VideoReviewPanel` is built, so this needs no change beyond not sharing.
- **Watch tracking:** both players track. A single viewing can therefore record two watches (two `play_id`s). Accepted, see section 14.
- **No deeper nesting:** the sheet's panel instance never sets `feedPresentation`, so a feed panel contains at most one detail panel.

Nesting note: `ReplyComposer`'s attach-video Sheet opens *inside* this sheet. See section 5.5.

### 5.3 Thread sheet

```
┌────────────────────────────────┐
│ ×  Discussion on Armbar        │
├────────────────────────────────┤
│ ◯ Sam Khan  3h            🗑   │ ┐ scrolls
│   Tried this three times…      │ │
│   │ ◯ Coach Lee  2h            │ │
│   │   Shift your hips first…   │ ┘
├────────────────────────────────┤
│ [ Reply…                ] [ ▶ ]│ pinned
└────────────────────────────────┘
```

- Title: `Discussion on {anchorLabel}`, or `Discussion` when no anchor resolves.
- Body: `ThreadView` with its inline composer suppressed.
- Footer: the same `ReplyComposer`, pinned, so the thread sheet and the video sheet share one anatomy.

**Call (#106):** pin it via a small seam rather than leaving the composer to scroll off (the prototype's shortcut):

```tsx
// components/threads/use-thread-reply.ts  (new)
function useThreadReply(thread, anchorKind, anchorId, campId?): {
  submit: (body: string, videoId: number | null) => Promise<void>;
  pending: boolean;
}

// components/threads/thread-view.tsx
composer?: "inline" | "none"   // default "inline", so every existing call site is unchanged
```

`ThreadView` uses `useThreadReply` internally for its inline case, so the reply mutation has exactly one definition and the sheet footer cannot drift from it.

### 5.4 Technique sheet

- Title: `technique.name`.
- Body: `TechniqueRowDetail` (#108), which is the private provider plus `ExpandedPanel`. No Accordion, no `value`/`isOpen`, no `useDelayedFalse`, no row chrome. Props: `technique`, `context`, `scrollToVideoId`, `onVideoScrolled`, `scrollToThreadId`.
- Feed-event targeting: `scrollToVideoId={row.video_id}` as today, plus `scrollToThreadId` for the focus thread when the tap came from the comment teaser region.
- `DiscussionBlock` resolves its target as `scrollToThreadId ?? searchParams.get("thread")` and deletes the query param only on the searchParams branch (#108). `scrollIntoView` resolves against the nearest scrollable ancestor, which is the sheet body, and Radix unmounts sheet content on close so `consumedTargetRef` resets and re-opening re-scrolls.
- Composers inside the panel stay inline. `DiscussionBlock` hosts one composer per thread plus a start-a-thread composer, so there is no single conversation to pin. Pinning applies only where the sheet *is* one conversation or one video's comment list.

### 5.5 Nested overlays and Back

Model B puts history-dismissing overlays inside history-dismissing overlays for the first time:

1. detail sheet → `ReplyComposer`'s attach-video Sheet,
2. technique detail sheet → `VideosBlock`'s full-screen `VideoPlayerDialog`.

`useHistoryDismiss` (`lib/use-history-dismiss.ts`) attaches one `popstate` listener per open overlay and every listener calls its own `onClose`, so today a single Back would close **both** layers at once. Required fix, part of this work:

- Keep a module-level stack of open dismissables. On `popstate`, only the top entry closes; it pops itself off the stack.
- Each overlay still pushes its own history entry, so one Back equals one close.
- Unmount cleanup keeps today's behavior (pop our own entry when we were closed via the UI rather than via Back).
- Out of scope for the fix: closing a non-top overlay while a higher one is open. It does not occur in these two paths.

## 6. Feed player behavior

Unchanged from today: the player subtree, watch tracking with its `WatchContext`, native fullscreen, and rotate-to-fullscreen on landscape clips.

Changed: `focusPin` no longer has an inline comment list to scroll to, because the feed tile no longer stacks one.

**Call (#106):** in feed presentation, tapping an overlay chip or a scrubber pin **seeks and pins the transient overlay chip** (the existing 6s `MomentOverlay` behavior, which already renders author, timestamp and a 2-line body). It does not scroll, and it does not open the sheet. `resolvePinFocus`'s exit-fullscreen behavior is unchanged. Rationale: you are watching, and a full-screen sheet interrupts exactly that; the overlay already makes the comment readable in place. The sheet stays one deliberate tap away in the teaser region below.

Removed: the `feedDiscussionOpen` toggle and its `N more comments` / `Add a comment` / `Show discussion (N)` / `Hide discussion` labels (`video-review-panel.tsx:228-283`).

## 7. Motion

From #107, unchanged.

**Sheet open/close.** Keep stock geometry and durations (open 500ms, close 300ms; the exit is correctly faster). Replace stock `ease-in-out` with M3 emphasized tokens:

| Direction | Easing |
| --- | --- |
| open | `cubic-bezier(0.05, 0.7, 0.1, 1)` (emphasized decelerate) |
| close | `cubic-bezier(0.3, 0, 0.8, 0.15)` (emphasized accelerate) |

One utility-class change on `SheetContent` (`ui/sheet.tsx:86`). Overlay scrim fade unchanged. No container transform: the tile does not morph into the sheet.

**Teaser press feedback.** Press dim only: `active:bg-muted/50` alongside the existing `hover:bg-muted/30`, `transition-colors` at Tailwind's default 150ms. The repo has zero `active:` states today, so a teaser tap currently has no feedback until the sheet moves. No scale-down (a card that scales next to non-scaling neighbours reads as a rendering bug), no artificial pre-open delay.

**Reduce Motion.** Under `prefers-reduced-motion: reduce` the sheet cross-fades instead of sliding, roughly 150ms both directions. Nothing informational is lost: it is full-screen with a header and a close affordance. Targeted variant only, **never** a global `animation-duration: 0.01ms !important` reset, because Radix drives unmount off animation completion.

**Explicitly unchanged.** The full-screen video `Dialog` keeps its stock fade plus `zoom-in-95` at `duration-200`, deliberately not harmonised with the sheet. In-sheet content motion is none: a posted comment appears, matching threads everywhere else.

## 8. Component and API changes

New:

| File | What |
| --- | --- |
| `components/technique-row/technique-row-teaser.tsx` | `TechniqueRowTeaser`: provider + `Header` in a plain button, `ChevronRight` |
| `components/technique-row/technique-row-detail.tsx` | `TechniqueRowDetail`: provider + `ExpandedPanel` |
| `components/technique-row/technique-row-provider.tsx` | private `TechniqueRowProvider`, owns the `viewerIsOwner` derivation for all five `RowContext` kinds |
| `components/activity-feed/feed-detail-sheet.tsx` | `FeedDetailSheet` shell |
| `components/activity-feed/teaser-line.tsx` | `TeaserLine` + `ViewAllLine` |
| `components/threads/use-thread-reply.ts` | `useThreadReply` |

Changed:

| File | What |
| --- | --- |
| `technique-row/technique-row.tsx` | composes provider + `Header` in its two triggers + `AccordionContent` → `ExpandedPanel`. Props unchanged. `embedded` deleted. Keeps `useDelayedFalse` |
| `technique-row/index.ts` | export the three wrappers; `ExpandedPanel` and the provider stay private |
| `technique-row/discussion-block.tsx` | `scrollToThreadId` prop, resolved `prop ?? searchParams` |
| `technique-row/expanded-panel.tsx` | thread `scrollToThreadId` down the existing `BlockRenderer` chain alongside `scrollToVideoId` |
| `activity-feed/activity-tile.tsx` | dispatches to the three teaser tiles. `TechniqueSubjectTile`'s `expanded` state and sibling-hiding gate deleted |
| `activity-feed/technique-tile.tsx` | teaser + sheet. Keeps its hydration queries, `toLibraryShape` and `TileSkeleton` |
| `activity-feed/video-tile.tsx` | unchanged in shape: still resolves the video and passes `feedPresentation` |
| `videos/review/video-review-panel.tsx` | feed branch becomes teaser + detail sheet. New `startAtSeconds` and `composerPlacement` |
| `videos/player-context.tsx` | `pause()` + `canPause` on `PlayerController`; `registerPause` on `PlayerRegistration` |
| `videos/player-events.ts` | `registerPause?: (fn: () => void) => void` |
| `videos/vidstack-player.tsx` | register `player.pause()` alongside the existing seek and fullscreen registrations |
| `threads/thread-view.tsx` | `composer?: "inline" \| "none"`, reply mutation moved into `useThreadReply` |
| `ui/sheet.tsx` | emphasized easing per direction, Reduce Motion cross-fade variant |
| `lib/use-history-dismiss.ts` | overlay stack so Back closes only the topmost |

`VideoReviewPanel` props after this work:

```tsx
interface VideoReviewPanelProps {
  video: Video;
  surface: VideoThreadSurface;
  watchEvents?: PlayerEvents;
  composerAction?: ReactNode;
  /** Feed mode: player + teaser lines + the detail sheet. */
  feedPresentation?: { focusThreadId: number | null };
  /** Seek once, when the player first reports it can seek. Used by the sheet
   *  instance to pick up where the feed player was. */
  startAtSeconds?: number;
  /** "footer" pins the composer below a scrolling player + feed, for the sheet.
   *  Default "inline" is today's layout. */
  composerPlacement?: "inline" | "footer";
}
```

Embeds (`youtube`, `vimeo`, `drive`) register neither seek nor pause, so `canSeek`/`canPause` stay false for them and both calls are no-ops. Same class of limitation as today's missing seek.

## 9. Copy

No em-dashes. Timestamped video comments are "comments" and "threads", never "moments" (the internal `Moment*` component names stay).

| String | Where |
| --- | --- |
| `View all {n} comments` | video and technique teasers, pluralized |
| `View all {n} replies` | thread teaser, pluralized |
| `No comments yet` | video teaser with zero threads |
| `video reply` | italic fallback, reply teaser line with a null body |
| `video post` | italic fallback, thread root with a null body |
| `Add a comment…` | video sheet composer placeholder |
| `Reply…` | thread sheet composer placeholder (existing default) |
| `Discussion on {anchor}` / `Discussion` | thread sheet title |
| `on {anchor}` | thread tile anchor chip |
| `No discussion yet.` | existing `MomentFeed` empty state |

## 10. Accessibility floor

- Each teaser region is one `<button type="button">` with no interactive descendants.
- `TechniqueRowTeaser` renders no `aria-expanded`, because nothing expands. `ChevronRight`, not a rotating `ChevronDown`.
- Every sheet renders a `SheetTitle` (Radix requires an accessible name) and keeps the stock close X.
- Radix moves focus into the sheet on open and restores it to the teaser on close. The composer is not autofocused.
- Teaser rows are at least 44px tall at `px-4 py-3` with one or two lines of text.
- `prefers-reduced-motion` honored per section 7.
- Highlight on a scrolled-to thread stays `ring-2 ring-ring/50` for 2200ms, as today, so it is not colour-only against the card.

## 11. Test plan

Browser tests (`.test.tsx`) run in Chromium in CI only, not on this NixOS box. Stub `window.fetch`; `vi.spyOn` on ESM API exports does not work there. Use `renderWithProviders` + `buildUser`.

New:

- `technique-row/technique-row-teaser.test.tsx`: renders the technique name; no `aria-expanded` anywhere in the subtree; click fires the handler; no `PinButton` / `HiddenToggleButton` / remove button.
- `technique-row/technique-row-detail.test.tsx`: renders the expected blocks for a `student-syllabus` context as student and as coach, which is what proves the shared provider derivation; `scrollToThreadId` highlights the right thread.
- `activity-feed/feed-detail-sheet.test.tsx`: title, close button, `body="raw"` does not add a scroll container, `footer` renders outside the scroll area.
- `lib/use-history-dismiss.unit.test.ts`: with two overlays open, one `popstate` closes only the top; the second closes the lower one.

Rewritten:

- `activity-feed/activity-tile.test.tsx`: today it asserts the sibling-hiding behavior that this spec deletes. Replace with, per tile kind: teaser content renders, tapping the teaser opens the sheet, sheet content is present, and the technique row does **not** expand in the feed.

Extended:

- `videos/review/video-review-panel.test.tsx`: feed mode renders teaser lines and the view-all line; zero threads renders `No comments yet`; tapping opens the sheet; `composerPlacement="footer"` puts the composer outside the scrolling region; `startAtSeconds` seeks once when the player reports `canSeek` (drive it through `PlayerControllerProvider`'s `onReady` register hook, as the existing tests do).

Regression gate, unchanged and must stay green: `technique-row.test.tsx`, `student-syllabus-row.test.tsx`, `discussion-block.test.tsx`, `camp-only-videos.test.tsx`. They cover library, syllabus, pinned and camp, which this work refactors under but does not redesign.

## 12. Build order

One commit per slice, imperative subject, scoped, no co-author trailer.

1. **Row API trio.** `TechniqueRowProvider`, `TechniqueRowTeaser`, `TechniqueRowDetail`, `TechniqueRow` recomposed, `embedded` deleted (its only consumers are the two feed rows this work replaces, so slice 1 and slice 4 land together or slice 1 keeps the feed compiling by passing nothing). Behavior-preserving; the four existing row tests gate it.
2. **`useHistoryDismiss` overlay stack** plus its unit test. Unblocks every nested overlay below.
3. **Sheet motion:** emphasized easing per direction, Reduce Motion cross-fade.
4. **`FeedDetailSheet` + `TeaserLine` + technique teaser tile.** Simplest kind, no player involved.
5. **Thread teaser tile:** `useThreadReply`, `ThreadView composer` prop, pinned footer composer.
6. **Video teaser tile:** `VideoReviewPanel` feed branch rewrite, `pause()` on the controller, `startAtSeconds`, `composerPlacement="footer"`, feed-to-sheet handoff, `focusPin` in feed mode.
7. **Delete the prototype and the dead paths** (section 13); rewrite `activity-tile.test.tsx`.
8. **Verify:** `just verify`, PR (deploy.yaml gates), staging sibling deploy, phone pass on a video tile, a thread tile and a technique tile, including hardware Back from a nested attach-video sheet.

## 13. Deletions

- `components/activity-feed/prototype-teaser-tiles.tsx`, `components/prototype-switcher.tsx`, and the `?variant=` gates in `activity-tile-feed.tsx:5,85` and `app/feed/page.tsx:7,27`.
- `components/activity-feed/comment-tile.tsx`. `CommentTile` has no other call site; the thread teaser tile replaces it.
- `TechniqueSubjectTile`'s `expanded` state and the `thread && !expanded` gate (`activity-tile.tsx:41,45`), the jank this map started from.
- `TechniqueRow`'s `embedded` prop.
- `VideoReviewPanel`'s `feedDiscussionOpen` toggle and its four labels.
- The feed `Accordion` wrappers in `technique-tile.tsx` and their `open`/`onExpandedChange` plumbing.

## 14. Accepted consequences

- **Duplicate watch events.** Two tracked players for one video means one viewing can log two watches. Explicitly accepted by the map owner; revisit only if the feed visibly repeats itself.
- **A second signed playback URL fetch** per opened video sheet (`useSignedPlaybackUrl` is per player instance).
- **Embeds cannot pause or seek**, so a YouTube, Vimeo or Drive video keeps playing behind the sheet, and its sheet player ignores `startAtSeconds`.
- **`TechniqueRow` is refactored under four shipped surfaces** inside a map that is not redesigning them. Refactor only, no interaction change, gated by their existing tests.
- **Accordion divergence is deliberate.** The feed never expands in place; library, syllabus, pinned and camp keep expand-in-place. "One shared row" now holds at the provider and blocks level, not the wrapper level.
- **No inline reply from the feed.** Replying always costs one tap into the sheet. #104 judged this a non-cost for an Instagram-shaped audience.
- **A technique tile with no focus thread has no comment teaser.** The row itself opens the sheet, which holds the discussion, so there is no dead end.

## 15. Deliberately not specified

- Partial-detent sheets and peek-behind. Ruled out in #104 as new machinery; the case it serves (keep watching while reading) is now partly served by the sheet player. Revisit only with evidence.
- Container transform tile-to-sheet motion. Ruled out twice (#104, #107).
- Pin toggle or other row chrome in the technique sheet title bar. Considered and rejected in #108 as an untested new action slot; additive if ever wanted.
- Autoplay muted inline video. Research (#103) says it is the norm behind a user setting; our poster plus tap-to-play stance is unchanged by this map.
