# Video Rail UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the video comment rail rotation-aware (auto-theater), let timeline pins drill into a thread from fullscreen, add a "use current frame" composer button, with a light visual pass.

**Architecture:** Push the decision logic into two tiny pure helpers (`effectiveTheater`, `resolvePinFocus`) that get fast Node unit tests, extend the existing `PlayerContext`/`PlayerEvents` bridge with a fullscreen channel, and rewire `VideoReviewPanel` + `VidstackPlayer` to use them. No backend changes.

**Tech Stack:** React, TypeScript, @vidstack/react, Vitest (two projects: `unit` in Node for `*.unit.test.ts`, `browser` in Chromium for `*.test.tsx`), Tailwind.

**Spec:** `docs/superpowers/specs/2026-06-15-video-rail-polish-design.md`

---

## Environment notes (read first)

- This is the `frontend/` workspace. Run all commands from `frontend/`.
- Two Vitest projects (`frontend/vitest.config.ts`):
  - `*.unit.test.ts` → Node environment. **These run on this dev box.**
  - `*.test.tsx` / `*.test.ts` → Chromium via Playwright. **These run in CI, not on this NixOS box** (`pnpm test` will try to launch Chromium and fail locally). Write them to convention; do not expect to execute them here.
- Run a single unit test file locally with:
  `pnpm exec vitest run --project unit src/components/videos/review/review-logic.unit.test.ts`
- Typecheck + lint gate locally: `pnpm exec tsc -b` and `pnpm lint`.
- Pure-logic tests use `*.unit.test.ts` (no DOM). Component tests use `render` from `@testing-library/react` (`@/test/render` provides `renderWithProviders` + `buildUser` when context is needed).
- `VideoReviewPanel` mounts `VidstackPlayer`, which fetches a signed URL and mounts a real `<video>`. It is not unit-testable cheaply; that is why the decision logic is extracted into the pure helpers below, which carry the test coverage. The panel/vidstack glue is verified by typecheck + manual steps.

---

## File Structure

- `frontend/src/components/videos/review/review-logic.ts` *(new)* — pure helpers: `effectiveTheater`, `resolvePinFocus`. No React, no DOM.
- `frontend/src/components/videos/review/review-logic.unit.test.ts` *(new)* — Node unit tests for both helpers.
- `frontend/src/components/videos/player-context.tsx` *(modify)* — add fullscreen fields to controller + registration.
- `frontend/src/components/videos/player-context.test.tsx` *(new)* — context test for the fullscreen channel.
- `frontend/src/components/videos/player-events.ts` *(modify)* — add `onFullscreenChange` + `registerExitFullscreen` to the bridge interface.
- `frontend/src/components/videos/vidstack-player.tsx` *(modify)* — report fullscreen state + register `exitFullscreen`.
- `frontend/src/components/videos/review/moment-composer.tsx` *(modify)* — "use current frame" button.
- `frontend/src/components/videos/review/moment-composer.test.tsx` *(modify)* — test the new button.
- `frontend/src/components/videos/review/video-review-panel.tsx` *(modify)* — rotation-aware theater + fullscreen pin drill-in, using the helpers.

---

## Task 1: Pure review-logic helpers

**Files:**
- Create: `frontend/src/components/videos/review/review-logic.ts`
- Test: `frontend/src/components/videos/review/review-logic.unit.test.ts`

- [ ] **Step 1: Write the failing unit test**

Create `frontend/src/components/videos/review/review-logic.unit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { effectiveTheater, resolvePinFocus } from "./review-logic";

describe("effectiveTheater", () => {
  it("is on when there is room and the pref is auto (null)", () => {
    expect(effectiveTheater(true, null)).toBe(true);
  });
  it("is off when there is no room, regardless of pref", () => {
    expect(effectiveTheater(false, null)).toBe(false);
    expect(effectiveTheater(false, true)).toBe(false);
  });
  it("an explicit pref overrides auto when there is room", () => {
    expect(effectiveTheater(true, false)).toBe(false);
    expect(effectiveTheater(true, true)).toBe(true);
  });
});

describe("resolvePinFocus", () => {
  it("in fullscreen, exit and force theater", () => {
    expect(resolvePinFocus(true)).toEqual({ exitFullscreen: true, forceTheater: true });
  });
  it("not in fullscreen, do neither", () => {
    expect(resolvePinFocus(false)).toEqual({ exitFullscreen: false, forceTheater: false });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm exec vitest run --project unit src/components/videos/review/review-logic.unit.test.ts`
Expected: FAIL — cannot resolve `./review-logic`.

- [ ] **Step 3: Implement the helpers**

Create `frontend/src/components/videos/review/review-logic.ts`:

```ts
/**
 * Whether the theater (comments-beside-video) layout should be shown.
 * `canTheater` reflects available room (landscape video + wide viewport).
 * `pref` is the user's explicit choice: `null` means auto (follow the room).
 */
export function effectiveTheater(canTheater: boolean, pref: boolean | null): boolean {
  return canTheater && (pref ?? true);
}

export interface PinFocusActions {
  /** Leave fullscreen so the feed (beside the video) is reachable. */
  exitFullscreen: boolean;
  /** Force the theater layout on so the focused thread is visible. */
  forceTheater: boolean;
}

/**
 * What to do when a timeline pin is focused. Tapping a pin in fullscreen drills
 * out to the theater layout and scrolls to the thread; outside fullscreen the
 * panel already shows the feed, so neither action is needed.
 */
export function resolvePinFocus(isFullscreen: boolean): PinFocusActions {
  return { exitFullscreen: isFullscreen, forceTheater: isFullscreen };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm exec vitest run --project unit src/components/videos/review/review-logic.unit.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/videos/review/review-logic.ts frontend/src/components/videos/review/review-logic.unit.test.ts
git commit -m "feat(videos): Pure review-logic helpers (theater + pin focus)"
```

---

## Task 2: Player context fullscreen channel

**Files:**
- Modify: `frontend/src/components/videos/player-context.tsx`
- Test: `frontend/src/components/videos/player-context.test.tsx` *(new)*

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/videos/player-context.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import {
  PlayerControllerProvider,
  usePlayerController,
  type PlayerRegistration,
} from "./player-context";

function Probe() {
  const c = usePlayerController();
  return (
    <button type="button" onClick={c.exitFullscreen}>
      {c.isFullscreen ? "fs-on" : "fs-off"}
    </button>
  );
}

describe("PlayerControllerProvider fullscreen channel", () => {
  it("reflects reported fullscreen state and forwards exitFullscreen", async () => {
    let reg: PlayerRegistration | null = null;
    const exit = vi.fn();

    render(
      <PlayerControllerProvider onReady={(r) => { reg = r; }}>
        <Probe />
      </PlayerControllerProvider>,
    );

    // Registered exit fn is invoked when the controller asks to exit.
    act(() => reg!.registerExitFullscreen(exit));
    expect(screen.getByRole("button").textContent).toBe("fs-off");

    act(() => reg!.reportFullscreen(true));
    expect(screen.getByRole("button").textContent).toBe("fs-on");

    screen.getByRole("button").click();
    expect(exit).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run (CI/Chromium only; locally it will fail to launch the browser — that is expected, verify by inspection):
`pnpm exec vitest run --project browser src/components/videos/player-context.test.tsx`
Expected (in CI): FAIL — `registerExitFullscreen`, `reportFullscreen`, `isFullscreen`, `exitFullscreen` do not exist.

- [ ] **Step 3: Add the fields to the interfaces**

In `frontend/src/components/videos/player-context.tsx`, extend the two interfaces:

```tsx
export interface PlayerController {
  currentTime: number;
  duration: number;
  paused: boolean;
  canReadTime: boolean;
  canSeek: boolean;
  seekTo: (seconds: number) => void;
  isFullscreen: boolean;
  exitFullscreen: () => void;
}

export interface PlayerRegistration {
  registerSeek: (fn: (seconds: number) => void) => void;
  reportProgress: (currentTime: number, duration: number) => void;
  reportPaused: (paused: boolean) => void;
  registerExitFullscreen: (fn: () => void) => void;
  reportFullscreen: (fullscreen: boolean) => void;
}
```

- [ ] **Step 4: Implement the provider state**

In `PlayerControllerProvider`, add state + ref alongside the existing ones:

```tsx
  const [isFullscreen, setIsFullscreen] = useState(false);
  const exitFsRef = useRef<(() => void) | null>(null);
```

Extend the `register` memo to include the two new methods:

```tsx
  const register = useMemo<PlayerRegistration>(() => ({
    registerSeek: (fn) => { seekRef.current = fn; setCanSeek(true); },
    reportProgress: (t, d) => { setCurrentTime(t); if (Number.isFinite(d)) setDuration(d); setCanReadTime(true); },
    reportPaused: (p) => setPaused(p),
    registerExitFullscreen: (fn) => { exitFsRef.current = fn; },
    reportFullscreen: (f) => setIsFullscreen(f),
  }), []);
```

Add the `exitFullscreen` callback next to `seekTo`:

```tsx
  const exitFullscreen = useCallback(() => { exitFsRef.current?.(); }, []);
```

Add both to the `value` memo (and its dependency array):

```tsx
  const value = useMemo<PlayerController>(
    () => ({ currentTime, duration, paused, canReadTime, canSeek, seekTo, isFullscreen, exitFullscreen }),
    [currentTime, duration, paused, canReadTime, canSeek, seekTo, isFullscreen, exitFullscreen],
  );
```

- [ ] **Step 5: Verify locally, then run the browser test in CI**

Local: `pnpm exec tsc -b` → expect no type errors.
CI: the browser test from Step 1 passes.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/videos/player-context.tsx frontend/src/components/videos/player-context.test.tsx
git commit -m "feat(videos): Add fullscreen channel to PlayerContext"
```

---

## Task 3: Vidstack fullscreen bridge

**Files:**
- Modify: `frontend/src/components/videos/player-events.ts`
- Modify: `frontend/src/components/videos/vidstack-player.tsx`

No new automated test: this is thin glue over the third-party player (consistent with the existing untested `vidstack-player.tsx`). Verified by typecheck + the manual steps in the final task. The decision logic it feeds is already covered by Task 1 and Task 2.

- [ ] **Step 1: Extend the bridge interface**

In `frontend/src/components/videos/player-events.ts`, add two optional members:

```ts
export interface PlayerEvents {
  onPlay?: () => void;
  onProgress?: (currentTime: number, duration: number) => void;
  onEnded?: () => void;
  onOpened?: () => void;
  /** Fired on play/pause transitions so the review surface can track state. */
  onPaused?: (paused: boolean) => void;
  /** Player hands up a seek function; absent for embeds that cannot seek. */
  registerSeek?: (fn: (seconds: number) => void) => void;
  /** Player hands up a fullscreen-exit function; absent for embeds. */
  registerExitFullscreen?: (fn: () => void) => void;
  /** Fired when the player enters/leaves fullscreen. */
  onFullscreenChange?: (fullscreen: boolean) => void;
}
```

- [ ] **Step 2: Register the exit function in VidstackPlayer**

In `frontend/src/components/videos/vidstack-player.tsx`, inside the existing effect that wires the player (the one that calls `events?.registerSeek?.(...)`), add the exit registration right after `registerSeek`:

```tsx
    events?.registerSeek?.((seconds) => {
      player.currentTime = Math.max(0, seconds);
    });
    events?.registerExitFullscreen?.(() => {
      player.exitFullscreen?.().catch(() => {});
    });
```

- [ ] **Step 3: Report fullscreen changes via a small child component**

`useMediaState` must run inside the `MediaPlayer` subtree. Add a reporter component at the bottom of `frontend/src/components/videos/vidstack-player.tsx` (near `FullscreenIcon`):

```tsx
function FullscreenReporter({ onChange }: { onChange?: (fullscreen: boolean) => void }) {
  const fullscreen = useMediaState("fullscreen");
  useEffect(() => {
    onChange?.(fullscreen);
  }, [fullscreen, onChange]);
  return null;
}
```

Ensure `useEffect` is imported (it already is). Then mount it inside `<MediaPlayer>`, just after `<MediaProvider />`:

```tsx
      <MediaProvider />
      <FullscreenReporter onChange={events?.onFullscreenChange} />
```

- [ ] **Step 4: Verify**

Run: `pnpm exec tsc -b`
Expected: no type errors.
Run: `pnpm lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/videos/player-events.ts frontend/src/components/videos/vidstack-player.tsx
git commit -m "feat(videos): Bridge vidstack fullscreen to PlayerEvents"
```

---

## Task 4: "Use current frame" composer button

**Files:**
- Modify: `frontend/src/components/videos/review/moment-composer.tsx`
- Test: `frontend/src/components/videos/review/moment-composer.test.tsx`

- [ ] **Step 1: Write the failing test**

Add these two tests inside the existing `describe("MomentComposer", ...)` block in `frontend/src/components/videos/review/moment-composer.test.tsx`:

```tsx
  it("re-grabs the stamp from the live playhead via use current frame", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <MomentComposer currentTime={10} duration={60} canStamp onSubmit={onSubmit} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /comment at 0:10/i }));
    // Playhead moves while the composer is open.
    rerender(<MomentComposer currentTime={55} duration={60} canStamp onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: /use current frame/i }));
    await userEvent.type(screen.getByRole("textbox"), "here");
    await userEvent.click(screen.getByRole("button", { name: /^post$/i }));
    expect(onSubmit).toHaveBeenCalledWith({ video_ts_seconds: 55, body: "here" });
  });

  it("hides use current frame when stamping is unavailable", async () => {
    render(<MomentComposer currentTime={0} duration={60} canStamp={false} onSubmit={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /comment on video/i }));
    expect(screen.queryByRole("button", { name: /use current frame/i })).toBeNull();
  });
```

- [ ] **Step 2: Run it to confirm it fails (CI/Chromium)**

Run: `pnpm exec vitest run --project browser src/components/videos/review/moment-composer.test.tsx`
Expected (in CI): FAIL — no "use current frame" button.

- [ ] **Step 3: Implement the button**

In `frontend/src/components/videos/review/moment-composer.tsx`, the expanded view currently shows the stamp row only `{stamp !== null && (...)}`. Add a "use current frame" control that is available whenever `canStamp`, even when the current stamp is `null` (so it can re-introduce a stamp). Place it in the expanded body, just below the existing stamp row block and above the `<Textarea>`:

```tsx
      {canStamp && (
        <button
          type="button"
          className="text-xs text-muted-foreground underline underline-offset-2"
          onClick={() => setStamp(Math.max(0, Math.floor(currentTime)))}
        >
          Use current frame
        </button>
      )}
```

(No edge-of-video guard here: the user is explicitly choosing the frame.)

- [ ] **Step 4: Run the test to confirm it passes (CI)**

Run: `pnpm exec vitest run --project browser src/components/videos/review/moment-composer.test.tsx`
Expected (in CI): PASS, including the existing tests.
Local gate: `pnpm exec tsc -b` clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/videos/review/moment-composer.tsx frontend/src/components/videos/review/moment-composer.test.tsx
git commit -m "feat(videos): Add 'use current frame' re-grab to the composer"
```

---

## Task 5: Rotation-aware theater + fullscreen pin drill-in in VideoReviewPanel

**Files:**
- Modify: `frontend/src/components/videos/review/video-review-panel.tsx`

No new automated test: the panel mounts the real vidstack player (signed-URL fetch + `<video>`), so it is not cheaply testable in isolation. All branching logic is in the Task 1 helpers and Task 2 context, which are tested. This task is the wiring; verify by typecheck + the manual steps below.

- [ ] **Step 1: Import the helpers**

At the top of `frontend/src/components/videos/review/video-review-panel.tsx`, add to the existing review-component imports:

```tsx
import { effectiveTheater, resolvePinFocus } from "./review-logic";
```

`useMediaQuery` is already imported.

- [ ] **Step 2: Wire the fullscreen channel into the events bridge**

The `events` memo in `ReviewInner` forwards registration methods to the player. Add the two fullscreen forwards so `VidstackPlayer`'s producer-side calls (Task 3) reach the context. Inside the `useMemo<PlayerEvents>` object (which already has `onProgress`, `onPaused`, `registerSeek`), add:

```tsx
      registerSeek: (fn) => registration?.registerSeek(fn),
      registerExitFullscreen: (fn) => registration?.registerExitFullscreen(fn),
      onFullscreenChange: (f) => registration?.reportFullscreen(f),
```

(The `registerSeek` line is shown for placement; it already exists. `registration` is already in the memo's dependency array.)

- [ ] **Step 3: Make the theater pref nullable and auto-following**

Replace the current theater state + derivation (the `theaterPref` / `theater` lines, currently around lines 48-49):

```tsx
  const [theaterPref, setTheaterPref] = useState(false);
  const theater = canTheater && theaterPref;
```

with:

```tsx
  const [theaterPref, setTheaterPref] = useState<boolean | null>(null);
  const theater = effectiveTheater(canTheater, theaterPref);

  // Re-apply auto whenever the device orientation flips, so rotating to
  // landscape lands in theater (room permitting) without a manual tap.
  const landscape = useMediaQuery("(orientation: landscape)");
  useEffect(() => {
    setTheaterPref(null);
  }, [landscape]);
```

- [ ] **Step 4: Point the toggle at the effective state**

In the `player` JSX, change the toggle handler (currently `onToggleTheater={() => setTheaterPref((t) => !t)}`) to set an explicit pref relative to the current effective state:

```tsx
      onToggleTheater={() => setTheaterPref(!theater)}
```

- [ ] **Step 5: Drill in from fullscreen on pin focus**

In `focusPin`, after the toggle-off early-return and before the seek/scroll, branch on the controller's fullscreen state using the helper. Replace the body that runs when setting a pin (the part after the `if (pinnedThread?.id === t.id) { ... return; }` block) with:

```tsx
    setPinnedThread(t);

    const actions = resolvePinFocus(controller.isFullscreen);
    if (actions.exitFullscreen) controller.exitFullscreen();
    if (actions.forceTheater) setTheaterPref(true);

    if (t.video_ts_seconds != null) controller.seekTo(t.video_ts_seconds);

    // Defer the scroll one frame so the row exists in the post-exit / post-
    // theater layout before scrollIntoView runs.
    requestAnimationFrame(() => scrollToThread(t.id));

    if (pinTimerRef.current) window.clearTimeout(pinTimerRef.current);
    pinTimerRef.current = window.setTimeout(() => setPinnedThread(null), 6000);
```

(`controller` already exposes `isFullscreen` and `exitFullscreen` from Task 2.)

- [ ] **Step 6: Verify locally**

Run: `pnpm exec tsc -b` → no type errors.
Run: `pnpm lint` → clean.

- [ ] **Step 7: Manual verification (record results in the commit / PR)**

Build and exercise on staging or a local dev run:
1. Portrait phone: comments stack below the video (no theater). Rotate to landscape on a landscape video: comments appear beside the video automatically.
2. In landscape, tap the columns toggle: comments stack; rotate away and back: comments are beside again (auto re-applies).
3. Enter fullscreen (Android/desktop): timeline pins are visible. Tap a pin: the player exits fullscreen, lands in theater, seeks to the pin, and the feed scrolls to + highlights that thread.
4. Desktop wide viewport: comments default to beside; the toggle stacks them.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/videos/review/video-review-panel.tsx
git commit -m "feat(videos): Rotation-aware theater + fullscreen pin drill-in"
```

---

## Task 6: Light visual tidy

**Files:**
- Modify (as needed, discretionary): `frontend/src/components/videos/review/scrubber-pins.tsx`, `moment-overlay.tsx`, `moment-feed.tsx`, `moment-composer.tsx`

Light, non-structural touch-ups only. No layout restructure, no renames, no behavior change. Keep each change small and justified.

- [ ] **Step 1: Review the four components for inconsistencies**

Read `scrubber-pins.tsx`, `moment-overlay.tsx`, `moment-feed.tsx`, `moment-composer.tsx`. Candidate touch-ups (apply only those that are clear improvements):
- Pin active state: the single-pin active style is `bg-white ring-2 ring-primary`; confirm the cluster pin gets a comparable active treatment (today the `active` class also applies to clusters — verify it reads well).
- Overlay: confirm the two-line clamp + text-shadow stays legible over bright video (no change unless it is visibly weak).
- Feed: confirm the highlight flash (`bg-primary/10 ring-1 ring-ring/50`) duration matches the 2200ms highlight timer in the panel and is not jarring.
- Composer: spacing of the new "use current frame" control relative to the stamp row.

- [ ] **Step 2: Apply touch-ups and verify**

Make the small edits. Then:
Run: `pnpm exec tsc -b` → no type errors.
Run: `pnpm lint` → clean.
Run: `pnpm exec vitest run --project unit` → existing unit tests pass.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/videos/review/
git commit -m "style(videos): Light visual tidy of the comment rail"
```

If no change is warranted after review, skip this task and note "no tidy needed" rather than inventing churn.

---

## Final verification (after all tasks)

- [ ] `pnpm exec tsc -b` clean.
- [ ] `pnpm lint` clean.
- [ ] `pnpm exec vitest run --project unit` passes (includes `review-logic.unit.test.ts`).
- [ ] In CI: `pnpm test` (browser project) passes, including `player-context.test.tsx` and the updated `moment-composer.test.tsx`.
- [ ] Manual checks from Task 5 Step 6 done.
- [ ] `just verify` (repo root) passes if run before pushing (frontend lint/build/test gate).

These changes are frontend-only; no `.sqlx` regeneration and no backend test impact.
