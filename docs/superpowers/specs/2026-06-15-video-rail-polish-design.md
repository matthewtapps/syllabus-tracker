# Video rail UI polish design

Captured 2026-06-15. Stacked on the video-timestamp-threads work
(`2026-06-13-video-timestamp-threads-design.md`) and the threads/comments epic.

## Goal

Polish the existing video comment rail: make the theater (comments-beside-video)
layout respond to device rotation, let timeline pins drill into a thread from
fullscreen, add a "use current frame" re-grab to the composer, and a light
visual pass. Frontend only, no backend changes.

The rail today (overlay caption, scrubber pins, composer, feed, theater toggle)
is fully built and shipping. This is refinement, not new capability.

## Scope

In:
- Rotation-aware theater: rotating a phone to landscape puts comments beside the
  video automatically; the manual toggle remains.
- Fullscreen pin drill-in: pins render on the fullscreen timeline; tapping one
  exits fullscreen and opens the thread (theater + scroll/highlight).
- "Use current frame" button in the expanded composer.
- Light visual tidy of the existing rail components.

Out (own work, deferred): embed manual `mm:ss` entry, @-mentions, reactions,
the social-tile feed, any backend change.

## 1. Rotation-aware theater

### Today
`VideoReviewPanel` (`video-review-panel.tsx`):
- `canTheater = videoIsLandscape && useMediaQuery("(min-width: 768px)")`.
- `theaterPref` is a `boolean`, default `false`.
- `theater = canTheater && theaterPref`.
- The `Columns2` control-bar button toggles `theaterPref`.

So theater is opt-in everywhere, even on a wide desktop, and rotating a phone to
landscape does nothing until the user taps the toggle.

### Change
Auto-follow available room, with a sticky manual override that resets on
rotation:
- `theaterPref` becomes `boolean | null`. `null` means "auto".
- Effective `theater = canTheater && (theaterPref ?? true)`. When there is room
  (landscape video and viewport >= 768px, which a rotated phone and any desktop
  both satisfy) comments sit beside the video by default; otherwise they stack
  below.
- The control-bar button sets an explicit pref to the negation of the current
  effective theater state (`setTheaterPref(!theater)`), so a user can force the
  stacked layout while in landscape, or force theater on a narrow-but-allowed
  case.
- A `useMediaQuery("(orientation: landscape)")` value is watched; on any change
  to it, reset `theaterPref` to `null` so rotation always re-applies auto.

### Accepted consequence
Desktop now defaults to comments-beside-video (it has room), where today it
defaults to stacked. This matches the "show comments when there's room" model;
the button still stacks them. Confirmed acceptable with the user.

### Notes
- `canTheater` keeps its current definition (landscape video + min-width 768px).
  Portrait videos never theater (no benefit side-by-side); rotating with a
  portrait video leaves the stacked layout, which is correct.
- The orientation reset uses the boolean from `useMediaQuery`; an effect with
  that boolean in its dependency array sets `theaterPref` back to `null`. It must
  not run on first mount in a way that clobbers nothing (null -> null is a
  no-op, so harmless).

## 2. Fullscreen pin drill-in

### Why it already half-works
The player uses vidstack's custom control bar with a custom `TimeSlider`;
`ScrubberPins` render inside the slider track (`vidstack-player.tsx`). vidstack's
`FullscreenButton` fullscreens its own container via the Fullscreen API, so on
Android and desktop the custom control bar (and therefore the pins) persist in
fullscreen. No extra drawing work is needed for the pins themselves.

### Wiring needed
A pin tap in fullscreen should exit fullscreen and drill into the thread. The
pin click already calls `focusPin` (via `onPinClick` / `onClusterClick`), but
`focusPin` cannot currently exit fullscreen because the panel has no handle on
the player's fullscreen state. Add that handle through the existing controller
registration pattern (mirrors `seekTo` / `registerSeek`):

- `PlayerController` gains:
  - `isFullscreen: boolean`
  - `exitFullscreen: () => void`
- `PlayerRegistration` gains:
  - `registerExitFullscreen: (fn: () => void) => void`
  - `reportFullscreen: (fullscreen: boolean) => void`
- `PlayerControllerProvider` holds an `isFullscreen` state and an
  `exitFullscreenRef`; `exitFullscreen()` calls the ref; `reportFullscreen`
  sets the state.
- `VidstackPlayer`:
  - reads `useMediaState("fullscreen")` and calls `reportFullscreen(...)` when it
    changes (an effect keyed on that boolean).
  - registers `() => playerRef.current?.exitFullscreen()` via
    `registerExitFullscreen`.

### focusPin change
`focusPin(t)` in `video-review-panel.tsx`:
1. Keep the existing toggle-off-on-reclick behavior.
2. When setting a pin: if `controller.isFullscreen`, call
   `controller.exitFullscreen()` and set `theaterPref` to `true` (so the panel
   lands in theater where the feed is visible beside the video).
3. Seek (`controller.seekTo`) and `scrollToThread(t.id)` as today, but defer the
   scroll one frame (`requestAnimationFrame`, falling back to a short
   `setTimeout`) so the row exists in the post-fullscreen-exit layout before
   `scrollIntoView` runs. The existing highlight timer is unchanged.

### iOS degradation (accepted)
On iOS Safari, vidstack falls back to native `<video>` fullscreen, where custom
UI (and thus the pins) cannot render. No pins in fullscreen on iOS; tapping the
native controls just plays. Accepted, consistent with the existing embed
degradation philosophy.

## 3. "Use current frame" re-grab

In the expanded `MomentComposer` (`moment-composer.tsx`), add a **Use current
frame** button alongside the `-/+` nudge and `x whole video` controls. It sets
`stamp = Math.floor(currentTime)` from the live controller time, so the user can
scrub the player to a better frame after expanding (which paused) and re-grab.

- Shown only when `canStamp` is true (native player).
- If `stamp` is currently `null` (whole-video), the button re-introduces a stamp
  at the current frame.
- No edge-of-video guard here (unlike the auto default-stamp): the user is
  explicitly choosing the frame. Clamp to `Math.max(0, Math.floor(currentTime))`.

## 4. Visual tidy (light, non-structural)

While editing these files only, with no layout restructure or renames:
- Pin active-state and contrast consistency against the slider track.
- Overlay caption fade timing and legibility.
- Composer and feed row spacing; timestamp chip and "whole video" tag alignment.
- Highlight-flash timing on scroll-to-thread.

These are discretionary touch-ups, not behavioral changes.

## Components touched

- `frontend/src/components/videos/review/video-review-panel.tsx` — orientation
  pref logic; `focusPin` fullscreen branch.
- `frontend/src/components/videos/player-context.tsx` — fullscreen fields on
  controller + registration.
- `frontend/src/components/videos/vidstack-player.tsx` — report fullscreen,
  register `exitFullscreen`.
- `frontend/src/components/videos/review/moment-composer.tsx` — use-current-frame
  button.

Reuses existing `useMediaQuery`, the threads query/mutation hooks, and the
`formatTimestamp` helper.

## Testing

Vitest browser tests, project convention (stub `window.fetch`,
`renderWithProviders` + `buildUser`; `.test.tsx` run in Chromium on CI, not on
the NixOS box):

- Theater defaults on when `canTheater` and pref is auto (`null`); the toggle
  forces it off; an orientation change resets the pref to auto. (May be split
  into a small unit test of the effective-theater derivation plus a component
  test of the toggle, since `matchMedia` orientation is awkward to flip in jsdom
  — use a mockable `useMediaQuery`.)
- A pin click while `isFullscreen` calls `exitFullscreen`, then seeks and
  highlights the row.
- A pin click while not fullscreen behaves as today (no `exitFullscreen` call).
- "Use current frame" sets the stamp to the floored current time; shown only
  when `canStamp`.

## Error handling

- `exitFullscreen` is a no-op if no fn was registered (embeds, tests).
- Time reads clamped with `Math.max(0, ...)` and the composer's existing
  `Number.isFinite` guards remain.
- No new network calls; create still goes through the existing thread mutation
  with its `toast.error` path.

## Open questions

None blocking.
