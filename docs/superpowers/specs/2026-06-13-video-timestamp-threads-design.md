# Video comment threads (timestamped + whole-video) design

Captured 2026-06-13. Stacked on the threads/comments epic (PRs #53-57).

## Goal

Wire video comment threads into the shared video player. The threads backend
already supports `video` and `video_timestamp` anchors end to end; this work is
mostly frontend: let coaches and students read and post comments on a video,
either anchored to a specific second or to the whole video, in one unified
surface.

The mental model: a video is the campfire. People gather around a moment
("at 0:42 your hand is too low"), and the conversation hangs off that second.
Whole-video remarks share the same feed without a stamp.

A static visual reference of the final layout lives alongside this doc at
`2026-06-13-video-timestamp-threads-mocks.html`.

## Scope

- Anchors: `video_timestamp` (stamped) and `video` (whole-video), mixed in one
  feed.
- Surfaces: every place the shared player already opens, the global library,
  a student's pinned technique, and a student's syllabus technique. Videos are
  technique-scoped today, so the same video can appear on all three.
- Actors: coaches and students both read and post. No new permission gate;
  commenting on a visible video is open to any authenticated viewer.
- Player kinds: native uploads get full capability. YouTube / Vimeo / Drive
  lite-embeds degrade (see "Embed degradation").

Out of scope (own stacked PRs): @-mentions, reactions, video replies (upload),
the `videos.parent_kind` refactor for camp/match/loose videos, notifications,
and a coach-side feed filter.

## Architecture (scoped PlayerContext)

A small React context scoped to the review surface, written by the player and
read by every thread consumer. This fans out cleanly to the four consumers and
isolates the native-only capability behind one place.

- **`PlayerContext`** holds `{ currentTime, duration, paused, seekTo(),
  capabilities: { canReadTime, canSeek } }`.
  - `NativePlayer` writes `currentTime`/`duration` through the existing
    `PlayerEvents.onProgress` callback, and exposes an imperative `seekTo` (via
    ref) that sets `video.currentTime`. `capabilities` are both `true`.
  - Embeds never populate time and provide no `seekTo`; `capabilities` are both
    `false`. The context is inert for them.
- **`VideoReviewPanel`** wraps the existing `VideoPlayerPanel` plus the thread
  UI and provides the context. It is what opens inside the player dialog.
- Consumers (all read the context):
  - **`MomentOverlay`**, the live caption over the video.
  - **`ScrubberPins`**, the timeline dots.
  - **`MomentComposer`**, the collapsed/expanding composer.
  - The fullscreen **side sheet**.

`PlayerEvents`, `NativePlayer`, and `VideoPlayerPanel` keep their current
shape; the context is added around them, not in place of them.

## Data flow

### Read

`listThreads('video', videoId)` already returns both `video` and
`video_timestamp` threads for that video, ordered
`COALESCE(video_ts_seconds, 0), last_activity_at DESC`, and filtered by viewer
visibility (`viewer_can_see`: coach sees all; broadcast visible to all; private
visible only to its scope student). The feed renders that one list:

- A row with `video_ts_seconds` renders a `0:42` chip and drops a pin on the
  timeline.
- A row without renders a `whole video` tag and no pin.

### Create

`createThread({ anchor_kind, anchor_id: videoId, video_ts_seconds, visibility,
scope_student_id, body })`:

- "At this moment" sends `anchor_kind: 'video_timestamp'` with the captured
  (and optionally nudged) seconds.
- Clearing the stamp (`x whole video`) sends `anchor_kind: 'video'` with no
  seconds.
- `visibility` and `scope_student_id` are derived from surface context + role
  (see "Visibility"), not chosen by the user.

### Activity

`create_thread` already emits a `thread_comment_posted` activity row with the
denormalised deep-link context (`video_id`, `context_kind: 'library'`). No new
activity work.

## Visibility

Visibility is derived from the surface the player was opened on plus the
author's role. There is no user-facing visibility control in v1. The table
below is for **new-thread creation defaults**:

| Surface | Coach starts a thread | Student starts a thread |
|---|---|---|
| Global library | broadcast (no scope student) | private, scope = self |
| Student pinned | private, scope = that student | private, scope = self |
| Student syllabus | private, scope = that student | private, scope = self |

Rules that fall out of the video-anchored model:

- **Replies always inherit.** Comments carry no visibility of their own; they
  live under the thread. A coach replying to a student's private library thread
  stays private. Broadcast only ever happens when a coach *starts* a thread on
  the global library (an announcement to everyone who can see the video).
- **Threads follow the student across surfaces.** Because the anchor is the
  video (technique-scoped) and the thread is private-scoped to that student, it
  surfaces wherever that student views the video: the global library, their
  pinned version once they pin the technique, and their syllabus. Same thread,
  no copying. The visibility filter already lets a student see their own
  private threads everywhere. This matches SD-010's cross-surface consistency.

The composer computes `visibility` / `scope_student_id` from a `surfaceContext`
prop, the same shape `DiscussionBlock` already uses to derive `scopeStudentId`.

Known consequence (accepted, follow-up later): a coach browsing the global
library sees every student's private thread on a video alongside broadcasts,
because coaches see all. Spec-compliant ("coaches see all of it") but
potentially noisy at volume. A coach-side filter is a future follow-up, out of
scope here.

## Overlay behavior (live caption)

The root comment of a timestamped thread floats over the video while
`currentTime` is inside `[t - 3s, t + 3s]` (a ~6s window, sitting just under
the 7s subtitle-display ceiling from BBC/Netflix caption guidance), then fades.
Hovering or tapping a pin re-summons it. Body clamps to two lines plus ellipsis.
Tapping the overlay opens that thread: in portrait it scrolls to and highlights
the feed row; in fullscreen it opens the side sheet. Native only; embeds never
auto-show because they cannot report `currentTime`.

When multiple moments fall inside the window, show the nearest upcoming/active
one; the rest stay reachable via their pins.

## Fullscreen (landscape)

Tapping the overlay, a pin, or the floating `+ 0:42` button opens the thread as
a right-hand **side sheet**. The video shrinks and re-centres in the remaining
space so it stays fully visible (never cropped or hidden behind the sheet). The
sheet is scoped to one moment's thread with its replies and a collapsed compose
pill at the foot; the header `x` (or swipe) closes it and the video springs
back to full width. Portrait keeps the player-on-top, feed-below layout.

## Composer (lean, progressive disclosure)

- **Collapsed (default):** a single line, `+ Comment at 0:42`. Nothing else.
- **Tapped:** pauses playback (freezes the moment), expands to show the stamp
  chip, `-/+` nudge (1s), `use current frame` re-grab, `x whole video` to drop
  the stamp, a textarea, and Cancel / Post. Collapses again after post or
  cancel.
- The stamp pre-fills from `currentTime` on expand.

## Embed degradation

For embeds (`canReadTime = false`):

- The composer shows manual `mm:ss` entry, or whole-video only.
- No live overlay.
- Pins still render from stored `video_ts_seconds`; clicking deep-links the
  feed row but cannot seek the player.
- Reading threads works fully on every player kind.

## Backend changes

Small. The only real gap:

- Add `video_ts_seconds: Option<i64>` to the `ThreadView` struct, its SQL
  select, and the frontend `ThreadView` type, so the feed can render the chip
  and place pins.

Everything else already exists: anchor validation for `video`/`video_timestamp`,
the mixed-ordering read query, `viewer_can_see` visibility filtering, and
activity emission.

## Frontend components (new)

- `PlayerContext` + provider.
- `VideoReviewPanel` (wraps `VideoPlayerPanel` + thread UI, provides context).
- `MomentOverlay`.
- `ScrubberPins` (with ~30px touch hit areas and clustering of near-adjacent
  pins into a count dot).
- `MomentComposer` (collapsed/expanded states).
- Fullscreen side-sheet variant of the thread view.

Reuses existing `ThreadView`, `ThreadComposer`, `CommentItem`, `StudentAvatar`,
the threads query/mutation hooks, and the `formatRelativeShort` / time
helpers.

## Mobile adaptations (baked in)

- Pin tap targets: ~30px invisible hit box per pin; near-adjacent pins cluster
  into one count dot that expands on tap.
- Overlay text clamps to two lines.
- Overlay has no button; the whole caption is the tap target.
- Fullscreen uses the side sheet, not a bottom sheet, and shrinks the video.

## Error handling

- Create via the existing thread mutation; `toast.error` on failure (matches
  `ThreadView` / `DiscussionBlock`).
- Empty/whitespace body disables Post.
- Time and seek reads guarded by `Number.isFinite`.
- Soft-deleted threads/comments are already tombstoned by the read layer.

## Testing

Vitest browser tests follow the project convention (stub `window.fetch`,
`renderWithProviders` + `buildUser`; `.test.tsx` run in Chromium on CI, not on
the NixOS box):

- Composer derives the correct `visibility` / `scope_student_id` for each
  (surface, role) pair in the visibility table.
- Clearing the stamp posts a `video` anchor with no seconds.
- A pin click calls `seekTo` with the row's seconds.
- The overlay shows inside the time window and hides outside it.
- An embed surface hides the capture button and the overlay, and falls back to
  manual entry.

Backend: a `get_thread` / list test asserting `video_ts_seconds` is returned on
the payload.

## Open questions

None blocking. The coach-side global-library noise filter is deferred.
