# Vidstack Player Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the native `<video controls>` player on the video review surface with a Vidstack custom-controls player so timestamped comment pins live inside a slider we own and align exactly with the playhead.

**Architecture:** The player already sits behind two seams: the `PlayerEvents` contract (player reports progress/play/pause/ended, accepts a seek callback) and `PlayerControllerProvider` (turns events into reactive state). A new Vidstack-backed `VidstackPlayer` implements the same `PlayerEvents` contract, so everything above the seam is untouched. The one structural change: comment pins and the comment overlay move from panel-level overlays into slots the player renders inside its own `TimeSlider` / over its own video, fixing alignment by construction. Embeds and the backend are unchanged.

**Tech Stack:** React 19, Vite, TypeScript, Vidstack (`@vidstack/react`), Tailwind v4, shadcn/ui, lucide-react, Vitest (node project for `.unit.test.ts`, Chromium/Playwright project for `.test.tsx`), pnpm.

**Reference spec:** `docs/superpowers/specs/2026-06-14-vidstack-player-migration-design.md`

---

## Conventions for the implementer

- Package manager is **pnpm**. Run all frontend commands from `frontend/`.
- Two Vitest projects: `*.unit.test.ts` run in **node** (work on this dev box), `*.test.tsx` run in **Chromium via Playwright** (CI only, cannot launch on this box). Run node tests with `pnpm vitest run --project node`. Do not expect `.test.tsx` to run locally; verify those paths with `pnpm run build` (runs `tsc -b`) and `pnpm run lint`.
- Commits use Conventional Commits, imperative mood, scoped, **no `Co-Authored-By` trailer**.
- No em-dashes in any copy or comments. "Moment" is not user-facing: use "comment"/"thread" in strings and aria-labels. Internal `Moment*` code names stay as they are.
- Do not run `git stash`.

## File structure

| File | Responsibility |
| --- | --- |
| `frontend/src/components/videos/vidstack-bridge.ts` | **New.** Pure adapter: maps a player state snapshot to `PlayerEvents` calls and tracks the one-shot "started" flag. Node-unit-testable. |
| `frontend/src/components/videos/vidstack-bridge.unit.test.ts` | **New.** Unit tests for the adapter. |
| `frontend/src/components/videos/vidstack-player.tsx` | **New.** Vidstack-backed player: video + always-visible custom control bar, `overlay` and `sliderMarkers` slots, implements `PlayerEvents`. |
| `frontend/src/components/videos/native-player.tsx` | **Deleted.** Replaced by `vidstack-player.tsx`. |
| `frontend/src/components/videos/video-player-panel.tsx` | `native` branch renders `<VidstackPlayer>`; forwards optional `overlay` + `sliderMarkers` props. |
| `frontend/src/components/videos/review/scrubber-pins.tsx` | Reposition from panel overlay to a slider-track layer (`absolute inset-0`); rename aria copy off "moment". |
| `frontend/src/components/videos/review/scrubber-pins.test.tsx` | Update aria-label assertion to new copy. |
| `frontend/src/components/videos/review/moment-side-sheet.tsx` | Heading copy only: `Moment 0:42` -> `Comment at 0:42`. |
| `frontend/src/components/videos/review/video-review-panel.tsx` | Pass `MomentOverlay` + `ScrubberPins` into the player slots; drop the sibling overlay renders. |
| `frontend/package.json` | Add `@vidstack/react`. |

---

## Task 1: Add the Vidstack dependency

**Files:**
- Modify: `frontend/package.json`, `frontend/pnpm-lock.yaml`

- [ ] **Step 1: Install the package**

Run from `frontend/`:

```bash
pnpm add @vidstack/react
```

- [ ] **Step 2: Verify it resolved and is React 19 compatible**

Run:

```bash
pnpm ls @vidstack/react
node -e "const p=require('@vidstack/react/package.json'); console.log(p.version, JSON.stringify(p.peerDependencies||{}))"
```

Expected: a version prints (Vidstack 1.x), and the printed `peerDependencies` either omit `react` or allow React 19 (range includes `^19` or uses `>=18`). If the peer range excludes React 19, stop and report BLOCKED with the printed range.

- [ ] **Step 3: Confirm the base stylesheet path exists**

Run:

```bash
ls node_modules/@vidstack/react/player/styles/base.css
```

Expected: the path prints with no error. This is the stylesheet the player imports in Task 3. If it is missing, report BLOCKED with the actual contents of `ls node_modules/@vidstack/react/player/styles/`.

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml
git commit -m "build(frontend): Add @vidstack/react dependency"
```

---

## Task 2: Pure event-bridge adapter

The adapter is the only logic-bearing part of the player, so it is isolated and unit tested. It takes a snapshot of player state and the `PlayerEvents` object, calls the right events, and returns the next value of the one-shot `started` flag (which gates the single `onPlay` watch-tracking event).

**Files:**
- Create: `frontend/src/components/videos/vidstack-bridge.ts`
- Test: `frontend/src/components/videos/vidstack-bridge.unit.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/videos/vidstack-bridge.unit.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { applySnapshot, type PlayerSnapshot } from "./vidstack-bridge";
import type { PlayerEvents } from "./player-events";

function mkEvents() {
  return {
    onPlay: vi.fn(),
    onProgress: vi.fn(),
    onPaused: vi.fn(),
    onEnded: vi.fn(),
  } satisfies PlayerEvents;
}

const playing: PlayerSnapshot = { currentTime: 5, duration: 60, paused: false };

describe("applySnapshot", () => {
  it("reports progress when duration is finite and positive", () => {
    const e = mkEvents();
    applySnapshot(playing, e, false);
    expect(e.onProgress).toHaveBeenCalledWith(5, 60);
  });

  it("skips progress when duration is not yet known", () => {
    const e = mkEvents();
    applySnapshot({ currentTime: 0, duration: NaN, paused: true }, e, false);
    expect(e.onProgress).not.toHaveBeenCalled();
  });

  it("always reports the paused state", () => {
    const e = mkEvents();
    applySnapshot({ ...playing, paused: true }, e, true);
    expect(e.onPaused).toHaveBeenCalledWith(true);
  });

  it("fires onPlay exactly once: only when unpaused and not yet started", () => {
    const e = mkEvents();
    const after = applySnapshot(playing, e, false);
    expect(e.onPlay).toHaveBeenCalledTimes(1);
    expect(after).toBe(true);
    applySnapshot(playing, e, after);
    expect(e.onPlay).toHaveBeenCalledTimes(1);
  });

  it("does not fire onPlay while paused", () => {
    const e = mkEvents();
    const after = applySnapshot({ ...playing, paused: true }, e, false);
    expect(e.onPlay).not.toHaveBeenCalled();
    expect(after).toBe(false);
  });

  it("tolerates an undefined events object", () => {
    expect(() => applySnapshot(playing, undefined, false)).not.toThrow();
    expect(applySnapshot(playing, undefined, false)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `frontend/`:

```bash
pnpm vitest run --project node src/components/videos/vidstack-bridge.unit.test.ts
```

Expected: FAIL, cannot resolve `./vidstack-bridge` (module does not exist yet).

- [ ] **Step 3: Implement the adapter**

Create `frontend/src/components/videos/vidstack-bridge.ts`:

```ts
import type { PlayerEvents } from "./player-events";

/** Minimal slice of Vidstack player state the bridge needs. */
export interface PlayerSnapshot {
  currentTime: number;
  duration: number;
  paused: boolean;
}

/**
 * Map a player state snapshot to PlayerEvents calls. Returns the next value of
 * the one-shot `started` flag, which gates the single onPlay() watch event so it
 * fires once per playback session rather than on every unpause.
 */
export function applySnapshot(
  snap: PlayerSnapshot,
  events: PlayerEvents | undefined,
  started: boolean,
): boolean {
  if (Number.isFinite(snap.duration) && snap.duration > 0) {
    events?.onProgress?.(snap.currentTime, snap.duration);
  }
  events?.onPaused?.(snap.paused);
  if (!snap.paused && !started) {
    events?.onPlay?.();
    return true;
  }
  return started;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
pnpm vitest run --project node src/components/videos/vidstack-bridge.unit.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/videos/vidstack-bridge.ts frontend/src/components/videos/vidstack-bridge.unit.test.ts
git commit -m "feat(videos): Add pure Vidstack-to-PlayerEvents bridge adapter"
```

---

## Task 3: VidstackPlayer component

Build the player that replaces `NativePlayer`. It renders the Vidstack video plus an always-visible custom control bar (play/pause, mute, time slider, time readout, fullscreen). It implements the existing `PlayerEvents` contract through the Task 2 adapter, and exposes two slots: `overlay` (rendered over the video, above the control bar) and `sliderMarkers` (rendered inside the time slider).

The control bar is always visible (not auto-hiding) because the slider hosts the comment pins, which must always be visible.

**Files:**
- Create: `frontend/src/components/videos/vidstack-player.tsx`
- Delete: `frontend/src/components/videos/native-player.tsx`
- Reference (do not modify): `frontend/src/components/videos/player-events.ts`, `frontend/src/components/videos/useSignedPlaybackUrl.ts`, `frontend/src/lib/dates.ts` (`formatTimestamp`)

- [ ] **Step 1: Create the player component**

Create `frontend/src/components/videos/vidstack-player.tsx`:

```tsx
import { useEffect, useRef, type ReactNode } from "react";
import {
  MediaPlayer,
  MediaProvider,
  PlayButton,
  MuteButton,
  FullscreenButton,
  TimeSlider,
  useMediaState,
  type MediaPlayerInstance,
} from "@vidstack/react";
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize } from "lucide-react";
import "@vidstack/react/player/styles/base.css";
import type { Video } from "@/lib/api";
import { formatTimestamp } from "@/lib/dates";
import type { PlayerEvents } from "./player-events";
import { useSignedPlaybackUrl } from "./useSignedPlaybackUrl";
import { applySnapshot } from "./vidstack-bridge";

interface VidstackPlayerProps {
  video: Video;
  events?: PlayerEvents;
  /** Rendered over the video, above the control bar (e.g. the comment overlay). */
  overlay?: ReactNode;
  /** Rendered inside the time slider, positioned in the slider's track space. */
  sliderMarkers?: ReactNode;
}

export function VidstackPlayer({ video, events, overlay, sliderMarkers }: VidstackPlayerProps) {
  const { url, loading, error, refresh } = useSignedPlaybackUrl(video.id, true);
  const playerRef = useRef<MediaPlayerInstance>(null);

  // Bridge Vidstack player state to PlayerEvents. Re-subscribe when the source
  // changes so the one-shot onPlay flag resets per video.
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !url) return;
    events?.registerSeek?.((seconds) => {
      player.currentTime = Math.max(0, seconds);
    });
    let started = false;
    const unsubscribe = player.subscribe((state) => {
      started = applySnapshot(
        { currentTime: state.currentTime, duration: state.duration, paused: state.paused },
        events,
        started,
      );
    });
    return unsubscribe;
  }, [events, url]);

  if (error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
        {error}{" "}
        <button
          type="button"
          className="ml-1 underline-offset-2 hover:underline"
          onClick={() => refresh()}
        >
          Try again
        </button>
      </div>
    );
  }

  if (loading || !url) {
    return <div className="aspect-video w-full animate-pulse rounded-md bg-muted/40" />;
  }

  return (
    <MediaPlayer
      ref={playerRef}
      src={{ src: url, type: "video/mp4" }}
      playsInline
      onEnded={() => events?.onEnded?.()}
      className="relative aspect-video w-full overflow-hidden rounded-md bg-black"
    >
      <MediaProvider />

      {/* Overlay layer: covers the video above the control bar. */}
      {overlay && (
        <div className="pointer-events-none absolute inset-x-0 top-0 bottom-12">
          <div className="pointer-events-auto absolute inset-x-0 bottom-0">{overlay}</div>
        </div>
      )}

      {/* Always-visible custom control bar. */}
      <div className="absolute inset-x-0 bottom-0 flex h-12 items-center gap-3 bg-gradient-to-t from-black/80 to-transparent px-3">
        <PlayButton className="text-white">
          <PlayPauseIcon />
        </PlayButton>
        <MuteButton className="text-white">
          <MuteIcon />
        </MuteButton>

        <TimeSlider.Root className="group relative inline-flex h-5 flex-1 cursor-pointer items-center">
          <TimeSlider.Track className="absolute top-1/2 h-1 w-full -translate-y-1/2 rounded-full bg-white/25">
            <TimeSlider.Progress className="absolute h-full rounded-full bg-white/40" />
            <TimeSlider.TrackFill className="absolute h-full rounded-full bg-violet-500" />
          </TimeSlider.Track>
          <TimeSlider.Thumb className="absolute top-1/2 size-3 -translate-y-1/2 rounded-full bg-white opacity-0 group-hover:opacity-100" />
          {/* Comment pins: positioned in the slider's 0..1 track space. */}
          {sliderMarkers && (
            <div className="pointer-events-none absolute inset-0">{sliderMarkers}</div>
          )}
        </TimeSlider.Root>

        <TimeReadout />

        <FullscreenButton className="text-white">
          <FullscreenIcon />
        </FullscreenButton>
      </div>
    </MediaPlayer>
  );
}

function PlayPauseIcon() {
  const paused = useMediaState("paused");
  return paused ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />;
}

function MuteIcon() {
  const muted = useMediaState("muted");
  const volume = useMediaState("volume");
  return muted || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />;
}

function FullscreenIcon() {
  const fullscreen = useMediaState("fullscreen");
  return fullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />;
}

function TimeReadout() {
  const currentTime = useMediaState("currentTime");
  const duration = useMediaState("duration");
  return (
    <span className="whitespace-nowrap text-xs tabular-nums text-white">
      {formatTimestamp(currentTime)} / {Number.isFinite(duration) ? formatTimestamp(duration) : "0:00"}
    </span>
  );
}
```

- [ ] **Step 2: Delete the old native player**

Run from the repo root:

```bash
git rm frontend/src/components/videos/native-player.tsx
```

Expected: the file is staged for deletion. The only importer is `video-player-panel.tsx`, fixed in Task 4 Step 1 below; the build is expected to be red until then, which is fine within this task.

- [ ] **Step 3: Point the panel at the new player and add the slots**

Edit `frontend/src/components/videos/video-player-panel.tsx`. Replace the `NativePlayer` import with `VidstackPlayer`, add `overlay` + `sliderMarkers` to the props, and pass them through on the `native` branch only:

```tsx
import type { ReactNode } from "react";
import type { Video } from "@/lib/api";
import type { PlayerEvents } from "./player-events";
import { DriveEmbed } from "./drive-embed";
import { ExternalLinkCard } from "./external-link-card";
import { VidstackPlayer } from "./vidstack-player";
import { VimeoLiteEmbed } from "./vimeo-lite-embed";
import { YouTubeLiteEmbed } from "./youtube-lite-embed";

interface VideoPlayerPanelProps {
  video: Video;
  events?: PlayerEvents;
  /** Native-player-only slots; ignored for embeds, which cannot host them. */
  overlay?: ReactNode;
  sliderMarkers?: ReactNode;
}

export function VideoPlayerPanel({ video, events, overlay, sliderMarkers }: VideoPlayerPanelProps) {
  if (video.processing_status === "processing") {
    return (
      <p className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
        This video is still processing. It will be playable once the upload
        finishes.
      </p>
    );
  }
  if (video.processing_status === "failed") {
    return (
      <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
        Processing failed for this video. Re-upload to try again.
      </p>
    );
  }

  switch (video.kind) {
    case "native":
      return (
        <VidstackPlayer
          video={video}
          events={events}
          overlay={overlay}
          sliderMarkers={sliderMarkers}
        />
      );
    case "youtube":
      return <YouTubeLiteEmbed video={video} events={events} />;
    case "vimeo":
      return <VimeoLiteEmbed video={video} events={events} />;
    case "drive":
      return <DriveEmbed video={video} events={events} />;
    case "link":
    default:
      return <ExternalLinkCard video={video} events={events} />;
  }
}
```

- [ ] **Step 4: Typecheck the player and panel compile**

Run from `frontend/`:

```bash
pnpm run build
```

Expected: `tsc -b` and the Vite build both succeed. The review panel still renders the old sibling overlays (untouched until Task 6), which is fine, it just means the pins are not in the slider yet. If `tsc` reports that a Vidstack export (`useMediaState` argument, `MediaPlayerInstance`, a `TimeSlider` subcomponent, or the `subscribe` callback state shape) does not match the installed types, adjust the import/usage to the installed API surface (check `node_modules/@vidstack/react`), keeping behavior identical, then re-run. Do not stub or `any`-cast around real type errors.

- [ ] **Step 5: Lint**

Run:

```bash
pnpm run lint
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/videos/vidstack-player.tsx frontend/src/components/videos/video-player-panel.tsx
git commit -m "feat(videos): Replace native player with Vidstack custom-controls player"
```

---

## Task 4: Reposition scrubber pins into the slider track and fix copy

The pins now render inside the slider (passed as `sliderMarkers`), so their container must fill the slider track rather than float over the panel. The per-pin `left: position*100%` math and `clusterPins` are unchanged. Also rename the user-facing aria copy off "moment".

**Files:**
- Modify: `frontend/src/components/videos/review/scrubber-pins.tsx`
- Modify: `frontend/src/components/videos/review/scrubber-pins.test.tsx`

- [ ] **Step 1: Update the aria-label assertion (browser test, CI-run)**

Edit `frontend/src/components/videos/review/scrubber-pins.test.tsx`, line 33, changing the matched name from `moment at` to `comment at`:

```tsx
    await userEvent.click(screen.getByRole("button", { name: /comment at 0:30/i }));
```

- [ ] **Step 2: Reposition the container and rename aria copy**

Edit `frontend/src/components/videos/review/scrubber-pins.tsx`. Change the doc comment wording, the two aria labels, and the container/pin positioning. Replace the `ScrubberPins` component's returned JSX and the label lines:

Change the labels (around lines 62-64):

```tsx
        const label = isCluster
          ? `${g.threads.length} comments`
          : `comment at ${formatTimestamp(g.threads[0].video_ts_seconds as number)}`;
```

Change the container wrapper from the old panel-overlay box to a slider-track fill, and center each pin vertically on the track. Replace the returned JSX (the `<div className="pointer-events-none absolute inset-x-2 bottom-2 h-1">...` block) with:

```tsx
  return (
    <div className="pointer-events-none absolute inset-0">
      {groups.map((g, i) => {
        const isCluster = g.threads.length > 1;
        const active =
          activeThreadId != null &&
          g.threads.some((t) => t.id === activeThreadId);
        const label = isCluster
          ? `${g.threads.length} comments`
          : `comment at ${formatTimestamp(g.threads[0].video_ts_seconds as number)}`;
        return (
          <button
            key={i}
            type="button"
            aria-label={label}
            onClick={() =>
              isCluster ? onClusterClick(g.threads) : onPinClick(g.threads[0])
            }
            style={{ left: `${g.position * 100}%` }}
            className="pointer-events-auto absolute top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
          >
            <span
              className={cn(
                "rounded-full border-2 border-black bg-violet-500",
                isCluster
                  ? "flex h-3.5 min-w-[1.25rem] items-center justify-center px-1 text-[9px] font-bold text-white"
                  : "h-3 w-3",
                active && "bg-white ring-2 ring-violet-500",
              )}
            >
              {isCluster ? g.threads.length : null}
            </span>
          </button>
        );
      })}
    </div>
  );
```

Also update the `clusterPins` doc comment so it does not say "moment": change "so dense moments do not overlap" to "so dense comments do not overlap".

- [ ] **Step 3: Typecheck and lint**

Run from `frontend/`:

```bash
pnpm run build && pnpm run lint
```

Expected: both succeed. (The `.test.tsx` itself runs in Chromium on CI only; it is not run locally.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/videos/review/scrubber-pins.tsx frontend/src/components/videos/review/scrubber-pins.test.tsx
git commit -m "feat(videos): Render scrubber pins inside the slider track"
```

---

## Task 5: Side-sheet heading copy

**Files:**
- Modify: `frontend/src/components/videos/review/moment-side-sheet.tsx:18-20`

- [ ] **Step 1: Change the heading copy**

Edit `frontend/src/components/videos/review/moment-side-sheet.tsx`. Change the timestamped heading from `Moment ${...}` to `Comment at ${...}`:

```tsx
          {thread.video_ts_seconds != null
            ? `Comment at ${formatTimestamp(thread.video_ts_seconds)}`
            : "Whole video"}
```

Leave the file name, component name (`MomentSideSheet`), and everything else unchanged.

- [ ] **Step 2: Typecheck and lint**

Run from `frontend/`:

```bash
pnpm run build && pnpm run lint
```

Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/videos/review/moment-side-sheet.tsx
git commit -m "feat(videos): Use 'Comment at' instead of 'Moment' in side-sheet heading"
```

---

## Task 6: Move overlay and pins into the player slots

Wire the review panel to pass `MomentOverlay` and `ScrubberPins` into the new player slots, and remove the old sibling overlay renders. The pin/overlay data, `focusPin`, `scrollToThread`, `pinnedThread`, and the landscape side-sheet logic are all unchanged, only where the overlay/pins are mounted changes.

**Files:**
- Modify: `frontend/src/components/videos/review/video-review-panel.tsx:125-160`

- [ ] **Step 1: Pass the slots and drop the sibling overlays**

Edit `frontend/src/components/videos/review/video-review-panel.tsx`. Replace the player-region block (the `<div className={sheetOpen ? "flex gap-2" : "relative"}>` ... through the matching closing `</div>` that ends the player region, currently lines 127-160) with this version, which moves `MomentOverlay` into `overlay` and `ScrubberPins` into `sliderMarkers`:

```tsx
      {/* Player region: flex row in landscape sheet mode, stacked otherwise. */}
      <div className={sheetOpen ? "flex gap-2" : "relative"}>
        <div className={sheetOpen ? "relative min-w-0 flex-1" : "relative"}>
          <VideoPlayerPanel
            video={video}
            events={events}
            overlay={
              controller.canReadTime && !sheetOpen ? (
                <MomentOverlay
                  threads={threads}
                  currentTime={controller.currentTime}
                  pinnedThread={pinnedThread}
                  onOpen={focusPin}
                />
              ) : undefined
            }
            sliderMarkers={
              controller.canReadTime ? (
                <ScrubberPins
                  threads={threads}
                  duration={controller.duration}
                  activeThreadId={pinnedThread?.id ?? null}
                  onPinClick={focusPin}
                  onClusterClick={(ts) => focusPin(ts[0])}
                />
              ) : undefined
            }
          />
        </div>

        {sheetOpen && pinnedThread && (
          <MomentSideSheet
            thread={pinnedThread}
            videoId={video.id}
            onClose={() => {
              setPinnedThread(null);
              if (pinTimerRef.current) window.clearTimeout(pinTimerRef.current);
            }}
          />
        )}
      </div>
```

- [ ] **Step 2: Typecheck and lint**

Run from `frontend/`:

```bash
pnpm run build && pnpm run lint
```

Expected: both succeed. `tsc` confirms `VideoPlayerPanel` now accepts `overlay` and `sliderMarkers` (added in Task 3). If `tsc` flags an unused import, it will be `MomentOverlay`/`ScrubberPins` only if they were removed, which they were not, so there should be none.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/videos/review/video-review-panel.tsx
git commit -m "feat(videos): Mount comment overlay and pins inside the Vidstack player"
```

---

## Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the node unit tests**

Run from `frontend/`:

```bash
pnpm vitest run --project node
```

Expected: PASS, including the new `vidstack-bridge.unit.test.ts`.

- [ ] **Step 2: Build and lint the whole frontend**

Run from `frontend/`:

```bash
pnpm run build && pnpm run lint
```

Expected: both succeed with no errors. This is the local gate; the Chromium `.test.tsx` suite runs on CI.

- [ ] **Step 3: Confirm no stray references to the deleted player**

Run from `frontend/`:

```bash
grep -rn "native-player\|NativePlayer" src && echo "FOUND STRAY REFS" || echo "clean"
```

Expected: prints `clean` (grep finds nothing, so the `&&` branch is skipped).

- [ ] **Step 4: Confirm no user-facing "moment" copy remains**

Run from `frontend/`:

```bash
grep -rin "moment" src --include=*.tsx --include=*.ts | grep -iE "\"[^\"]*moment|'[^']*moment|moment at|moments" | grep -viE "MomentComposer|MomentFeed|MomentOverlay|MomentSideSheet|MomentDraft|activeMoment|the moment the spinner"
```

Expected: no output (the only remaining "moment" occurrences are internal component/variable names and the unrelated mutations.ts comment "the moment the spinner clears").

---

## Manual verification (post-merge, on a real device)

These cannot run on the dev box or in CI; note them in the PR description for the reviewer to check on staging:

- iPhone Safari: native video plays **inline** with the custom control bar (not auto-launched into the OS player on play).
- Tapping the fullscreen button on iPhone hands off to the native OS player and returns cleanly.
- Comment pins sit exactly under the playhead at their timestamps, in portrait and in landscape.
- Tapping a pin seeks the video and shows the comment overlay (portrait) or opens the side sheet (landscape).
```
