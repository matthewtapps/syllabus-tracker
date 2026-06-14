# Expand-in-Place Video Viewer

**Date:** 2026-06-14
**Status:** Approved (design agreed in chat)
**Branch:** `roadmap/threads-07-vidstack-player` (continues the Vidstack migration; no new branch)
**Builds on:** the Vidstack player + comment UI already shipped in PR #60.

## Problem

The video viewer is a centered shadcn `Dialog` (`max-w-2xl`, `max-h-90vh`). For
a vertical (or any non-16:9) video on a phone it wastes most of the screen: the
player is hardcoded to `aspect-video`, so a portrait clip is letterboxed into a
short, wide box with black bars and large dead space above and below. There is
no way to give the video the whole screen, and the rotation-driven
"comments beside the video" layout is unreachable because the PWA manifest locks
orientation to `portrait`.

Pushing the dialog edge-to-edge would fix the size but break the modal's mental
model: a centered card with a backdrop reads as "small, secondary, dismissible",
which fights a video you want to study. The fix is to stop pretending it is a
modal and adopt the **expand-in-place** pattern (Material "container transform",
Apple Photos zoom, Instagram media viewer): the tapped video grows into a
focused viewer and collapses back, so it reads as "zoomed in on this video,
still in this context" rather than "navigated to another page".

## Goal

Reshape the viewer container (not the comment UI, which stays as-is) into a
full-screen, context-aware, adaptive viewer that:

1. Sizes the video to its real aspect ratio and fills as much screen as possible.
2. Always shows what the video is attached to (lineage header).
3. Reads as "zoomed in", with an intuitive "zoom out" that is not a page back.
4. Offers an in-app theater layout (comments beside the video) for landscape
   video, plus the unchanged native fullscreen button.
5. Allows device rotation (manifest unlock).

Non-goal: a dedicated `/video/:id` route. Recorded as a sensible future step
(URL-addressable, deep-link friendly) but explicitly out of scope here.

## Design

### Container: full-screen surface, same Radix primitive

Keep Radix `Dialog` as the accessibility primitive (focus trap, scroll lock,
`Esc`, `aria-modal`, labelled title) but restyle `DialogContent` from a centered
card to a full-screen surface: `inset-0`, no `max-w`/`max-h`, opaque/!dimmed
background. We keep the Radix overlay behind it at a low opacity so the origin
context stays faintly visible (reinforces "on top of the library, not a new
page"). This preserves all the a11y we already get for free.

### Expand / collapse motion

Use a scale+fade "zoom" tied to Radix open/close state
(`data-[state=open]:animate-in data-[state=open]:zoom-in-95 fade-in`,
`data-[state=closed]:zoom-out-95 fade-out`, via the existing
`tailwindcss-animate` already used by shadcn dialogs). This gives the
"grow in / shrink out" read at low risk. A true FLIP from the exact card cell
(Apple-Photos container transform) is a possible future polish; it requires the
launch site to report the origin rect through the portal and is not worth the
complexity now. The dim backdrop + zoom + header together already deliver the
"zoomed in, same context" mental model.

### Context header (lineage)

A slim top bar inside the viewer:

- **Lineage label** (small, muted): where the video lives, e.g. the technique
  name. Source: a new optional `context?: { label: string }` prop on the viewer.
  `videos-block.tsx` passes `technique.technique_name`; other call sites may omit
  it (no lineage line shown). Student/library surface is already known and can
  refine the label later.
- **Video title** (the existing `DialogTitle`, kept for a11y labelling).
- **Collapse control**: a down-chevron button labelled "Collapse"/"Minimize"
  (not just an X), so the affordance reads as "zoom out", not "close". It calls
  the same `onClose`. The corner X stays as a secondary close.

### Dismiss affordances (all = "zoom out")

- Down-chevron collapse button (above).
- **Swipe-down-to-dismiss** on touch: a small pointer/touch handler on the
  header/player region; dragging down past a threshold (~25% viewport or a
  velocity flick) closes; otherwise it springs back. Implemented as a local hook
  `useSwipeDownDismiss(onClose)` returning drag handlers + a live translateY for
  follow-the-finger feedback.
- `Esc` (free from Radix) on desktop.

### Adaptive layout

Determine orientation from `video.width`/`video.height` (fallback: treat as
landscape when unknown; Vidstack still renders intrinsic):
`isPortraitVideo = h > 0 && w > 0 && h > w`.

- **Player sizing:** drop the hardcoded `aspect-video`. The player adopts
  `aspectRatio = w/h` (passed to `MediaPlayer`), centered (`mx-auto`), bounded so
  it never overflows: portrait video capped by height (`max-h-[...]`), landscape
  video by width (full width). Edge-to-edge horizontally for landscape video.
- **Comments placement:**
  - Portrait video, or narrow viewport: comments **below** the player
    (current stacked layout).
  - Landscape video in **theater** mode (and enough width): comments in a
    **side column** beside the player. This reuses `VideoReviewPanel`'s existing
    two-column flex (today gated on physical orientation) but reflows the full
    composer + feed into the side column, not just a single pinned thread.

### Theater button (separate from fullscreen)

Add a distinct theater toggle (icon, e.g. `PanelRight`/`Columns2`) to the
control bar, shown only for landscape video on a wide-enough surface. It toggles
the in-app side-by-side layout. The native `FullscreenButton` is unchanged and
remains a separate, predictable control (`Esc`/OS gesture exits). This matches
YouTube's theater-vs-fullscreen split and keeps accessible names honest.

### Rotation unlock

Change the PWA manifest in `vite.config.ts` from `orientation: "portrait"` to
allow rotation (remove the lock / set `"any"`). This affects the whole app
(approved). Real landscape then works, and native fullscreen handles its own
orientation.

## Components

| File | Change |
| --- | --- |
| `frontend/vite.config.ts` | Manifest `orientation: "portrait"` -> allow rotation. |
| `frontend/src/components/videos/video-player-dialog.tsx` | Full-screen surface, zoom transition, context header (lineage + title + collapse), swipe-down dismiss, pass `context` + video dims down. |
| `frontend/src/components/videos/vidstack-player.tsx` | Aspect-correct sizing (use `video.width/height`), drop fixed `aspect-video`; add theater toggle button (landscape only); accept `onToggleTheater`/`theater` + `canTheater`. |
| `frontend/src/components/videos/review/video-review-panel.tsx` | Reflow composer+feed into a side column when `theater`; own the `theater` state; pass theater props to the player; decouple side layout from the orientation media query. |
| `frontend/src/components/videos/video-list.tsx` | Thread an optional `context` label to `VideoPlayerDialog`. |
| `frontend/src/components/technique-row/videos-block.tsx` | Pass `technique.technique_name` as the viewer lineage context. |
| `frontend/src/lib/use-swipe-down-dismiss.ts` | **New.** Touch drag-to-dismiss hook (translateY + threshold/flick). |

## Testing

- Node unit test for `useSwipeDownDismiss` threshold/flick logic (pure reducer
  over pointer deltas), runnable in the `node` vitest project.
- Browser tests: viewer shows the lineage label when `context` is provided;
  collapse button calls `onClose`; theater toggle reflows to the side column for
  landscape video and is absent for portrait video.
- Manual on a real phone: portrait video fills height; landscape video goes
  edge-to-edge; swipe-down collapses; rotation works; native fullscreen still
  works.

## Risks

- **Transition fidelity:** scale+fade is not a true cell morph. Accepted; header
  + backdrop carry the context. FLIP is a later polish.
- **Swipe-down vs scroll:** the comment list scrolls. Constrain the drag handler
  to the header/player region (not the scrollable feed) so a comment scroll is
  never read as a dismiss.
- **Theater width:** only offer theater when the viewport is wide enough that two
  columns are usable; otherwise comments stay below even for landscape video.
