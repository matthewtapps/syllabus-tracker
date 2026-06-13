# Vidstack Player Migration Design

**Date:** 2026-06-14
**Status:** Approved (pending spec review)
**Builds on:** `roadmap/threads-06-video-comments` (video-timestamp comment threads, PR #59)

## Problem

The video-timestamp comment feature overlays a custom "scrubber pin" track
(`ScrubberPins`, positioned `absolute inset-x-2 bottom-2`) on top of a native
`<video controls>` element. The browser renders the native scrubber internally
with its own padding, thumb inset, and time/volume label widths that are not
measurable from JavaScript and differ per browser and OS. Our overlaid pin
track is therefore a guess at where the native progress bar sits, and the pins
never line up with the actual playhead. The reported bug (purple pin landing in
the wrong place) is a direct consequence.

The same opacity means native fullscreen destroys our overlay entirely: in
fullscreen the browser owns the chrome and our pin DOM is gone.

## Goal

Replace the native player on the review surface with [Vidstack](https://vidstack.io)
(`@vidstack/react`) custom controls, so the time slider is a real DOM element we
own. Pins become children of that slider and align with the fill by
construction. No backend changes.

## Scope

**In scope:** the `kind: "native"` playback path only (`native-player.tsx`).

**Out of scope, unchanged:**

- Embeds (`youtube`, `vimeo`, `drive`, `link`) keep their existing lite-embed
  components. They cannot report a playhead, so `canStamp` stays `false` and
  they show no pins. Vidstack is not introduced for embeds.
- Backend: zero changes. Playback is a signed progressive MP4 from
  `useSignedPlaybackUrl`; Vidstack plays it with its default provider (no HLS,
  no `hls.js`).
- The comment data model, threads/comments API, visibility derivation,
  `MomentComposer`, `MomentFeed`, `MomentSideSheet`, `MomentOverlay`, and the
  `PlayerControllerProvider` context.

## Architecture

The existing design already abstracts the player behind two seams, and this
migration reuses both rather than replacing them:

1. **`PlayerEvents`** (`player-events.ts`): the player reports
   `onPlay`/`onProgress`/`onPaused`/`onEnded` upward and accepts a
   `registerSeek(fn)` callback. The controller never touches the video element
   directly.
2. **`PlayerControllerProvider`** (`player-context.tsx`): turns those events
   into reactive `currentTime`/`duration`/`paused`/`canReadTime`/`canSeek`
   state plus a `seekTo`. Consumed by the composer, feed, overlay, and pins.

Because the player is already behind `PlayerEvents`, swapping the player
implementation is contained: a new Vidstack-backed player implements the same
`PlayerEvents` contract, and everything above the seam is untouched.

### The one structural change: pins move inside the slider

Today `ScrubberPins` renders as a sibling overlay of `VideoPlayerPanel` inside
`VideoReviewPanel`, floating over the player. The fix requires the pins to live
**inside Vidstack's `TimeSlider`**, so they inherit the slider's own 0..1 track
box and `left: pos*100%` lands on the fill exactly.

To get pin data inside the player, `VidstackPlayer` exposes a slider-markers
slot:

```tsx
interface VidstackPlayerProps {
  video: Video;
  events?: PlayerEvents;
  /** Rendered inside <TimeSlider>, positioned in the slider's 0..1 track space. */
  sliderMarkers?: ReactNode;
}
```

`VideoReviewPanel` passes its (adapted) `ScrubberPins` into `sliderMarkers`
instead of overlaying it. `ScrubberPins` changes only its positioning context:
it drops `absolute inset-x-2 bottom-2` (which assumed it was a panel overlay)
and instead fills the slider track (`absolute inset-0`), keeping its existing
`left: position*100%` per-pin math and `clusterPins` logic verbatim.

`MomentOverlay` (the Instagram-live chip over the video frame) stays a
panel-level overlay over the video area; it does not touch the scrubber and is
unchanged.

### Event bridge

`VidstackPlayer` maps Vidstack player state to the existing `PlayerEvents`:

| Vidstack source | `PlayerEvents` call |
| --- | --- |
| `time-update` (or `currentTime` state) + `duration` | `onProgress(currentTime, duration)` |
| `play` | `onPlay()` once per open (guarded by a ref, matching current `startedRef`) + `onPaused(false)` |
| `pause` | `onPaused(true)` |
| `ended` | `onEnded()` |
| player ref | `registerSeek((s) => { player.currentTime = Math.max(0, s); })` |

This mirrors the current `native-player.tsx` wiring exactly, so the controller,
composer, feed, `focusPin`, and `scrollToThread` behavior are byte-for-byte
unaffected.

### Controls and skin

Compose Vidstack primitives into a custom control bar to match the existing
shadcn/violet aesthetic:

- `MediaPlayer` + `MediaProvider` with `src` = the signed MP4 URL and
  `playsInline` set (inline playback on iOS).
- A control row: play/pause toggle, mute toggle, `TimeSlider` (hosting
  `sliderMarkers`), `currentTime / duration` readout using `formatTimestamp`,
  and a `FullscreenButton`.
- Buttons styled with the shadcn `Button` component; violet accent on the
  slider fill and pins.
- Loading and error states reuse the existing `useSignedPlaybackUrl` skeleton
  and retry UI from `native-player.tsx`.

### Fullscreen

Use Vidstack's standard `FullscreenButton` on all devices. On iPhone Safari it
delegates to the native OS player (`webkitEnterFullscreen`); on
Android/desktop/iPad it uses element fullscreen. We deliberately do **not** try
to keep our custom overlay alive in fullscreen, and we do **not** request
fullscreen on a wrapper container. Pins, the moment overlay, the composer, the
feed, and the landscape side-sheet are the **inline** experience; native
fullscreen is the plain viewing experience. Not fighting the platform here is
intentional, it avoids the iPhone element-fullscreen limitation and a class of
UX bugs.

### Landscape side-sheet (unchanged)

The orientation-driven side-sheet (`useMediaQuery("(orientation: landscape) and
(max-height: 500px)")`) is unchanged. It only opens when a pin is tapped
(`isLandscape && pinnedThread != null`), so rotating the phone to watch a bigger
video never forces the sheet, and it never conflicts with the fullscreen button.
It is pure CSS layout, so it works identically on iPhone.

## Components

| File | Change |
| --- | --- |
| `frontend/src/components/videos/vidstack-player.tsx` | **New.** Vidstack-backed player implementing `PlayerEvents`, custom control bar, `sliderMarkers` slot. |
| `frontend/src/components/videos/native-player.tsx` | **Removed** (replaced by `vidstack-player.tsx`). |
| `frontend/src/components/videos/video-player-panel.tsx` | `kind: "native"` branch renders `<VidstackPlayer>`; forwards a new optional `sliderMarkers` prop. |
| `frontend/src/components/videos/review/scrubber-pins.tsx` | Positioning changes from panel overlay to slider-track fill (`absolute inset-0`); pin math unchanged. |
| `frontend/src/components/videos/review/video-review-panel.tsx` | Pass `ScrubberPins` into the player's `sliderMarkers` slot instead of overlaying it; remove the sibling overlay render. |
| `frontend/package.json` | Add `@vidstack/react` (latest, React 19 compatible). |

## Testing

Vitest browser tests run in Chromium (CI only) and cannot play real media, so
tests stay at the seams:

- The Vidstack-to-`PlayerEvents` mapping is extracted as a pure adapter function
  and unit tested (event in -> `PlayerEvents` call out), runnable as a
  `.unit.test.ts` in node.
- `ScrubberPins` / `clusterPins` positioning is already pure given a duration;
  existing tests stay green with the positioning-context change.
- Manual verification on a real iPhone for inline playback and the native
  fullscreen handoff (the NixOS dev box cannot run iOS Safari).

## Risks

- **iOS inline playback:** mitigated by `playsInline`; verify on a real iPhone.
- **Bundle size:** Vidstack is modular and tree-shakeable; only the imported
  components ship. Acceptable.
- **React 19 compatibility:** confirm the installed `@vidstack/react` version
  supports React 19 at install time.

## Non-goals

- Migrating embeds to Vidstack providers.
- HLS / adaptive streaming.
- Thumbnail hover previews, chapters menu, or other Vidstack features beyond the
  custom control bar and slider markers.
