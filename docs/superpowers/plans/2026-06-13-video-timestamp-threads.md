# Video Comment Threads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let coaches and students read and post comments on a video, anchored to a specific second or to the whole video, in one unified player surface.

**Architecture:** A scoped `PlayerContext` is written by the native player (current time, paused, a seek handle) and read by four consumers: a live caption overlay, timeline pins, a lean composer, and a fullscreen side sheet. The threads backend already supports `video` and `video_timestamp` anchors; the only backend change is exposing `video_ts_seconds` on the read payload. Thread visibility is derived from surface + role, not chosen by the user.

**Tech Stack:** Rust + Rocket + sqlx (SQLite) backend; React 19 + Vite + shadcn/ui + Tailwind v4 frontend; TanStack Query; Vitest (browser mode, Chromium) for frontend tests.

**Spec:** `docs/superpowers/specs/2026-06-13-video-timestamp-threads-design.md`. Visual reference: `docs/superpowers/specs/2026-06-13-video-timestamp-threads-mocks.html`.

---

## Conventions for this plan

- **Backend tests** run with `nix develop .#ci --command cargo test -p syllabus-tracker <name>`. Never run bare `cargo sqlx prepare`; regenerate the query cache with `nix develop .#ci --command just sqlx-prepare` (see CLAUDE memory: sqlx-check is dropped from CI; the offline build is the gate).
- **Frontend tests** (`*.test.tsx`) run in Chromium on CI, **not** on this NixOS box. Write them, but do not expect to execute them locally. They stub `window.fetch` and use `renderWithProviders` + `buildUser` from `src/test/render.tsx`. Do not `vi.spyOn` ESM exports.
- **Frontend type/lint/build gate** (runnable locally): `cd frontend && npm run build` and `npm run lint`.
- **Commits:** Conventional Commits, imperative, scoped `feat(threads):` / `fix(threads):`. No `Co-Authored-By` trailer (project atomic-commits convention).
- **No em-dashes in UI copy** (project convention: use commas, periods, parens).

## Shared contracts (defined once, referenced by later tasks)

- Backend `ThreadView` gains `pub video_ts_seconds: Option<i64>`.
- Frontend `ThreadView` gains `video_ts_seconds: number | null`.
- `formatTimestamp(seconds: number): string` in `src/lib/dates.ts` → `"0:42"`, `"1:05"`, `"1:05:03"`.
- `VideoThreadSurface` (in `src/lib/thread-visibility.ts`):
  ```ts
  export type VideoThreadSurface =
    | { kind: "library" }
    | { kind: "student"; studentId: number };
  ```
- `deriveThreadVisibility(surface, user)` → `{ visibility: "broadcast" | "private"; scope_student_id: number | null }` (Task 4).
- `PlayerController` context shape (Task 3):
  ```ts
  export interface PlayerController {
    currentTime: number;
    duration: number;
    paused: boolean;
    canReadTime: boolean;
    canSeek: boolean;
    seekTo: (seconds: number) => void;
  }
  ```

---

## File structure

**Backend**
- Modify: `crates/syllabus-tracker/src/db/threads.rs` (add `video_ts_seconds` to `ThreadView` + `get_thread` select).
- Modify: `crates/syllabus-tracker/src/test/threads.rs` (assert it round-trips).
- Modify: `.sqlx/` cache (regenerated).

**Frontend, new**
- `src/lib/thread-visibility.ts` + `src/lib/thread-visibility.test.tsx`
- `src/components/videos/player-context.tsx` + `.test.tsx`
- `src/components/videos/review/video-review-panel.tsx`
- `src/components/videos/review/moment-composer.tsx` + `.test.tsx`
- `src/components/videos/review/moment-feed.tsx` + `.test.tsx`
- `src/components/videos/review/scrubber-pins.tsx` + `.test.tsx`
- `src/components/videos/review/moment-overlay.tsx` + `.test.tsx`
- `src/components/videos/review/moment-side-sheet.tsx`

**Frontend, modified**
- `src/lib/api.ts` (add `video_ts_seconds` to `ThreadView`)
- `src/lib/dates.ts` (add `formatTimestamp`) + `src/lib/dates.unit.test.ts`
- `src/components/videos/player-events.ts` (extend `PlayerEvents`)
- `src/components/videos/native-player.tsx` (report paused + register seek)
- `src/components/videos/video-player-dialog.tsx` (mount `VideoReviewPanel`, accept `surface`)
- `src/components/videos/video-list.tsx` (thread `surface` prop through)
- `src/components/technique-row/videos-block.tsx` (derive `surface` from row context)

---

## Task 1: Expose `video_ts_seconds` on the thread read payload

**Files:**
- Modify: `crates/syllabus-tracker/src/db/threads.rs` (struct `ThreadView` ~line 305; `get_thread` ~line 423)
- Test: `crates/syllabus-tracker/src/test/threads.rs`

- [ ] **Step 1: Write the failing test**

Add to `crates/syllabus-tracker/src/test/threads.rs` (match the existing helper style in that file; if a `create_thread` helper exists there, reuse it instead of the raw call below):

```rust
#[tokio::test]
async fn list_returns_video_ts_seconds_for_timestamp_threads() {
    let ctx = TestCtx::new().await; // existing harness in this module
    let coach = ctx.coach().await;
    let video_id = ctx.seed_technique_with_video().await; // existing helper

    // whole-video thread: seconds is None
    create_thread(
        &ctx.pool,
        NewThread {
            author_id: coach.id,
            body: "whole video note".into(),
            anchor: Anchor { kind: AnchorKind::Video, id: video_id, video_ts_seconds: None, pinned_student_id: None },
            visibility: ThreadVisibility::Broadcast,
            scope_student_id: None,
        },
    )
    .await
    .unwrap();

    // timestamped thread: seconds is Some(42)
    create_thread(
        &ctx.pool,
        NewThread {
            author_id: coach.id,
            body: "at 0:42".into(),
            anchor: Anchor { kind: AnchorKind::VideoTimestamp, id: video_id, video_ts_seconds: Some(42), pinned_student_id: None },
            visibility: ThreadVisibility::Broadcast,
            scope_student_id: None,
        },
    )
    .await
    .unwrap();

    let viewer = Viewer { user_id: coach.id, is_coach: true };
    let threads = list_threads_for_anchor(
        &ctx.pool,
        Anchor { kind: AnchorKind::Video, id: video_id, video_ts_seconds: None, pinned_student_id: None },
        viewer,
    )
    .await
    .unwrap();

    // ordered by COALESCE(video_ts_seconds, 0): whole-video (0) first, then 42
    assert_eq!(threads.len(), 2);
    assert_eq!(threads[0].video_ts_seconds, None);
    assert_eq!(threads[1].video_ts_seconds, Some(42));
}
```

> If the test harness names differ (`TestCtx`, `seed_technique_with_video`, `coach()`), open `crates/syllabus-tracker/src/test/threads.rs`, copy the setup from the nearest existing `#[tokio::test]`, and adapt. The three assertions are the point.

- [ ] **Step 2: Run it, confirm it fails to compile**

Run: `nix develop .#ci --command cargo test -p syllabus-tracker list_returns_video_ts_seconds`
Expected: compile error, `no field video_ts_seconds on type ThreadView`.

- [ ] **Step 3: Add the field to `ThreadView`**

In `crates/syllabus-tracker/src/db/threads.rs`, add to the `ThreadView` struct (after `scope_student_id`):

```rust
    pub scope_student_id: Option<i64>,
    /// Anchor seconds for `video_timestamp` threads; `None` for every other
    /// anchor kind (including whole-video `video` threads).
    pub video_ts_seconds: Option<i64>,
```

- [ ] **Step 4: Select and populate it in `get_thread`**

In the `get_thread` query, add the column to the `SELECT` list (after `t.scope_student_id ...`):

```rust
                  t.scope_student_id AS "scope_student_id?: i64",
                  t.video_ts_seconds AS "video_ts_seconds?: i64",
                  t.body,
```

And in the returned `ThreadView { ... }` literal (after `scope_student_id: row.scope_student_id,`):

```rust
        scope_student_id: row.scope_student_id,
        video_ts_seconds: row.video_ts_seconds,
```

(`list_threads_for_anchor` builds its results by calling `get_thread` per id, so this one change covers both read paths.)

- [ ] **Step 5: Regenerate the sqlx cache**

Run: `nix develop .#ci --command just sqlx-prepare`
Expected: `.sqlx/` updated for the changed `get_thread` query.

- [ ] **Step 6: Run the test, confirm it passes**

Run: `nix develop .#ci --command cargo test -p syllabus-tracker list_returns_video_ts_seconds`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add crates/syllabus-tracker/src/db/threads.rs crates/syllabus-tracker/src/test/threads.rs .sqlx
git commit -m "feat(threads): Expose video_ts_seconds on the thread read payload"
```

---

## Task 2: Frontend types + `formatTimestamp` helper

**Files:**
- Modify: `frontend/src/lib/api.ts` (`ThreadView` interface ~line 1915)
- Modify: `frontend/src/lib/dates.ts`
- Test: `frontend/src/lib/dates.unit.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/lib/dates.unit.test.ts`:

```ts
import { formatTimestamp } from "./dates";

describe("formatTimestamp", () => {
  it("formats seconds under a minute", () => {
    expect(formatTimestamp(0)).toBe("0:00");
    expect(formatTimestamp(42)).toBe("0:42");
  });
  it("formats minutes:seconds", () => {
    expect(formatTimestamp(65)).toBe("1:05");
    expect(formatTimestamp(605)).toBe("10:05");
  });
  it("formats hours:minutes:seconds past an hour", () => {
    expect(formatTimestamp(3903)).toBe("1:05:03");
  });
  it("floors fractional seconds and clamps negatives to zero", () => {
    expect(formatTimestamp(42.9)).toBe("0:42");
    expect(formatTimestamp(-5)).toBe("0:00");
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd frontend && npx vitest run src/lib/dates.unit.test.ts`
Expected: FAIL, `formatTimestamp is not a function`.

- [ ] **Step 3: Implement `formatTimestamp`**

Append to `frontend/src/lib/dates.ts`:

```ts
/**
 * Format a video offset in seconds as a compact timestamp: "0:42", "1:05",
 * or "1:05:03" once past an hour. Floors fractional seconds, clamps negatives.
 */
export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  if (h > 0) {
    const mm = String(m).padStart(2, "0");
    return `${h}:${mm}:${ss}`;
  }
  return `${m}:${ss}`;
}
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `cd frontend && npx vitest run src/lib/dates.unit.test.ts`
Expected: PASS. (`*.unit.test.ts` runs in node, executable on this box.)

- [ ] **Step 5: Add `video_ts_seconds` to the `ThreadView` interface**

In `frontend/src/lib/api.ts`, add to `interface ThreadView` (after `scope_student_id`):

```ts
  scope_student_id: number | null;
  /** Anchor seconds for video_timestamp threads; null otherwise. */
  video_ts_seconds: number | null;
  body: string | null;
```

- [ ] **Step 6: Type-check**

Run: `cd frontend && npm run build`
Expected: build succeeds (no consumers break; the field is additive).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/dates.ts frontend/src/lib/dates.unit.test.ts
git commit -m "feat(threads): Add video_ts_seconds type and formatTimestamp helper"
```

---

## Task 3: PlayerContext + player event/seek plumbing

**Files:**
- Create: `frontend/src/components/videos/player-context.tsx`
- Test: `frontend/src/components/videos/player-context.test.tsx`
- Modify: `frontend/src/components/videos/player-events.ts`
- Modify: `frontend/src/components/videos/native-player.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/videos/player-context.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  PlayerControllerProvider,
  usePlayerController,
} from "./player-context";

function Probe() {
  const c = usePlayerController();
  return (
    <div>
      <span data-testid="time">{c.currentTime}</span>
      <span data-testid="canSeek">{String(c.canSeek)}</span>
      <button onClick={() => c.seekTo(42)}>seek</button>
    </div>
  );
}

describe("PlayerController", () => {
  it("defaults to inert (no seek capability) until a seek handle registers", () => {
    render(
      <PlayerControllerProvider>
        <Probe />
      </PlayerControllerProvider>,
    );
    expect(screen.getByTestId("canSeek").textContent).toBe("false");
    expect(screen.getByTestId("time").textContent).toBe("0");
  });

  it("routes seekTo to the registered handle and exposes reported time", async () => {
    const seekSpy = vi.fn();
    let api: ReturnType<typeof captureApi> | null = null;
    function captureApi() {
      // grab the imperative registration API exposed for players
      return null;
    }
    render(
      <PlayerControllerProvider
        onReady={(register) => {
          register.registerSeek(seekSpy);
          register.reportProgress(42, 100);
        }}
      >
        <Probe />
      </PlayerControllerProvider>,
    );
    expect(screen.getByTestId("time").textContent).toBe("42");
    expect(screen.getByTestId("canSeek").textContent).toBe("true");
    await userEvent.click(screen.getByText("seek"));
    expect(seekSpy).toHaveBeenCalledWith(42);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd frontend && npx vitest run src/components/videos/player-context.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the context**

Create `frontend/src/components/videos/player-context.tsx`:

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface PlayerController {
  currentTime: number;
  duration: number;
  paused: boolean;
  canReadTime: boolean;
  canSeek: boolean;
  seekTo: (seconds: number) => void;
}

/** Imperative surface a player registers with on mount. */
export interface PlayerRegistration {
  registerSeek: (fn: (seconds: number) => void) => void;
  reportProgress: (currentTime: number, duration: number) => void;
  reportPaused: (paused: boolean) => void;
}

const Ctx = createContext<PlayerController | null>(null);

export function usePlayerController(): PlayerController {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error(
      "usePlayerController() must be used inside <PlayerControllerProvider>.",
    );
  }
  return ctx;
}

interface ProviderProps {
  children: ReactNode;
  /** Called once so a player (or a test) can register its imperative hooks. */
  onReady?: (register: PlayerRegistration) => void;
}

export function PlayerControllerProvider({ children, onReady }: ProviderProps) {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [paused, setPaused] = useState(true);
  const [canReadTime, setCanReadTime] = useState(false);
  const seekRef = useRef<((s: number) => void) | null>(null);
  const [canSeek, setCanSeek] = useState(false);

  const register = useMemo<PlayerRegistration>(
    () => ({
      registerSeek: (fn) => {
        seekRef.current = fn;
        setCanSeek(true);
      },
      reportProgress: (t, d) => {
        setCurrentTime(t);
        if (Number.isFinite(d)) setDuration(d);
        setCanReadTime(true);
      },
      reportPaused: (p) => setPaused(p),
    }),
    [],
  );

  // Fire onReady exactly once.
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    onReady?.(register);
  }, [onReady, register]);

  const seekTo = useCallback((seconds: number) => {
    seekRef.current?.(Math.max(0, seconds));
  }, []);

  const value = useMemo<PlayerController>(
    () => ({ currentTime, duration, paused, canReadTime, canSeek, seekTo }),
    [currentTime, duration, paused, canReadTime, canSeek, seekTo],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <PlayerRegistrationBridge register={register} />
    </Ctx.Provider>
  );
}

/**
 * Lets descendant players reach the registration API without prop-drilling:
 * a player calls `usesPlayerRegistration()` and wires its <video> element.
 */
const RegistrationCtx = createContext<PlayerRegistration | null>(null);
function PlayerRegistrationBridge({
  register,
}: {
  register: PlayerRegistration;
}) {
  return null; // registration is provided via the hook below
}

export function PlayerRegistrationProvider({
  register,
  children,
}: {
  register: PlayerRegistration;
  children: ReactNode;
}) {
  return (
    <RegistrationCtx.Provider value={register}>
      {children}
    </RegistrationCtx.Provider>
  );
}

export function usePlayerRegistration(): PlayerRegistration | null {
  return useContext(RegistrationCtx);
}
```

> Note: the provider both exposes `onReady(register)` (used by tests and simple cases) and a `RegistrationCtx` (used by the real `NativePlayer` so it can register from inside the `video.kind` switch). `VideoReviewPanel` (Task 9) wraps children in `PlayerRegistrationProvider` with the same `register` object. To make that available, refactor the provider to lift `register` and pass it both to `onReady` and into a single `RegistrationCtx.Provider`. Simplify the two bridge stubs into that one provider when you write Task 9; for now the `onReady` path satisfies the test.

- [ ] **Step 4: Run the test, confirm it passes**

Run: `cd frontend && npx vitest run src/components/videos/player-context.test.tsx`
Expected: PASS. (Runs in Chromium on CI; if it cannot run on this box, confirm via type-check in Step 7 and rely on CI.)

- [ ] **Step 5: Extend `PlayerEvents`**

In `frontend/src/components/videos/player-events.ts`:

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
}
```

- [ ] **Step 6: Wire `NativePlayer` to report pause + register seek**

In `frontend/src/components/videos/native-player.tsx`, inside the component, after the existing refs:

```tsx
  // Hand a seek function up to whoever is listening (the review surface).
  useEffect(() => {
    events?.registerSeek?.((seconds) => {
      const el = videoRef.current;
      if (el) el.currentTime = Math.max(0, seconds);
    });
  }, [events]);
```

And add handlers to the `<video>` element:

```tsx
      onPlay={() => {
        events?.onPaused?.(false);
        if (!startedRef.current) {
          startedRef.current = true;
          events?.onPlay?.();
        }
      }}
      onPause={() => events?.onPaused?.(true)}
```

(Leave `onTimeUpdate`/`onEnded` as they are.)

- [ ] **Step 7: Type-check**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/videos/player-context.tsx frontend/src/components/videos/player-context.test.tsx frontend/src/components/videos/player-events.ts frontend/src/components/videos/native-player.tsx
git commit -m "feat(threads): Add PlayerController context and seek plumbing"
```

---

## Task 4: Thread visibility derivation (pure function)

**Files:**
- Create: `frontend/src/lib/thread-visibility.ts`
- Test: `frontend/src/lib/thread-visibility.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/thread-visibility.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { deriveThreadVisibility } from "./thread-visibility";
import { buildUser } from "@/test/render";

const coach = buildUser({ id: 1, role: "coach" });
const student = buildUser({ id: 9, role: "student" });

describe("deriveThreadVisibility", () => {
  it("coach on the global library starts a broadcast thread", () => {
    expect(deriveThreadVisibility({ kind: "library" }, coach)).toEqual({
      visibility: "broadcast",
      scope_student_id: null,
    });
  });

  it("coach on a student surface scopes the thread to that student", () => {
    expect(
      deriveThreadVisibility({ kind: "student", studentId: 9 }, coach),
    ).toEqual({ visibility: "private", scope_student_id: 9 });
  });

  it("a student always posts privately scoped to themselves (library)", () => {
    expect(deriveThreadVisibility({ kind: "library" }, student)).toEqual({
      visibility: "private",
      scope_student_id: 9,
    });
  });

  it("a student always posts privately scoped to themselves (student surface)", () => {
    expect(
      deriveThreadVisibility({ kind: "student", studentId: 9 }, student),
    ).toEqual({ visibility: "private", scope_student_id: 9 });
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd frontend && npx vitest run src/lib/thread-visibility.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Create `frontend/src/lib/thread-visibility.ts`:

```ts
import type { User } from "@/lib/api";
import type { ThreadVisibility } from "@/lib/api";

/**
 * Which surface a video player was opened on, as far as thread visibility is
 * concerned. Only one bit matters: is there a specific student in context.
 *  - library: global library or coach syllabus authoring (no student)
 *  - student: a student's pinned or syllabus view of the technique
 */
export type VideoThreadSurface =
  | { kind: "library" }
  | { kind: "student"; studentId: number };

export interface DerivedVisibility {
  visibility: ThreadVisibility;
  scope_student_id: number | null;
}

/**
 * Derive a new thread's visibility from the surface and the author's role.
 * Students always post privately scoped to themselves. Coaches broadcast on
 * the library (an announcement to everyone who can see the video) and post
 * privately scoped to the student on a student surface. Replies are not
 * covered here; they inherit the parent thread's visibility server-side.
 */
export function deriveThreadVisibility(
  surface: VideoThreadSurface,
  user: User,
): DerivedVisibility {
  if (user.role === "student") {
    return { visibility: "private", scope_student_id: user.id };
  }
  if (surface.kind === "student") {
    return { visibility: "private", scope_student_id: surface.studentId };
  }
  return { visibility: "broadcast", scope_student_id: null };
}
```

> If `User` is not exported from `@/lib/api`, import it from wherever `buildUser` returns it (`src/test/render.tsx` imports the `User` type already; follow that import).

- [ ] **Step 4: Run the test, confirm it passes**

Run: `cd frontend && npx vitest run src/lib/thread-visibility.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/thread-visibility.ts frontend/src/lib/thread-visibility.test.tsx
git commit -m "feat(threads): Derive video thread visibility from surface and role"
```

---

## Task 5: MomentComposer (collapsed + expanded)

**Files:**
- Create: `frontend/src/components/videos/review/moment-composer.tsx`
- Test: `frontend/src/components/videos/review/moment-composer.test.tsx`

Behavior: collapsed shows a single `+ Comment at 0:42` button. Tapping pauses (calls `onCaptureStart`), expands. Expanded shows the stamp, `-`/`+` nudge, `x whole video` clear, a textarea, Cancel/Post. On Post it calls `onSubmit({ video_ts_seconds, body })` where `video_ts_seconds` is the (nudged) seconds or `null` if cleared.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/videos/review/moment-composer.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MomentComposer } from "./moment-composer";

describe("MomentComposer", () => {
  it("collapsed shows the capture button with the current timestamp", () => {
    render(
      <MomentComposer currentTime={42} canStamp onSubmit={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /comment at 0:42/i })).toBeTruthy();
  });

  it("posts a timestamped comment with the captured seconds", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<MomentComposer currentTime={42} canStamp onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: /comment at 0:42/i }));
    await userEvent.type(screen.getByRole("textbox"), "hand too low");
    await userEvent.click(screen.getByRole("button", { name: /^post$/i }));
    expect(onSubmit).toHaveBeenCalledWith({ video_ts_seconds: 42, body: "hand too low" });
  });

  it("clear posts a whole-video comment (null seconds)", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<MomentComposer currentTime={42} canStamp onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: /comment at 0:42/i }));
    await userEvent.click(screen.getByRole("button", { name: /whole video/i }));
    await userEvent.type(screen.getByRole("textbox"), "good rep");
    await userEvent.click(screen.getByRole("button", { name: /^post$/i }));
    expect(onSubmit).toHaveBeenCalledWith({ video_ts_seconds: null, body: "good rep" });
  });

  it("nudges the stamp by one second", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<MomentComposer currentTime={42} canStamp onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: /comment at 0:42/i }));
    await userEvent.click(screen.getByRole("button", { name: /nudge forward/i }));
    await userEvent.type(screen.getByRole("textbox"), "x");
    await userEvent.click(screen.getByRole("button", { name: /^post$/i }));
    expect(onSubmit).toHaveBeenCalledWith({ video_ts_seconds: 43, body: "x" });
  });

  it("without canStamp, posts whole-video only (no capture button)", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<MomentComposer currentTime={0} canStamp={false} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: /add a comment/i }));
    await userEvent.type(screen.getByRole("textbox"), "embed note");
    await userEvent.click(screen.getByRole("button", { name: /^post$/i }));
    expect(onSubmit).toHaveBeenCalledWith({ video_ts_seconds: null, body: "embed note" });
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd frontend && npx vitest run src/components/videos/review/moment-composer.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Create `frontend/src/components/videos/review/moment-composer.tsx`:

```tsx
import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatTimestamp } from "@/lib/dates";

export interface MomentDraft {
  video_ts_seconds: number | null;
  body: string;
}

interface MomentComposerProps {
  /** Live playhead seconds (from PlayerController). */
  currentTime: number;
  /** False for embeds that cannot report a playhead. */
  canStamp: boolean;
  /** Called when the composer expands, so the surface can pause playback. */
  onCaptureStart?: () => void;
  onSubmit: (draft: MomentDraft) => Promise<void>;
  pending?: boolean;
}

export function MomentComposer({
  currentTime,
  canStamp,
  onCaptureStart,
  onSubmit,
  pending = false,
}: MomentComposerProps) {
  const [open, setOpen] = useState(false);
  const [stamp, setStamp] = useState<number | null>(null);
  const [body, setBody] = useState("");

  function expand() {
    setStamp(canStamp ? Math.floor(currentTime) : null);
    setBody("");
    setOpen(true);
    onCaptureStart?.();
  }

  function collapse() {
    setOpen(false);
    setBody("");
  }

  async function post() {
    const trimmed = body.trim();
    if (!trimmed) return;
    await onSubmit({ video_ts_seconds: stamp, body: trimmed });
    collapse();
  }

  if (!open) {
    return (
      <div className="border-y border-border p-3">
        <button
          type="button"
          onClick={expand}
          className="flex w-full items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-left text-sm text-muted-foreground hover:bg-muted/60"
        >
          {canStamp ? (
            <>
              <Plus className="h-4 w-4 text-violet-500" />
              <span>
                Comment at{" "}
                <span className="font-semibold tabular-nums text-violet-500">
                  {formatTimestamp(currentTime)}
                </span>
              </span>
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" />
              <span>Add a comment</span>
            </>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2 border-y border-border bg-card p-3">
      {stamp !== null && (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-1 text-xs font-semibold tabular-nums text-violet-500">
            ▶ {formatTimestamp(stamp)}
          </span>
          <div className="flex gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-6 w-6"
              aria-label="nudge back"
              onClick={() => setStamp((s) => Math.max(0, (s ?? 0) - 1))}
            >
              <Minus className="h-3 w-3" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-6 w-6"
              aria-label="nudge forward"
              onClick={() => setStamp((s) => (s ?? 0) + 1)}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
          <button
            type="button"
            className="ml-auto text-xs text-muted-foreground underline underline-offset-2"
            onClick={() => setStamp(null)}
          >
            × whole video
          </button>
        </div>
      )}
      <Textarea
        autoFocus
        rows={2}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={
          stamp !== null
            ? `What did you notice at ${formatTimestamp(stamp)}?`
            : "Comment on the whole video…"
        }
        className="min-h-[46px]"
        disabled={pending}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={collapse} disabled={pending}>
          Cancel
        </Button>
        <Button type="button" onClick={post} disabled={pending || !body.trim()}>
          {pending ? "Posting…" : "Post"}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `cd frontend && npx vitest run src/components/videos/review/moment-composer.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/videos/review/moment-composer.tsx frontend/src/components/videos/review/moment-composer.test.tsx
git commit -m "feat(threads): Add MomentComposer for timestamped and whole-video comments"
```

---

## Task 6: MomentFeed (mixed list, chip vs whole-video, seek on click)

**Files:**
- Create: `frontend/src/components/videos/review/moment-feed.tsx`
- Test: `frontend/src/components/videos/review/moment-feed.test.tsx`

Behavior: renders a `ThreadView[]`. A thread with `video_ts_seconds != null` shows a clickable `▶ 0:42` chip that calls `onSeek(seconds)`; a thread with `null` shows a muted `whole video` tag. Each row wraps the existing `ThreadView` component for body + replies. Rows carry `data-thread-id` and `data-ts-seconds` for the pin/overlay to scroll-highlight (reuse the highlight pattern from `discussion-block.tsx`).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/videos/review/moment-feed.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, buildUser } from "@/test/render";
import { MomentFeed } from "./moment-feed";
import type { ThreadView } from "@/lib/api";

function thread(over: Partial<ThreadView>): ThreadView {
  return {
    id: 1,
    anchor_kind: "video_timestamp",
    author_id: 5,
    author_name: "Sam R.",
    visibility: "private",
    scope_student_id: 5,
    video_ts_seconds: 42,
    body: "hand too low",
    created_at: new Date().toISOString(),
    deleted_at: null,
    comments: [],
    ...over,
  };
}

describe("MomentFeed", () => {
  it("renders a timestamp chip for timestamped threads", () => {
    renderWithProviders(
      <MomentFeed
        videoId={7}
        threads={[thread({})]}
        onSeek={vi.fn()}
        highlightThreadId={null}
      />,
      { user: buildUser({ role: "coach" }) },
    );
    expect(screen.getByRole("button", { name: /0:42/ })).toBeTruthy();
  });

  it("renders a whole-video tag for null-seconds threads", () => {
    renderWithProviders(
      <MomentFeed
        videoId={7}
        threads={[thread({ id: 2, anchor_kind: "video", video_ts_seconds: null })]}
        onSeek={vi.fn()}
        highlightThreadId={null}
      />,
      { user: buildUser({ role: "coach" }) },
    );
    expect(screen.getByText(/whole video/i)).toBeTruthy();
  });

  it("clicking the chip seeks to the thread's seconds", async () => {
    const onSeek = vi.fn();
    renderWithProviders(
      <MomentFeed videoId={7} threads={[thread({})]} onSeek={onSeek} highlightThreadId={null} />,
      { user: buildUser({ role: "coach" }) },
    );
    await userEvent.click(screen.getByRole("button", { name: /0:42/ }));
    expect(onSeek).toHaveBeenCalledWith(42);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd frontend && npx vitest run src/components/videos/review/moment-feed.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Create `frontend/src/components/videos/review/moment-feed.tsx`:

```tsx
import { ThreadView as ThreadViewComponent } from "@/components/threads/thread-view";
import { formatTimestamp } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { ThreadView } from "@/lib/api";

interface MomentFeedProps {
  videoId: number;
  threads: ThreadView[];
  onSeek: (seconds: number) => void;
  highlightThreadId: number | null;
}

export function MomentFeed({
  videoId,
  threads,
  onSeek,
  highlightThreadId,
}: MomentFeedProps) {
  if (threads.length === 0) {
    return (
      <p className="p-3 text-sm text-muted-foreground">No discussion yet.</p>
    );
  }
  return (
    <div className="divide-y divide-border">
      {threads.map((t) => {
        const anchorKind = t.video_ts_seconds != null ? "video_timestamp" : "video";
        return (
          <div
            key={t.id}
            data-thread-id={t.id}
            data-ts-seconds={t.video_ts_seconds ?? ""}
            className={cn(
              "p-3 transition-colors",
              highlightThreadId === t.id && "bg-violet-500/10 ring-1 ring-ring/50",
            )}
          >
            <div className="mb-1.5">
              {t.video_ts_seconds != null ? (
                <button
                  type="button"
                  onClick={() => onSeek(t.video_ts_seconds as number)}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-violet-500 hover:bg-muted/70"
                >
                  ▶ {formatTimestamp(t.video_ts_seconds)}
                </button>
              ) : (
                <span className="text-[11px] text-muted-foreground">whole video</span>
              )}
            </div>
            <ThreadViewComponent thread={t} anchorKind={anchorKind} anchorId={videoId} />
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `cd frontend && npx vitest run src/components/videos/review/moment-feed.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/videos/review/moment-feed.tsx frontend/src/components/videos/review/moment-feed.test.tsx
git commit -m "feat(threads): Add MomentFeed mixing timestamped and whole-video threads"
```

---

## Task 7: ScrubberPins (timeline dots, clustering, seek + highlight)

**Files:**
- Create: `frontend/src/components/videos/review/scrubber-pins.tsx`
- Test: `frontend/src/components/videos/review/scrubber-pins.test.tsx`

Behavior: given timestamped threads + `duration`, render one pin per thread positioned at `seconds/duration`. Pins whose positions fall within a cluster gap merge into one count dot. Clicking a (single) pin calls `onPinClick(thread)`; clicking a cluster calls `onClusterClick(threads)`. Each pin sits in a ~30px hit box. The active thread's pin gets an `active` style.

Pure helper `clusterPins(threads, duration, gapFraction)` is extracted and unit-tested so the geometry is verifiable without DOM.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/videos/review/scrubber-pins.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { clusterPins, ScrubberPins } from "./scrubber-pins";
import type { ThreadView } from "@/lib/api";

function t(id: number, secs: number): ThreadView {
  return {
    id,
    anchor_kind: "video_timestamp",
    author_id: 1,
    author_name: "x",
    visibility: "broadcast",
    scope_student_id: null,
    video_ts_seconds: secs,
    body: "b",
    created_at: "",
    deleted_at: null,
    comments: [],
  };
}

describe("clusterPins", () => {
  it("merges pins closer than the gap, keeps far ones separate", () => {
    const groups = clusterPins([t(1, 10), t(2, 11), t(3, 80)], 100, 0.05);
    expect(groups).toHaveLength(2);
    expect(groups[0].threads.map((x) => x.id)).toEqual([1, 2]);
    expect(groups[1].threads.map((x) => x.id)).toEqual([3]);
  });
  it("ignores threads without seconds or with zero duration", () => {
    expect(clusterPins([t(1, 10)], 0, 0.05)).toHaveLength(0);
  });
});

describe("ScrubberPins", () => {
  it("clicking a single pin invokes onPinClick with its thread", async () => {
    const onPinClick = vi.fn();
    render(
      <ScrubberPins
        threads={[t(1, 30)]}
        duration={100}
        activeThreadId={null}
        onPinClick={onPinClick}
        onClusterClick={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /moment at 0:30/i }));
    expect(onPinClick).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd frontend && npx vitest run src/components/videos/review/scrubber-pins.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Create `frontend/src/components/videos/review/scrubber-pins.tsx`:

```tsx
import { formatTimestamp } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { ThreadView } from "@/lib/api";

export interface PinGroup {
  /** Position along the track, 0..1. */
  position: number;
  threads: ThreadView[];
}

/**
 * Group timestamped threads into pins, merging any whose track positions are
 * within `gapFraction` of each other (so dense moments do not overlap).
 * Threads without seconds, and any input when duration <= 0, yield no pins.
 */
export function clusterPins(
  threads: ThreadView[],
  duration: number,
  gapFraction: number,
): PinGroup[] {
  if (duration <= 0) return [];
  const stamped = threads
    .filter((t) => t.video_ts_seconds != null)
    .map((t) => ({ t, pos: (t.video_ts_seconds as number) / duration }))
    .sort((a, b) => a.pos - b.pos);

  const groups: PinGroup[] = [];
  for (const { t, pos } of stamped) {
    const last = groups[groups.length - 1];
    if (last && pos - last.position <= gapFraction) {
      last.threads.push(t);
    } else {
      groups.push({ position: pos, threads: [t] });
    }
  }
  return groups;
}

interface ScrubberPinsProps {
  threads: ThreadView[];
  duration: number;
  activeThreadId: number | null;
  onPinClick: (thread: ThreadView) => void;
  onClusterClick: (threads: ThreadView[]) => void;
}

export function ScrubberPins({
  threads,
  duration,
  activeThreadId,
  onPinClick,
  onClusterClick,
}: ScrubberPinsProps) {
  const groups = clusterPins(threads, duration, 0.04);
  return (
    <div className="pointer-events-none absolute inset-x-2 bottom-2 h-1">
      {groups.map((g, i) => {
        const isCluster = g.threads.length > 1;
        const active =
          activeThreadId != null && g.threads.some((t) => t.id === activeThreadId);
        const label = isCluster
          ? `${g.threads.length} moments`
          : `moment at ${formatTimestamp(g.threads[0].video_ts_seconds as number)}`;
        return (
          <button
            key={i}
            type="button"
            aria-label={label}
            onClick={() =>
              isCluster ? onClusterClick(g.threads) : onPinClick(g.threads[0])
            }
            style={{ left: `${g.position * 100}%` }}
            className="pointer-events-auto absolute -top-3.5 flex h-7 w-7 -translate-x-1/2 items-center justify-center"
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
}
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `cd frontend && npx vitest run src/components/videos/review/scrubber-pins.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/videos/review/scrubber-pins.tsx frontend/src/components/videos/review/scrubber-pins.test.tsx
git commit -m "feat(threads): Add ScrubberPins with clustering and seek"
```

---

## Task 8: MomentOverlay (live caption window)

**Files:**
- Create: `frontend/src/components/videos/review/moment-overlay.tsx`
- Test: `frontend/src/components/videos/review/moment-overlay.test.tsx`

Behavior: a pure selector `activeMoment(threads, currentTime, leadIn=3, leadOut=3)` returns the timestamped thread whose window `[t-leadIn, t+leadOut]` contains `currentTime` (nearest to `currentTime` if several). The component renders the caption (avatar + name + stamp + 2-line-clamped body) when a moment is active, and calls `onOpen(thread)` when tapped. When no moment is active or `pinnedThread` is set (a pin was tapped) it shows that instead.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/videos/review/moment-overlay.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { activeMoment, MomentOverlay } from "./moment-overlay";
import type { ThreadView } from "@/lib/api";

function t(id: number, secs: number, body: string): ThreadView {
  return {
    id, anchor_kind: "video_timestamp", author_id: 1, author_name: "Sam R.",
    visibility: "broadcast", scope_student_id: null, video_ts_seconds: secs,
    body, created_at: "", deleted_at: null, comments: [],
  };
}

describe("activeMoment", () => {
  const threads = [t(1, 42, "low hand"), t(2, 120, "good finish")];
  it("returns the moment whose window contains the current time", () => {
    expect(activeMoment(threads, 44)?.id).toBe(1); // within 42 +/- 3
  });
  it("returns null outside every window", () => {
    expect(activeMoment(threads, 80)).toBeNull();
  });
  it("picks the nearest when two windows overlap", () => {
    const overlap = [t(1, 42, "a"), t(2, 45, "b")];
    expect(activeMoment(overlap, 44)?.id).toBe(2); // |44-45| < |44-42|
  });
});

describe("MomentOverlay", () => {
  it("renders the active moment and opens it on tap", async () => {
    const onOpen = vi.fn();
    render(
      <MomentOverlay
        threads={[t(1, 42, "low hand")]}
        currentTime={43}
        pinnedThread={null}
        onOpen={onOpen}
      />,
    );
    expect(screen.getByText("low hand")).toBeTruthy();
    await userEvent.click(screen.getByText("low hand"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it("renders nothing when no moment is active and none pinned", () => {
    const { container } = render(
      <MomentOverlay threads={[t(1, 42, "x")]} currentTime={80} pinnedThread={null} onOpen={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd frontend && npx vitest run src/components/videos/review/moment-overlay.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Create `frontend/src/components/videos/review/moment-overlay.tsx`:

```tsx
import { StudentAvatar } from "@/components/student-avatar";
import { formatTimestamp } from "@/lib/dates";
import type { ThreadView } from "@/lib/api";

const LEAD_IN = 3;
const LEAD_OUT = 3;

/**
 * The timestamped thread whose display window [t-LEAD_IN, t+LEAD_OUT] contains
 * `currentTime`. When several overlap, the one whose anchor is nearest to
 * `currentTime` wins. Returns null when none are active.
 */
export function activeMoment(
  threads: ThreadView[],
  currentTime: number,
  leadIn = LEAD_IN,
  leadOut = LEAD_OUT,
): ThreadView | null {
  let best: ThreadView | null = null;
  let bestDist = Infinity;
  for (const t of threads) {
    if (t.video_ts_seconds == null) continue;
    const s = t.video_ts_seconds;
    if (currentTime >= s - leadIn && currentTime <= s + leadOut) {
      const dist = Math.abs(currentTime - s);
      if (dist < bestDist) {
        best = t;
        bestDist = dist;
      }
    }
  }
  return best;
}

interface MomentOverlayProps {
  threads: ThreadView[];
  currentTime: number;
  /** A pin/feed selection forces this thread to show, overriding the window. */
  pinnedThread: ThreadView | null;
  onOpen: (thread: ThreadView) => void;
}

export function MomentOverlay({
  threads,
  currentTime,
  pinnedThread,
  onOpen,
}: MomentOverlayProps) {
  const moment = pinnedThread ?? activeMoment(threads, currentTime);
  if (!moment || moment.body == null) return null;
  return (
    <button
      type="button"
      onClick={() => onOpen(moment)}
      className="absolute inset-x-0 bottom-0 flex items-end gap-2 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-3 pb-5 pt-8 text-left"
    >
      <StudentAvatar id={moment.author_id} name={moment.author_name} size="sm" />
      <div className="min-w-0 flex-1 [text-shadow:0_1px_3px_rgba(0,0,0,0.85)]">
        <div className="text-xs font-bold text-white">
          {moment.author_name}
          <span className="ml-1.5 font-semibold tabular-nums text-violet-300">
            {formatTimestamp(moment.video_ts_seconds as number)}
          </span>
        </div>
        <div className="line-clamp-2 text-[13px] text-zinc-100">{moment.body}</div>
      </div>
    </button>
  );
}
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `cd frontend && npx vitest run src/components/videos/review/moment-overlay.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/videos/review/moment-overlay.tsx frontend/src/components/videos/review/moment-overlay.test.tsx
git commit -m "feat(threads): Add MomentOverlay live caption with display window"
```

---

## Task 9: VideoReviewPanel (assemble portrait surface)

**Files:**
- Create: `frontend/src/components/videos/review/video-review-panel.tsx`
- Modify (finalize): `frontend/src/components/videos/player-context.tsx`

This task wires player + context + the four consumers, fetches threads, and posts. It depends on the registration refactor noted in Task 3 Step 3.

- [ ] **Step 1: Finalize `PlayerControllerProvider` registration**

Replace the two bridge stubs at the bottom of `player-context.tsx` with a single registration provider, and wrap children so descendant players can register. Replace everything from `// Fire onReady exactly once.` to the end of the file with:

```tsx
  // Fire onReady exactly once (used by tests / simple callers).
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    onReady?.(register);
  }, [onReady, register]);

  const seekTo = useCallback((seconds: number) => {
    seekRef.current?.(Math.max(0, seconds));
  }, []);

  const value = useMemo<PlayerController>(
    () => ({ currentTime, duration, paused, canReadTime, canSeek, seekTo }),
    [currentTime, duration, paused, canReadTime, canSeek, seekTo],
  );

  return (
    <Ctx.Provider value={value}>
      <RegistrationCtx.Provider value={register}>
        {children}
      </RegistrationCtx.Provider>
    </Ctx.Provider>
  );
}

const RegistrationCtx = createContext<PlayerRegistration | null>(null);

/** Players call this to wire their <video> element to the controller. */
export function usePlayerRegistration(): PlayerRegistration | null {
  return useContext(RegistrationCtx);
}
```

Delete the now-removed `PlayerRegistrationBridge` and `PlayerRegistrationProvider` definitions. Re-run the Task 3 test to confirm still green:

Run: `cd frontend && npx vitest run src/components/videos/player-context.test.tsx`
Expected: PASS.

- [ ] **Step 2: Bridge the player events into the controller**

In `video-review-panel.tsx` we build a `PlayerEvents` object whose callbacks call `register` from the context. Because `VideoPlayerPanel` already takes an `events` prop, the panel passes events that forward into `usePlayerRegistration()`.

Create `frontend/src/components/videos/review/video-review-panel.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { Video } from "@/lib/api";
import { useUser } from "@/lib/current-user-context";
import { useThreadsForAnchor } from "@/lib/queries";
import { useCreateThread } from "@/lib/mutations";
import {
  deriveThreadVisibility,
  type VideoThreadSurface,
} from "@/lib/thread-visibility";
import type { PlayerEvents } from "../player-events";
import { VideoPlayerPanel } from "../video-player-panel";
import {
  PlayerControllerProvider,
  usePlayerController,
  usePlayerRegistration,
} from "../player-context";
import { MomentComposer, type MomentDraft } from "./moment-composer";
import { MomentFeed } from "./moment-feed";
import { MomentOverlay } from "./moment-overlay";
import { ScrubberPins } from "./scrubber-pins";
import type { ThreadView } from "@/lib/api";

interface VideoReviewPanelProps {
  video: Video;
  surface: VideoThreadSurface;
  /** Watch-tracking events from the dialog; merged with controller bridging. */
  watchEvents?: PlayerEvents;
}

export function VideoReviewPanel(props: VideoReviewPanelProps) {
  return (
    <PlayerControllerProvider>
      <ReviewInner {...props} />
    </PlayerControllerProvider>
  );
}

function ReviewInner({ video, surface, watchEvents }: VideoReviewPanelProps) {
  const user = useUser();
  const controller = usePlayerController();
  const registration = usePlayerRegistration();

  // Bridge player events -> controller registration, merged with watch events.
  const events = useMemo<PlayerEvents>(
    () => ({
      onPlay: watchEvents?.onPlay,
      onEnded: watchEvents?.onEnded,
      onOpened: watchEvents?.onOpened,
      onProgress: (t, d) => {
        watchEvents?.onProgress?.(t, d);
        registration?.reportProgress(t, d);
      },
      onPaused: (p) => registration?.reportPaused(p),
      registerSeek: (fn) => registration?.registerSeek(fn),
    }),
    [watchEvents, registration],
  );

  const threadsQuery = useThreadsForAnchor("video", video.id);
  const threads: ThreadView[] = threadsQuery.data ?? [];
  const createThread = useCreateThread();

  const [pinnedThread, setPinnedThread] = useState<ThreadView | null>(null);
  const [highlightThreadId, setHighlightThreadId] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  function scrollToThread(threadId: number) {
    setHighlightThreadId(threadId);
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-thread-id="${threadId}"]`,
    );
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => setHighlightThreadId(null), 2200);
  }

  async function submit(draft: MomentDraft) {
    const vis = deriveThreadVisibility(surface, user);
    try {
      await createThread.mutateAsync({
        anchor_kind: draft.video_ts_seconds != null ? "video_timestamp" : "video",
        anchor_id: video.id,
        video_ts_seconds: draft.video_ts_seconds,
        visibility: vis.visibility,
        scope_student_id: vis.scope_student_id,
        body: draft.body,
      });
    } catch {
      toast.error("Failed to post comment. Please try again.");
    }
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <VideoPlayerPanel video={video} events={events} />
        {controller.canReadTime && (
          <>
            <MomentOverlay
              threads={threads}
              currentTime={controller.currentTime}
              pinnedThread={pinnedThread}
              onOpen={(t) => scrollToThread(t.id)}
            />
            <ScrubberPins
              threads={threads}
              duration={controller.duration}
              activeThreadId={pinnedThread?.id ?? null}
              onPinClick={(t) => {
                setPinnedThread(t);
                if (t.video_ts_seconds != null) controller.seekTo(t.video_ts_seconds);
                scrollToThread(t.id);
              }}
              onClusterClick={(ts) => scrollToThread(ts[0].id)}
            />
          </>
        )}
      </div>

      <MomentComposer
        currentTime={controller.currentTime}
        canStamp={controller.canReadTime}
        onCaptureStart={() => controller.canSeek && controller.seekTo(controller.currentTime)}
        onSubmit={submit}
        pending={createThread.isPending}
      />

      <div ref={listRef}>
        <MomentFeed
          videoId={video.id}
          threads={threads}
          onSeek={(s) => controller.seekTo(s)}
          highlightThreadId={highlightThreadId}
        />
      </div>
    </div>
  );
}
```

> Pausing on capture: the cleanest pause is to call a `pause()` the player registers, but to avoid expanding the player API now, `onCaptureStart` re-seeks to the current time (a no-op nudge) as a placeholder. If a hard pause is wanted, add `registerPause` to the controller in a follow-up. The composer freezing the stamp value already prevents drift in the submitted data.

- [ ] **Step 3: Type-check**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/videos/player-context.tsx frontend/src/components/videos/review/video-review-panel.tsx
git commit -m "feat(threads): Assemble VideoReviewPanel for the portrait surface"
```

---

## Task 10: Mount in the player dialog + thread the surface prop

**Files:**
- Modify: `frontend/src/components/videos/video-player-dialog.tsx`
- Modify: `frontend/src/components/videos/video-list.tsx`
- Modify: `frontend/src/components/technique-row/videos-block.tsx`

- [ ] **Step 1: Accept `surface` in the dialog and render the review panel**

In `video-player-dialog.tsx`, add `surface` to props and render `VideoReviewPanel` in place of the bare `VideoPlayerPanel` inside `PlayerContent`:

```tsx
import { VideoReviewPanel } from "./review/video-review-panel";
import type { VideoThreadSurface } from "@/lib/thread-visibility";

interface VideoPlayerDialogProps {
  video: Video | null;
  onClose: () => void;
  watchContext?: WatchContext;
  surface: VideoThreadSurface;
}
```

Pass `surface` into `PlayerContent`, and replace the `<VideoPlayerPanel video={video} events={events} />` line with:

```tsx
      <VideoReviewPanel video={video} surface={surface} watchEvents={events} />
```

(Keep the download button block and `useWatchTracker` as they are; `events` from `useWatchTracker` now flows in as `watchEvents`.)

- [ ] **Step 2: Thread `surface` through `VideoList`**

In `video-list.tsx`, add `surface: VideoThreadSurface` to the `VideoList` props interface and pass it to the dialog:

```tsx
import type { VideoThreadSurface } from "@/lib/thread-visibility";
// ... in props:
  surface: VideoThreadSurface;
// ... at the dialog usage (~line 251):
      <VideoPlayerDialog
        video={playing}
        onClose={() => setPlaying(null)}
        watchContext={watchContext}
        surface={surface}
      />
```

- [ ] **Step 3: Derive `surface` in `VideosBlock`**

In `videos-block.tsx`, compute the surface from the row context and pass it to `VideoList`:

```tsx
import type { VideoThreadSurface } from "@/lib/thread-visibility";
// ... after `const syllabus = ...`:
  const surface: VideoThreadSurface =
    context.kind === "student-pinned" || context.kind === "student-syllabus"
      ? { kind: "student", studentId: context.studentId }
      : { kind: "library" };
// ... add to the <VideoList ... /> props:
        surface={surface}
```

- [ ] **Step 4: Find and fix any other `VideoPlayerDialog` / `VideoList` call sites**

Run: `cd frontend && grep -rn "VideoPlayerDialog\|<VideoList" src --include=*.tsx | grep -v "\.test\."`
For each call site that now lacks `surface`, pass the correct value: `{ kind: "library" }` for global-library/management contexts, `{ kind: "student", studentId }` where a student is in scope.

- [ ] **Step 5: Type-check + lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: both pass. A missing `surface` prop surfaces here as a type error; fix per Step 4.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/videos/video-player-dialog.tsx frontend/src/components/videos/video-list.tsx frontend/src/components/technique-row/videos-block.tsx
git commit -m "feat(threads): Mount video review surface in the player dialog"
```

---

## Task 11: Fullscreen side sheet

**Files:**
- Create: `frontend/src/components/videos/review/moment-side-sheet.tsx`
- Modify: `frontend/src/components/videos/review/video-review-panel.tsx`

Behavior: on the fullscreen/landscape layout, opening a moment shows a right-hand sheet scoped to that one thread, and the video shrinks (a flex split) instead of scrolling the feed. Detect fullscreen with a media query / the Fullscreen API; default (portrait, non-fullscreen) keeps Task 9 behavior.

- [ ] **Step 1: Implement the side sheet**

Create `frontend/src/components/videos/review/moment-side-sheet.tsx`:

```tsx
import { X } from "lucide-react";
import { ThreadView as ThreadViewComponent } from "@/components/threads/thread-view";
import { formatTimestamp } from "@/lib/dates";
import type { ThreadView } from "@/lib/api";

interface MomentSideSheetProps {
  thread: ThreadView;
  videoId: number;
  onClose: () => void;
}

export function MomentSideSheet({ thread, videoId, onClose }: MomentSideSheetProps) {
  const anchorKind = thread.video_ts_seconds != null ? "video_timestamp" : "video";
  return (
    <aside className="flex w-[300px] flex-none flex-col border-l border-border bg-background">
      <div className="flex items-center justify-between border-b border-border p-3">
        <span className="text-xs font-semibold">
          {thread.video_ts_seconds != null
            ? `Moment · ${formatTimestamp(thread.video_ts_seconds)}`
            : "Whole video"}
        </span>
        <button type="button" aria-label="Close thread" onClick={onClose}>
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <ThreadViewComponent thread={thread} anchorKind={anchorKind} anchorId={videoId} />
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Branch the review panel on fullscreen**

In `video-review-panel.tsx`, detect fullscreen and, when a moment is open in fullscreen, render the player + sheet as a flex split (video shrinks) instead of the stacked feed. Use the existing `useMediaQuery` hook (`src/lib/use-media-query.ts`, already imported elsewhere in the videos folder):

```tsx
import { useMediaQuery } from "@/lib/use-media-query";
import { MomentSideSheet } from "./moment-side-sheet";
// inside ReviewInner, after state:
  const isLandscape = useMediaQuery("(orientation: landscape) and (max-height: 500px)");
  const sheetOpen = isLandscape && pinnedThread != null;
```

Wrap the player region so that when `sheetOpen`, the player and sheet sit side by side and the video is constrained:

```tsx
      <div className={sheetOpen ? "flex gap-2" : "relative"}>
        <div className={sheetOpen ? "relative flex-1 min-w-0" : "relative"}>
          <VideoPlayerPanel video={video} events={events} />
          {controller.canReadTime && (
            <>
              {/* MomentOverlay + ScrubberPins exactly as in Task 9 */}
            </>
          )}
        </div>
        {sheetOpen && pinnedThread && (
          <MomentSideSheet
            thread={pinnedThread}
            videoId={video.id}
            onClose={() => setPinnedThread(null)}
          />
        )}
      </div>
```

In landscape, the pin/overlay handlers should set `pinnedThread` (already do) but skip the feed scroll: guard `scrollToThread` so it only scrolls when `!sheetOpen`. Keep the stacked `MomentComposer` + `MomentFeed` rendered only when `!sheetOpen`.

- [ ] **Step 3: Type-check + lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/videos/review/moment-side-sheet.tsx frontend/src/components/videos/review/video-review-panel.tsx
git commit -m "feat(threads): Add fullscreen side sheet for video threads"
```

---

## Task 12: Manual verification + full gate

- [ ] **Step 1: Run the local verify gate**

Run: `just verify` (per project: offline build, test, SQLX_OFFLINE; the CI gate).
Expected: green. Fix anything that fails before proceeding.

- [ ] **Step 2: Run the app and verify by hand**

Use the project `run` skill (or `just dev` per repo docs) to launch, then:
- As a **coach** on the **global library**: open a technique video, post `Comment at 0:42`, confirm it appears with a pin + chip, plays back, and the overlay shows around 0:42. Post a `× whole video` comment, confirm the `whole video` tag.
- As a **student**: open the same video from the library, confirm you see your own private comment + the coach's broadcast, but not other students' private comments.
- As a **coach** on a **student's pinned** technique: post a comment, confirm it is private to that student (the student sees it, a second student does not).
- Open a **YouTube/embed** video: confirm the composer offers whole-video only (no capture button), no overlay, and reading existing threads still works.
- **Fullscreen** a native video on a narrow viewport: tap a pin, confirm the side sheet opens and the video shrinks but stays fully visible.

- [ ] **Step 3: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(threads): Address video review issues found in verification"
```

---

## Self-review notes (for the implementer)

- **Spec coverage:** §2 architecture → Tasks 3, 9. §3 read/create/activity → Tasks 1, 9 (activity is automatic). §4 visibility → Task 4 + Task 9 submit. §5 backend → Task 1. §6 overlay → Task 8. §7 fullscreen → Task 11. §8 embed degradation → composer `canStamp` (Task 5), panel `canReadTime` guard (Task 9), manual check (Task 12). Composer/feed/pins → Tasks 5/6/7.
- **Capability gating:** every native-only affordance (overlay, pins, capture button) hangs off `controller.canReadTime` / `canStamp`, so embeds degrade by construction.
- **Naming consistency:** `video_ts_seconds` (backend + API + drafts), `seekTo`, `canReadTime`/`canSeek`, `VideoThreadSurface`, `deriveThreadVisibility`, `activeMoment`, `clusterPins` are used identically across tasks.
- **Known follow-ups (out of scope):** hard `registerPause` on the controller; coach-side global-library noise filter; @-mentions, reactions, video replies.
