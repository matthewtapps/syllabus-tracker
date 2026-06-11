# Activity Deep-Linking and Coach Dashboard Uplift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the coach dashboard's recent-activity feed legible on phones and turn every row into a deep link that lands the coach in the exact surface the student acted in, backed by a typed, extensible view-context model.

**Architecture:** A typed `EntityRef` + `ViewContext` model on the frontend, serialized into a `focus=<type>:<id>` URL token via two pure seams (`viewContextHref`, `parseFocusToken`). The activity log captures a video's view-context explicitly via a new `context_kind` discriminator plus the existing typed FK columns. A shared `useFocusTarget` hook teaches the syllabus and library pages to expand/scroll/highlight a focused entity.

**Tech Stack:** Rust / Rocket / sqlx (SQLite, offline cache), React 19 + Vite SPA, TanStack Query, react-router-dom v7, Vitest (node `*.unit.test.ts` + browser `*.test.tsx`), shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-06-11-activity-deep-linking-and-dashboard-uplift-design.md`

---

## Conventions for every task

- **Commit message format:** `feat(scope): Sentence in past tense.` Do NOT add any co-authored block. No em-dashes anywhere (copy, comments, commit messages); use commas/periods/parens.
- **Frontend checks runnable locally:** `cd frontend && npx tsc --noEmit && pnpm lint && pnpm vitest run --project node`. Browser `*.test.tsx` cannot run on this box (Chromium missing libs); write them to the existing convention and rely on CI. In `*.test.tsx`, never `vi.spyOn` an `@/lib/api` export (fails in CI browser mode); stub `window.fetch`. No `as` casts (lint rule); build fixtures with helpers.
- **Backend checks:** `just lint-backend` (clippy offline) and `cargo nextest run -p syllabus-tracker` from repo root. After any change to a `query!`/`query_as!` macro or the schema, regenerate the sqlx cache (see "sqlx cache regen recipe" at the bottom) and run `just sqlx-check`.
- **Never** rebuild `data/sqlite.db` while the dev app runs. **Never** `git stash`.

## File structure (what each new/changed file owns)

**New (frontend):**
- `frontend/src/lib/entity-ref.ts` - the `EntityRef` closed union, `refToken`, `parseFocusToken`.
- `frontend/src/lib/view-context.ts` - the `ViewContext` union, `viewContextHref`, and `rowToViewContext` (ActivityRow -> ViewContext | null).
- `frontend/src/components/hooks/useFocusTarget.ts` - shared "read `?focus` token, run once, strip params" hook.

**Changed (frontend):**
- `frontend/src/lib/activity-line.ts` - `ActivityRow` gains `context_kind`; `activityLine` returns `{ verb, subject?, href? }`.
- `frontend/src/lib/dates.ts` - add `formatRelativeShort`.
- `frontend/src/components/activity-feed-list.tsx` - new layout + whole-row link.
- `frontend/src/app/library/page.tsx` - migrate to `?focus=technique:<id>` via `useFocusTarget`.
- `frontend/src/app/student-syllabi/[syllabusId]/page.tsx` - add focus consumer.
- `frontend/src/components/videos/useWatchTracker.ts`, `video-player-dialog.tsx`, `video-list.tsx`, `technique-row/videos-block.tsx` - thread `WatchContext` to the watch-events POST.
- `frontend/src/app/dashboard/page.tsx`, `frontend/src/app/dashboard/components/queue-panel.tsx` - remove "Ready for a syllabus".

**Changed (backend):**
- `config/schema.sql` - add `context_kind` to `activity`.
- `crates/syllabus-tracker/src/db/activity.rs` - `NewActivity.context_kind` field + builder + `emit` INSERT.
- `crates/syllabus-tracker/src/db/activity_read.rs` - SELECT `context_kind`.
- `crates/syllabus-tracker/src/db/watch.rs` - `WatchContext` param on `ingest_watch_events`, attach to the `VideoWatched` emit.
- `crates/syllabus-tracker/src/videos/routes.rs` - `WatchEventBatch.context`, pass through.
- `.sqlx/` - regenerated cache.

---

## Task 1: EntityRef and focus-token serialization

**Files:**
- Create: `frontend/src/lib/entity-ref.ts`
- Test: `frontend/src/lib/entity-ref.unit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/lib/entity-ref.unit.test.ts
import { describe, expect, test } from "vitest";
import { refToken, parseFocusToken } from "./entity-ref";

describe("refToken", () => {
  test("serializes type and id", () => {
    expect(refToken({ type: "sst", id: 42 })).toBe("sst:42");
    expect(refToken({ type: "technique", id: 9 })).toBe("technique:9");
  });
});

describe("parseFocusToken", () => {
  test("parses a valid token", () => {
    expect(parseFocusToken("sst:42")).toEqual({ type: "sst", id: 42 });
    expect(parseFocusToken("technique:9")).toEqual({ type: "technique", id: 9 });
  });
  test("rejects unknown type", () => {
    expect(parseFocusToken("widget:1")).toBeNull();
  });
  test("rejects malformed input", () => {
    expect(parseFocusToken(null)).toBeNull();
    expect(parseFocusToken("")).toBeNull();
    expect(parseFocusToken("sst:")).toBeNull();
    expect(parseFocusToken("sst:abc")).toBeNull();
    expect(parseFocusToken("sst")).toBeNull();
    expect(parseFocusToken("sst:1:2")).toBeNull();
  });
  test("round-trips with refToken", () => {
    const ref = { type: "video", id: 7 } as const;
    expect(parseFocusToken(refToken(ref))).toEqual(ref);
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `cd frontend && pnpm vitest run --project node src/lib/entity-ref.unit.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// frontend/src/lib/entity-ref.ts

/**
 * A typed reference to an addressable entity. Closed union so both the URL
 * serializer and every page consumer switch exhaustively. This is the
 * Rails-polymorphic / Relay-node "(type, id)" idea, constrained for
 * compiler-checked safety. Add a member here when a new deep-linkable kind
 * arrives (camp, match, video_thread, comment, ...).
 */
export type EntityRef =
  | { type: "technique"; id: number }
  | { type: "video"; id: number }
  | { type: "sst"; id: number }
  | { type: "syllabus"; id: number }
  | { type: "student"; id: number };

export type EntityType = EntityRef["type"];

const ENTITY_TYPES: readonly EntityType[] = [
  "technique",
  "video",
  "sst",
  "syllabus",
  "student",
];

function isEntityType(value: string): value is EntityType {
  return (ENTITY_TYPES as readonly string[]).includes(value);
}

/** Serialize an EntityRef to its URL token form, e.g. "sst:42". */
export function refToken(ref: EntityRef): string {
  return `${ref.type}:${ref.id}`;
}

/**
 * Parse a "<type>:<id>" focus token back into an EntityRef. Returns null for
 * null/empty input, unknown types, or a non-integer id. Never throws.
 */
export function parseFocusToken(raw: string | null | undefined): EntityRef | null {
  if (!raw) return null;
  const parts = raw.split(":");
  if (parts.length !== 2) return null;
  const [type, rawId] = parts;
  if (!isEntityType(type)) return null;
  if (!/^\d+$/.test(rawId)) return null;
  const id = Number.parseInt(rawId, 10);
  if (!Number.isSafeInteger(id)) return null;
  return { type, id };
}
```

- [ ] **Step 4: Run it, expect pass**

Run: `cd frontend && pnpm vitest run --project node src/lib/entity-ref.unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint + typecheck**

Run: `cd frontend && npx tsc --noEmit && pnpm lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/entity-ref.ts frontend/src/lib/entity-ref.unit.test.ts
git commit -m "feat(deep-link): Added typed EntityRef and focus-token serialization."
```

---

## Task 2: ViewContext and viewContextHref

**Files:**
- Create: `frontend/src/lib/view-context.ts`
- Test: `frontend/src/lib/view-context.unit.test.ts`

This task defines the `ViewContext` union, the `viewContextHref` URL builder, and `rowToViewContext`, which maps an `ActivityRow` to a `ViewContext | null`. It imports the `ActivityRow` type from `activity-line.ts` (which already exists; the `context_kind` field is added in Task 4, so this task references it as optional via a local minimal input type to avoid a circular dependency).

To avoid importing the full `ActivityRow` (and a cycle with Task 4), `rowToViewContext` takes a minimal structural input.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/lib/view-context.unit.test.ts
import { describe, expect, test } from "vitest";
import { viewContextHref, rowToViewContext } from "./view-context";

describe("viewContextHref", () => {
  test("library context without video", () => {
    expect(
      viewContextHref({ kind: "library", technique: { type: "technique", id: 9 } }),
    ).toBe("/library?focus=technique:9");
  });
  test("library context with video", () => {
    expect(
      viewContextHref({
        kind: "library",
        technique: { type: "technique", id: 9 },
        video: { type: "video", id: 7 },
      }),
    ).toBe("/library?focus=technique:9&video=7");
  });
  test("syllabus context without video", () => {
    expect(
      viewContextHref({
        kind: "syllabus",
        student: { type: "student", id: 4 },
        syllabus: { type: "syllabus", id: 2 },
        sst: { type: "sst", id: 42 },
      }),
    ).toBe("/student/4/syllabi/2?focus=sst:42");
  });
  test("syllabus context with video", () => {
    expect(
      viewContextHref({
        kind: "syllabus",
        student: { type: "student", id: 4 },
        syllabus: { type: "syllabus", id: 2 },
        sst: { type: "sst", id: 42 },
        video: { type: "video", id: 7 },
      }),
    ).toBe("/student/4/syllabi/2?focus=sst:42&video=7");
  });
});

describe("rowToViewContext", () => {
  test("video_watched with syllabus context", () => {
    expect(
      rowToViewContext({
        verb: "video_watched",
        context_kind: "syllabus",
        target_student_id: 4,
        syllabus_id: 2,
        sst_id: 42,
        technique_id: 9,
        video_id: 7,
      }),
    ).toEqual({
      kind: "syllabus",
      student: { type: "student", id: 4 },
      syllabus: { type: "syllabus", id: 2 },
      sst: { type: "sst", id: 42 },
      video: { type: "video", id: 7 },
    });
  });
  test("video_watched with library context", () => {
    expect(
      rowToViewContext({
        verb: "video_watched",
        context_kind: "library",
        target_student_id: 4,
        syllabus_id: null,
        sst_id: null,
        technique_id: 9,
        video_id: 7,
      }),
    ).toEqual({
      kind: "library",
      technique: { type: "technique", id: 9 },
      video: { type: "video", id: 7 },
    });
  });
  test("video_watched with no resolvable context returns null", () => {
    expect(
      rowToViewContext({
        verb: "video_watched",
        context_kind: null,
        target_student_id: 4,
        syllabus_id: null,
        sst_id: null,
        technique_id: null,
        video_id: 7,
      }),
    ).toBeNull();
  });
  test("attempt_logged maps to syllabus context", () => {
    expect(
      rowToViewContext({
        verb: "attempt_logged",
        context_kind: null,
        target_student_id: 4,
        syllabus_id: 2,
        sst_id: 42,
        technique_id: 9,
        video_id: null,
      }),
    ).toEqual({
      kind: "syllabus",
      student: { type: "student", id: 4 },
      syllabus: { type: "syllabus", id: 2 },
      sst: { type: "sst", id: 42 },
    });
  });
  test("attempt_logged without syllabus columns returns null", () => {
    expect(
      rowToViewContext({
        verb: "attempt_logged",
        context_kind: null,
        target_student_id: 4,
        syllabus_id: null,
        sst_id: null,
        technique_id: 9,
        video_id: null,
      }),
    ).toBeNull();
  });
  test("unrelated verb returns null", () => {
    expect(
      rowToViewContext({
        verb: "syllabus_assigned",
        context_kind: null,
        target_student_id: 4,
        syllabus_id: 2,
        sst_id: null,
        technique_id: null,
        video_id: null,
      }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `cd frontend && pnpm vitest run --project node src/lib/view-context.unit.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// frontend/src/lib/view-context.ts
import type { EntityRef } from "./entity-ref";
import { refToken } from "./entity-ref";

/**
 * The surface a student was on when an activity happened (ActivityStreams
 * `context`). The discriminant picks the route; the refs fill the path and the
 * focus token. Add a member when a new surface arrives (camp, match,
 * video_thread, ...); the switch in viewContextHref then fails to compile until
 * the new arm is added.
 */
export type ViewContext =
  | { kind: "library"; technique: EntityRef; video?: EntityRef }
  | {
      kind: "syllabus";
      student: EntityRef;
      syllabus: EntityRef;
      sst: EntityRef;
      video?: EntityRef;
    };

/** The one place deep-link routing lives. Pure. */
export function viewContextHref(ctx: ViewContext): string {
  switch (ctx.kind) {
    case "library": {
      const video = ctx.video ? `&video=${ctx.video.id}` : "";
      return `/library?focus=${refToken(ctx.technique)}${video}`;
    }
    case "syllabus": {
      const video = ctx.video ? `&video=${ctx.video.id}` : "";
      return `/student/${ctx.student.id}/syllabi/${ctx.syllabus.id}?focus=${refToken(
        ctx.sst,
      )}${video}`;
    }
  }
}

/** Minimal structural view of an ActivityRow, so this module does not depend
 *  on the full row type (avoids a cycle with activity-line.ts). */
export interface ViewContextRow {
  verb: string;
  context_kind: string | null;
  target_student_id: number | null;
  syllabus_id: number | null;
  sst_id: number | null;
  technique_id: number | null;
  video_id: number | null;
}

const SYLLABUS_SCOPED_VERBS = new Set([
  "attempt_logged",
  "attempt_edited",
  "attempt_deleted",
  "sst_status_changed",
  "sst_student_notes_edited",
  "sst_coach_notes_edited",
]);

function syllabusContext(row: ViewContextRow): ViewContext | null {
  if (
    row.target_student_id == null ||
    row.syllabus_id == null ||
    row.sst_id == null
  ) {
    return null;
  }
  return {
    kind: "syllabus",
    student: { type: "student", id: row.target_student_id },
    syllabus: { type: "syllabus", id: row.syllabus_id },
    sst: { type: "sst", id: row.sst_id },
    video: row.video_id != null ? { type: "video", id: row.video_id } : undefined,
  };
}

/**
 * Build a ViewContext from an activity row, or null when the row has no
 * resolvable deep-link target (the caller then falls back). Pure.
 */
export function rowToViewContext(row: ViewContextRow): ViewContext | null {
  if (row.verb === "video_watched") {
    if (row.context_kind === "syllabus") {
      return syllabusContext(row);
    }
    // library (or unspecified): needs the video's technique
    if (row.technique_id == null) return null;
    return {
      kind: "library",
      technique: { type: "technique", id: row.technique_id },
      video: row.video_id != null ? { type: "video", id: row.video_id } : undefined,
    };
  }
  if (SYLLABUS_SCOPED_VERBS.has(row.verb)) {
    return syllabusContext(row);
  }
  return null;
}
```

- [ ] **Step 4: Run it, expect pass**

Run: `cd frontend && pnpm vitest run --project node src/lib/view-context.unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint + typecheck**

Run: `cd frontend && npx tsc --noEmit && pnpm lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/view-context.ts frontend/src/lib/view-context.unit.test.ts
git commit -m "feat(deep-link): Added ViewContext model and route resolver."
```

---

## Task 3: formatRelativeShort

**Files:**
- Modify: `frontend/src/lib/dates.ts`
- Test: `frontend/src/lib/dates.unit.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/lib/dates.unit.test.ts
import { describe, expect, test, vi, afterEach } from "vitest";
import { formatRelativeShort } from "./dates";

const NOW = new Date("2026-06-11T12:00:00Z").getTime();

function at(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString();
}

describe("formatRelativeShort", () => {
  afterEach(() => vi.useRealTimers());

  test("buckets", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(formatRelativeShort(at(-10 * 1000))).toBe("now");
    expect(formatRelativeShort(at(-5 * 60 * 1000))).toBe("5m");
    expect(formatRelativeShort(at(-3 * 3600 * 1000))).toBe("3h");
    expect(formatRelativeShort(at(-2 * 86400 * 1000))).toBe("2d");
  });

  test("older than a week shows a short date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    // 10 days ago -> "Jun 1"
    expect(formatRelativeShort(at(-10 * 86400 * 1000))).toMatch(/Jun 1/);
  });

  test("null input", () => {
    expect(formatRelativeShort(null)).toBe("");
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `cd frontend && pnpm vitest run --project node src/lib/dates.unit.test.ts`
Expected: FAIL (`formatRelativeShort` not exported).

- [ ] **Step 3: Implement** (append to `frontend/src/lib/dates.ts`)

```ts
const SHORT_DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

/**
 * Compact relative time for dense lists: "now", "5m", "3h", "2d", then a short
 * date ("Jun 1"). Distinct from formatRelative, which is wordier.
 */
export function formatRelativeShort(input: string | Date | null | undefined): string {
  const date = parse(input);
  if (!date) return "";
  const diffSec = Math.round((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return "now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  if (diffSec < 7 * 86400) return `${Math.floor(diffSec / 86400)}d`;
  return SHORT_DATE.format(date);
}
```

- [ ] **Step 4: Run it, expect pass**

Run: `cd frontend && pnpm vitest run --project node src/lib/dates.unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/dates.ts frontend/src/lib/dates.unit.test.ts
git commit -m "feat(dates): Added compact relative-time formatter."
```

---

## Task 4: Restructure activityLine to {verb, subject, href}

**Files:**
- Modify: `frontend/src/lib/activity-line.ts`
- Modify: `frontend/src/lib/activity-line.unit.test.ts`

The new `ActivityLine` is `{ verb: string; subject?: string; href?: string }`. `verb` is the bold phrase; `subject` is the trailing entity name when the copy ends with it (attempts, notes, status, video, pins, single-name syllabus verbs). For compound copy where the name is embedded ("added Armbar to Blue Belt"), put the whole string in `verb` and omit `subject`. `href` is computed via `rowToViewContext(row)` -> `viewContextHref`, with verb-specific fallbacks (pins -> pinned page; assignment/curation -> `/syllabi/<id>`).

- [ ] **Step 1: Update the test file**

Add a reconstruction helper at the top of `activity-line.unit.test.ts` and replace every `result.text` with `lineText(result)`. Add `context_kind: null` to the `row()` factory defaults. Then add the new routing tests below.

In the `row()` factory (`frontend/src/lib/activity-line.unit.test.ts`), add to the returned object:

```ts
    context_kind: null,
```

Add after the imports:

```ts
import type { ActivityLine } from "./activity-line";

function lineText(line: ActivityLine): string {
  return line.subject ? `${line.verb} ${line.subject}` : line.verb;
}
```

Replace each `expect(result.text).toBe(...)` with `expect(lineText(result)).toBe(...)` (the expected strings are unchanged). Then append these new tests inside the `describe`:

```ts
  // --- deep-link routing ---
  test("attempt_logged routes to the student's syllabus with sst focus", () => {
    const result = activityLine(
      row({
        verb: "attempt_logged",
        technique_id: 5,
        technique_name: "Armbar",
        target_student_id: 4,
        syllabus_id: 2,
        sst_id: 42,
      }),
    );
    expect(result.verb).toBe("logged an attempt on");
    expect(result.subject).toBe("Armbar");
    expect(result.href).toBe("/student/4/syllabi/2?focus=sst:42");
  });

  test("sst_student_notes_edited routes to the syllabus", () => {
    const result = activityLine(
      row({
        verb: "sst_student_notes_edited",
        technique_id: 5,
        technique_name: "Armbar",
        target_student_id: 4,
        syllabus_id: 2,
        sst_id: 42,
      }),
    );
    expect(result.href).toBe("/student/4/syllabi/2?focus=sst:42");
  });

  test("video_watched in a syllabus routes to the syllabus with video", () => {
    const result = activityLine(
      row({
        verb: "video_watched",
        video_id: 7,
        video_title: "Triangle setup",
        context_kind: "syllabus",
        target_student_id: 4,
        syllabus_id: 2,
        sst_id: 42,
        technique_id: 5,
      }),
    );
    expect(result.href).toBe("/student/4/syllabi/2?focus=sst:42&video=7");
  });

  test("video_watched in the library routes to the library with video", () => {
    const result = activityLine(
      row({
        verb: "video_watched",
        video_id: 7,
        video_title: "Triangle setup",
        context_kind: "library",
        technique_id: 5,
      }),
    );
    expect(result.href).toBe("/library?focus=technique:5&video=7");
  });

  test("technique_pinned routes to the student's pinned page", () => {
    const result = activityLine(
      row({
        verb: "technique_pinned",
        technique_id: 5,
        technique_name: "Armbar",
        target_student_id: 4,
      }),
    );
    expect(result.href).toBe("/student/4/pinned");
  });

  test("syllabus_assigned still routes to the coach syllabus view", () => {
    const result = activityLine(
      row({ verb: "syllabus_assigned", syllabus_id: 2, syllabus_name: "Blue Belt" }),
    );
    expect(result.href).toBe("/syllabi/2");
  });
```

- [ ] **Step 2: Run it, expect failure**

Run: `cd frontend && pnpm vitest run --project node src/lib/activity-line.unit.test.ts`
Expected: FAIL (`ActivityLine.text` gone / `verb` undefined).

- [ ] **Step 3: Implement**

Edit `frontend/src/lib/activity-line.ts`:

1. Add `context_kind: string | null;` to the `ActivityRow` interface (after `payload_json` / `unread`).
2. Change `ActivityLine` to:

```ts
export interface ActivityLine {
  /** Bold phrase, e.g. "logged an attempt on". */
  verb: string;
  /** Trailing entity name in normal weight, when the copy ends with it. */
  subject?: string;
  href?: string;
}
```

3. Replace the per-verb body. Each `case` now returns `{ verb, subject?, href }`. Compute `href` from `rowToViewContext` first, falling back to the legacy targets. Add imports:

```ts
import { rowToViewContext, viewContextHref } from "./view-context";
```

Add these helpers (replacing `techniqueHref`/`syllabusHref`/`videoHref`):

```ts
/** Deep-link href for a row: the typed ViewContext when resolvable, else the
 *  verb-specific fallback. */
function contextHref(row: ActivityRow): string | undefined {
  const ctx = rowToViewContext(row);
  return ctx ? viewContextHref(ctx) : undefined;
}

function pinnedHref(row: ActivityRow): string | undefined {
  return row.target_student_id != null
    ? `/student/${row.target_student_id}/pinned`
    : undefined;
}

function syllabusHref(row: ActivityRow): string | undefined {
  return row.syllabus_id != null ? `/syllabi/${row.syllabus_id}` : undefined;
}
```

4. Rewrite `activityLine` returns. The full replacement body:

```ts
export function activityLine(row: ActivityRow): ActivityLine {
  const tech = row.technique_name ?? undefined;
  const syll = row.syllabus_name ?? undefined;
  const vid = row.video_title ?? undefined;
  const deep = contextHref(row);

  switch (row.verb) {
    // --- attempt verbs ---
    case "attempt_logged":
      return tech
        ? { verb: "logged an attempt on", subject: tech, href: deep }
        : { verb: "logged an attempt" };
    case "attempt_edited":
      return tech
        ? { verb: "edited an attempt on", subject: tech, href: deep }
        : { verb: "edited an attempt" };
    case "attempt_deleted":
      return tech
        ? { verb: "deleted an attempt on", subject: tech, href: deep }
        : { verb: "deleted an attempt" };

    // --- video verbs ---
    case "video_watched":
      return vid
        ? { verb: "watched", subject: vid, href: deep }
        : { verb: "watched a video" };
    case "video_added":
      return vid
        ? { verb: "added video", subject: vid, href: deep }
        : { verb: "added a video" };
    case "video_visibility_set":
      return vid
        ? { verb: "changed visibility of", subject: vid, href: deep }
        : { verb: "changed video visibility" };

    // --- sst status ---
    case "sst_status_changed": {
      const payload = parsePayload<SstStatusChangedPayload>(row.payload_json);
      if (payload?.to && tech) {
        return { verb: `went ${payload.to} on`, subject: tech, href: deep };
      }
      return tech
        ? { verb: "updated status on", subject: tech, href: deep }
        : { verb: "updated a technique status" };
    }

    // --- sst notes ---
    case "sst_student_notes_edited":
      return tech
        ? { verb: "updated student notes on", subject: tech, href: deep }
        : { verb: "updated student notes" };
    case "sst_coach_notes_edited":
      return tech
        ? { verb: "updated coach notes on", subject: tech, href: deep }
        : { verb: "updated coach notes" };

    // --- pin verbs ---
    case "technique_pinned":
      return tech
        ? { verb: "pinned", subject: tech, href: pinnedHref(row) }
        : { verb: "pinned a technique" };
    case "technique_unpinned":
      return tech
        ? { verb: "unpinned", subject: tech, href: pinnedHref(row) }
        : { verb: "unpinned a technique" };

    // --- syllabus assignment verbs ---
    case "syllabus_assigned":
      return syll
        ? { verb: "assigned to", subject: syll, href: syllabusHref(row) }
        : { verb: "assigned to a syllabus" };
    case "syllabus_unassigned":
      return syll
        ? { verb: "unassigned from", subject: syll, href: syllabusHref(row) }
        : { verb: "unassigned from a syllabus" };
    case "syllabus_graduated":
      return syll
        ? { verb: "graduated", subject: syll, href: syllabusHref(row) }
        : { verb: "graduated a syllabus" };

    // --- sst curation verbs ---
    case "sst_added":
      return tech
        ? { verb: "added", subject: `${tech} to syllabus`, href: syllabusHref(row) }
        : { verb: "added a technique to syllabus" };
    case "sst_hidden":
      return tech ? { verb: "hid", subject: tech } : { verb: "hid a technique" };
    case "sst_unhidden":
      return tech ? { verb: "unhid", subject: tech } : { verb: "unhid a technique" };

    // --- syllabus technique fanout verbs ---
    case "syllabus_technique_added":
      if (tech && syll) {
        return { verb: `added ${tech} to ${syll}`, href: syllabusHref(row) };
      }
      return tech
        ? { verb: "added", subject: `${tech} to a syllabus`, href: syllabusHref(row) }
        : { verb: "added a technique to a syllabus" };
    case "syllabus_technique_removed":
      if (tech && syll) {
        return { verb: `removed ${tech} from ${syll}`, href: syllabusHref(row) };
      }
      return tech
        ? { verb: "removed", subject: `${tech} from a syllabus`, href: syllabusHref(row) }
        : { verb: "removed a technique from a syllabus" };

    // --- technique edited fanout ---
    case "technique_edited":
      return tech ? { verb: "edited", subject: tech } : { verb: "edited a technique" };

    default:
      return { verb: "performed an action" };
  }
}
```

Remove the now-unused `techniqueHref`/`videoHref` functions and the `TechniqueEditedPayload` import usage if it becomes unused (keep the interface if still referenced; the `technique_edited` case no longer parses it, so delete the `parsePayload<TechniqueEditedPayload>` call and the `TechniqueEditedPayload` interface if nothing else uses it).

- [ ] **Step 4: Run it, expect pass**

Run: `cd frontend && pnpm vitest run --project node src/lib/activity-line.unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck (the ActivityRow field change ripples to existing test fixtures)**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean. The wire rows come from the server via fetch (no literal), so the breakage is in test fixtures that build an `ActivityRow` by hand. Find them: `grep -rln "ActivityRow" frontend/src` (e.g. `recent-activity-feed.test.tsx`, `student-profile-activity.test.tsx`, and any `*.test.tsx` with a `row()`/fixture factory). Add `context_kind: null,` to each such literal/factory so tsc passes. Do not change their other fields.

- [ ] **Step 6: Lint**

Run: `cd frontend && pnpm lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/activity-line.ts frontend/src/lib/activity-line.unit.test.ts
git commit -m "feat(deep-link): Restructured activity lines into verb, subject, and typed href."
```

---

## Task 5: Activity row layout and whole-row link

**Files:**
- Modify: `frontend/src/components/activity-feed-list.tsx`
- Test: `frontend/src/components/activity-feed-list.test.tsx` (create; browser, CI-only)

- [ ] **Step 1: Write the browser test**

```tsx
// frontend/src/components/activity-feed-list.test.tsx
import { describe, expect, test } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { ActivityFeedList } from "./activity-feed-list";
import type { ActivityRow } from "@/lib/activity-line";

function row(overrides: Partial<ActivityRow>): ActivityRow {
  return {
    id: 1,
    occurred_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    verb: "attempt_logged",
    actor_user_id: 2,
    actor_name: "Alex Rivera",
    target_student_id: 4,
    technique_id: 5,
    technique_name: "Knee Cut Pass",
    syllabus_id: 2,
    syllabus_name: "Blue Belt",
    sst_id: 42,
    video_id: null,
    video_title: null,
    payload_json: null,
    unread: false,
    context_kind: null,
    ...overrides,
  };
}

describe("ActivityFeedList", () => {
  test("renders the whole row as a link to the deep-link href", () => {
    renderWithProviders(<ActivityFeedList rows={[row({})]} isLoading={false} />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/student/4/syllabi/2?focus=sst:42");
    expect(link.textContent).toContain("Alex Rivera");
    expect(link.textContent).toContain("logged an attempt on");
    expect(link.textContent).toContain("Knee Cut Pass");
  });

  test("renders a non-link row when there is no href", () => {
    renderWithProviders(
      <ActivityFeedList
        rows={[row({ verb: "performed_unknown", technique_id: null, sst_id: null })]}
        isLoading={false}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("performed an action")).toBeTruthy();
  });

  test("shows empty text", () => {
    renderWithProviders(
      <ActivityFeedList rows={[]} isLoading={false} emptyText="Nothing here." />,
    );
    expect(screen.getByText("Nothing here.")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Note local limitation**

Browser tests do not run on this box. Run the node project to confirm nothing else broke:
`cd frontend && pnpm vitest run --project node`
Expected: PASS (this file is excluded from the node project).

- [ ] **Step 3: Implement the new layout**

Replace the body of `frontend/src/components/activity-feed-list.tsx` with:

```tsx
import { Link } from "react-router-dom";
import { StudentAvatar } from "@/components/student-avatar";
import { activityLine, type ActivityRow } from "@/lib/activity-line";
import { coalesceActivity, coalescedSuffix } from "@/lib/activity-coalesce";
import { formatRelativeShort } from "@/lib/dates";
import { cn } from "@/lib/utils";

interface ActivityFeedListProps {
  rows: ActivityRow[];
  isLoading: boolean;
  /** Collapse consecutive same-actor same-verb rows. Default false. */
  coalesce?: boolean;
  /** Cap the number of (possibly coalesced) entries rendered. */
  maxRows?: number;
  /** Hide the per-row avatar (e.g. a single-student profile feed). Default shows it. */
  showAvatar?: boolean;
  emptyText?: string;
}

/**
 * Presentational activity list shared by the coach dashboard and the student
 * profile. Renders ActivityRow[] only. The whole row is one tappable link to
 * the row's deep-link target; rows with no target render non-interactive.
 */
export function ActivityFeedList({
  rows,
  isLoading,
  coalesce = false,
  maxRows,
  showAvatar = true,
  emptyText = "No recent activity yet.",
}: ActivityFeedListProps) {
  if (isLoading) {
    return (
      <div className="divide-y divide-border">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="px-4 py-3">
            <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return <p className="px-6 py-8 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }

  const items = coalesce
    ? coalesceActivity(rows)
    : rows.map((row) => ({ row, count: 1, extraTechniques: [] }));
  const shown = maxRows ? items.slice(0, maxRows) : items;

  return (
    <ul className="divide-y divide-border">
      {shown.map((item) => {
        const line = activityLine(item.row);
        const subject = line.subject
          ? `${line.subject}${coalescedSuffix(item)}`
          : coalescedSuffix(item).trim() || undefined;

        const inner = (
          <>
            {showAvatar && (
              <StudentAvatar
                id={item.row.actor_user_id}
                name={item.row.actor_name ?? "?"}
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-sm font-medium">
                  {item.row.actor_name ?? "A student"}
                </p>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatRelativeShort(item.row.occurred_at)}
                </span>
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{line.verb}</span>
                {subject ? ` ${subject}` : ""}
              </p>
            </div>
          </>
        );

        const key = `${item.row.actor_user_id}-${item.row.id}-${item.row.occurred_at}`;
        return (
          <li key={key}>
            {line.href ? (
              <Link
                to={line.href}
                className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
              >
                {inner}
              </Link>
            ) : (
              <div className={cn("flex items-start gap-3 px-4 py-3")}>{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
```

Note: `coalescedSuffix` returns e.g. " and 2 more"; when a line has no subject we still want the suffix shown, hence the `.trim() || undefined` branch.

- [ ] **Step 4: Typecheck + lint**

Run: `cd frontend && npx tsc --noEmit && pnpm lint`
Expected: clean.

- [ ] **Step 5: Verify callers and existing feed tests**

`RecentActivityFeed` (`frontend/src/app/dashboard/components/recent-activity-feed.tsx`) and the student profile (`frontend/src/app/student-profile/page.tsx`) pass `rows`, `isLoading`, and optional `coalesce`/`maxRows`/`showAvatar`/`emptyText`; the prop surface is unchanged, so no edits expected. Confirm via the tsc run above. Existing browser tests `recent-activity-feed.test.tsx` and `student-profile-activity.test.tsx` may assert the old single-line structure; if any assertion targets the removed inner text-link or the old wordy timestamp, update it to the new layout (whole-row `link` role; verb text still present). Leave assertions that only check rendered text content as-is.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/activity-feed-list.tsx frontend/src/components/activity-feed-list.test.tsx
git commit -m "feat(activity-feed): Reworked rows into tappable cards with compact time and bold verb."
```

---

## Task 6: useFocusTarget hook and library page migration

**Files:**
- Create: `frontend/src/components/hooks/useFocusTarget.ts`
- Modify: `frontend/src/app/library/page.tsx`

The hook centralizes: read `?focus`, parse it, run a consumer once, strip `focus` + `video` params with `{ replace: true }`. The page supplies an `onFocus(ref, videoId)` callback and a `ready` flag (data loaded).

- [ ] **Step 1: Implement the hook**

```ts
// frontend/src/components/hooks/useFocusTarget.ts
import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { parseFocusToken, type EntityRef } from "@/lib/entity-ref";

interface UseFocusTargetArgs {
  /** True once the list/data needed to act on the focus is loaded. */
  ready: boolean;
  /** Called once, with the parsed ref and the optional &video=<id>. Return
   *  true if the focus was consumed (the params are then stripped). */
  onFocus: (ref: EntityRef, videoId: number | null) => boolean;
}

/**
 * Reads `?focus=<type>:<id>` (and optional `&video=<id>`), invokes onFocus once
 * when ready, and strips the consumed params so back/forward does not re-fire.
 */
export function useFocusTarget({ ready, onFocus }: UseFocusTargetArgs): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const consumedRef = useRef(false);

  useEffect(() => {
    if (consumedRef.current || !ready) return;
    const ref = parseFocusToken(searchParams.get("focus"));
    if (!ref) return;
    const rawVideo = searchParams.get("video");
    const videoId = rawVideo && /^\d+$/.test(rawVideo) ? Number.parseInt(rawVideo, 10) : null;
    const consumed = onFocus(ref, videoId);
    if (!consumed) return;
    consumedRef.current = true;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("focus");
        next.delete("video");
        return next;
      },
      { replace: true },
    );
  }, [ready, searchParams, setSearchParams, onFocus]);
}
```

- [ ] **Step 2: Migrate the library page**

In `frontend/src/app/library/page.tsx`, replace the inline focus `useEffect` (the block reading `searchParams.get('technique')`) and its `didConsumeFocusRef` with the hook. Keep `expandedValue`, `scrollToVideoId`, and the scroll. Concretely:

Remove the `didConsumeFocusRef` ref and the entire `useEffect` that consumes `technique`/`video`. Add:

```tsx
import { useFocusTarget } from "@/components/hooks/useFocusTarget";
```

Then, after `techniques` is defined:

```tsx
  useFocusTarget({
    ready: techniques.length > 0,
    onFocus: (ref, videoId) => {
      if (ref.type !== "technique") return false;
      if (!techniques.some((t) => t.id === ref.id)) return false;
      setExpandedValue(String(ref.id));
      if (videoId != null) setScrollToVideoId(videoId);
      requestAnimationFrame(() => {
        document
          .getElementById(`technique-row-${ref.id}`)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      return true;
    },
  });
```

`useSearchParams` may now be unused in the page; remove the import if so (the hook owns it). Keep `useEffect`/`useRef` imports only if still used elsewhere in the file (they are not after this change; remove unused imports to satisfy lint).

- [ ] **Step 3: Update any test referencing the old param**

Search for the old param: `grep -rn "technique=" frontend/src/app/library` and `grep -rn "library?technique" frontend/src`. The video deep-link is produced by `viewContextHref` now (`?focus=technique:`), so no producer uses `?technique=`. If a `library` page test asserts the old `?technique=` arrival, update it to `?focus=technique:<id>`. (If none exists, skip.)

- [ ] **Step 4: Typecheck + lint + node tests**

Run: `cd frontend && npx tsc --noEmit && pnpm lint && pnpm vitest run --project node`
Expected: clean / PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/hooks/useFocusTarget.ts frontend/src/app/library/page.tsx
git commit -m "feat(deep-link): Added shared focus-target hook and moved library onto the focus token."
```

---

## Task 7: Student-syllabus page focus consumer

**Files:**
- Modify: `frontend/src/app/student-syllabi/[syllabusId]/page.tsx`
- Test: `frontend/src/app/student-syllabi/student-syllabus-focus.test.tsx` (create; browser, CI-only)

- [ ] **Step 1: Write the browser test**

```tsx
// frontend/src/app/student-syllabi/student-syllabus-focus.test.tsx
import { describe, expect, test, vi, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { buildUser } from "@/test/build-user";
import StudentSyllabusDetailPage from "./[syllabusId]/page";

// Minimal fetch stub: one syllabus assignment with one technique (sst id 42,
// technique id 5). Adjust URLs to match the real endpoints if they differ.
function makeStubFetch() {
  return vi.spyOn(window, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/syllabi/") && url.includes("/techniques")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            assignment: { id: 1, syllabus_name: "Blue Belt", total_count: 1, graduated_at: null },
            techniques: [
              {
                id: 42,
                technique_id: 5,
                technique_name: "Knee Cut Pass",
                technique_description: "",
                status: "amber",
                tags: [],
                last_attempt_at: null,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }
    return Promise.resolve(new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } }));
  });
}

describe("student-syllabus focus", () => {
  afterEach(() => vi.restoreAllMocks());

  test("arriving with ?focus=sst:42 expands the matching technique", async () => {
    const fetchSpy = makeStubFetch();
    renderWithProviders(<StudentSyllabusDetailPage />, {
      user: buildUser({ role: "coach", id: 2 }),
      initialEntries: ["/student/4/syllabi/2?focus=sst:42"],
      path: "/student/:id/syllabi/:syllabusId",
    });
    await waitFor(() => expect(screen.getByText("Knee Cut Pass")).toBeTruthy());
    // The accordion item for sst 42 is expanded (its content region is present).
    await waitFor(() =>
      expect(document.querySelector('[data-state="open"]')).toBeTruthy(),
    );
    fetchSpy.mockRestore();
  });
});
```

Note: `renderWithProviders` may need a `path` option to mount the route with params. If the helper does not support it, wrap the page in a `<Routes><Route path=...>` inside the test, or use `initialEntries` with the matching route already configured in the helper. Confirm the helper's signature in `frontend/src/test/render.tsx` and adapt; do not invent options it lacks.

- [ ] **Step 2: Implement the consumer**

In `frontend/src/app/student-syllabi/[syllabusId]/page.tsx`, inside `Detail`, add focus handling that expands and scrolls. Add imports:

```tsx
import { useFocusTarget } from "@/components/hooks/useFocusTarget";
```

Add `scrollToVideoId` state next to `expandedValue`:

```tsx
  const [scrollToVideoId, setScrollToVideoId] = useState<number | null>(null);
```

After `techniques` is defined, add:

```tsx
  useFocusTarget({
    ready: techniques.length > 0,
    onFocus: (ref, videoId) => {
      if (ref.type !== "sst") return false;
      const target = techniques.find((sst) => sst.id === ref.id);
      if (!target) return false;
      setExpandedValue(`sst-${ref.id}`);
      if (videoId != null) setScrollToVideoId(videoId);
      requestAnimationFrame(() => {
        document
          .getElementById(`technique-row-${target.technique_id}`)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      return true;
    },
  });
```

Then pass the video-scroll props to the focused `TechniqueRow` in the map (mirror the library page):

```tsx
                  scrollToVideoId={expandedValue === value ? scrollToVideoId : null}
                  onVideoScrolled={() => setScrollToVideoId(null)}
```

(Add those two props to the existing `<TechniqueRow ... />` in the `filtered.map`.)

Verify the `TechniqueRow` rendered here gets `id="technique-row-<technique_id>"`. It is produced inside `TechniqueRow` already (the library page relies on the same id). If the id is missing on this surface, add it where `TechniqueRow` renders its root in `frontend/src/components/technique-row/technique-row.tsx` (it should already be present from the library deep-link feature; confirm before adding).

- [ ] **Step 3: Typecheck + lint + node tests**

Run: `cd frontend && npx tsc --noEmit && pnpm lint && pnpm vitest run --project node`
Expected: clean / PASS.

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/student-syllabi/[syllabusId]/page.tsx" frontend/src/app/student-syllabi/student-syllabus-focus.test.tsx
git commit -m "feat(deep-link): Taught the student-syllabus page to expand and scroll to a focused technique."
```

---

## Task 8: Backend context_kind column, emit, and read

**Files:**
- Modify: `config/schema.sql`
- Modify: `crates/syllabus-tracker/src/db/activity.rs`
- Modify: `crates/syllabus-tracker/src/db/activity_read.rs`
- Modify: `.sqlx/` (regenerate)

- [ ] **Step 1: Add the column to the schema**

In `config/schema.sql`, inside `CREATE TABLE ... activity (...)`, add after `payload_json` (keep trailing comma correctness):

```sql
    -- Names the surface a student was on when the activity happened, so the
    -- feed can deep-link back to it without inferring from which reference
    -- column is non-null. NULL when the verb implies its own context
    -- (attempts/notes are always syllabus-scoped). Today: 'library' | 'syllabus'.
    context_kind TEXT,
```

- [ ] **Step 2: Add the field, builder, and emit write**

In `crates/syllabus-tracker/src/db/activity.rs`:

Add to `struct NewActivity`:

```rust
    pub context_kind: Option<&'static str>,
```

Initialize it in `NewActivity::new` (`context_kind: None,`). Add a builder:

```rust
    /// The surface the actor was on (for deep-linking). Only set where it is
    /// not implied by the verb (currently video_watched).
    pub fn context_kind(mut self, kind: &'static str) -> Self {
        self.context_kind = Some(kind);
        self
    }
```

In `emit`, add `context_kind` to the INSERT column list, the `VALUES` placeholders, and the bind list:

```rust
    sqlx::query!(
        "INSERT INTO activity
            (occurred_at, verb, actor_user_id, target_student_id,
             technique_id, syllabus_id, sst_id, video_id, payload_json, context_kind)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        now,
        verb,
        ev.actor_user_id,
        ev.target_student_id,
        ev.technique_id,
        ev.syllabus_id,
        ev.sst_id,
        ev.video_id,
        ev.payload_json,
        ev.context_kind,
    )
```

- [ ] **Step 3: Add context_kind to the read projections**

In `crates/syllabus-tracker/src/db/activity_read.rs`, add the field to the read row struct (the struct backing `ActivityRow`/feed rows; it has `technique_id`, `video_id`, etc.):

```rust
    pub context_kind: Option<String>,
```

In each of the three SELECTs (the two feed queries and the student-feed query), add the projection and the row mapping:

```sql
                  act.context_kind     AS "context_kind?: String",
```

and in each constructor:

```rust
                        context_kind: r.context_kind,
```

- [ ] **Step 4: Regenerate the sqlx cache and build**

Follow the "sqlx cache regen recipe" at the bottom of this plan. Then:

Run: `just lint-backend`
Expected: clean (clippy offline).

- [ ] **Step 5: Backend test for the round-trip**

Add to `crates/syllabus-tracker/src/test/activity.rs` (mirror the harness setup of an existing test such as `attempt_log_emits_attempt_logged`):

```rust
#[sqlx::test]
async fn emit_persists_context_kind(pool: sqlx::SqlitePool) {
    // Arrange a minimal actor; reuse the test helpers used by sibling tests
    // for seeding a student user. (Copy the setup from attempt_log_emits_attempt_logged.)
    let mut tx = pool.begin().await.unwrap();
    crate::db::activity::emit(
        &mut tx,
        crate::db::activity::NewActivity::new(crate::db::activity::Verb::VideoWatched, 1)
            .target_student(1)
            .video(1)
            .technique(1)
            .context_kind("library"),
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();

    let kind = sqlx::query!(
        r#"SELECT context_kind AS "context_kind?: String"
           FROM activity WHERE verb = 'video_watched'"#
    )
    .fetch_one(&pool)
    .await
    .unwrap()
    .context_kind;
    assert_eq!(kind.as_deref(), Some("library"));
}
```

Adjust the actor/video/technique seeding to satisfy FKs by copying the exact setup from the sibling test in the same file (do not guess at table columns; read the sibling).

- [ ] **Step 6: Run backend tests**

Run: `cargo nextest run -p syllabus-tracker emit_persists_context_kind`
Expected: PASS. Then run the full activity suite: `cargo nextest run -p syllabus-tracker activity`.

- [ ] **Step 7: sqlx-check**

Run: `just sqlx-check`
Expected: clean (cache matches the seeded DB).

- [ ] **Step 8: Commit**

```bash
git add config/schema.sql crates/syllabus-tracker/src/db/activity.rs crates/syllabus-tracker/src/db/activity_read.rs crates/syllabus-tracker/src/test/activity.rs .sqlx
git commit -m "feat(activity): Added context_kind discriminator to the activity log."
```

---

## Task 9: Capture watch context end-to-end (backend)

**Files:**
- Modify: `crates/syllabus-tracker/src/db/watch.rs`
- Modify: `crates/syllabus-tracker/src/videos/routes.rs`
- Modify: `.sqlx/` (regenerate if macros change)

- [ ] **Step 1: Add the context type and thread it into ingest**

In `crates/syllabus-tracker/src/db/watch.rs`, add:

```rust
/// Where the student was when they watched, captured by the client so the feed
/// can deep-link back. `technique_id` is the video's technique (always known on
/// the client). `syllabus_id` + `sst_id` are set only on the syllabus surface.
#[derive(Debug, Clone, Default)]
pub struct WatchContext {
    pub technique_id: Option<i64>,
    pub syllabus_id: Option<i64>,
    pub sst_id: Option<i64>,
}
```

Change `ingest_watch_events` to accept `context: &WatchContext` (add the parameter at the end). At the `VideoWatched` emit site (the `if crossed_now { emit(...) }` block), attach the context:

```rust
    if crossed_now {
        let mut ev = NewActivity::new(Verb::VideoWatched, user_id)
            .target_student(user_id)
            .video(video_id)
            .payload(payload::video_watched(new_cumulative, duration_seconds));
        if let Some(tech) = context.technique_id {
            ev = ev.technique(tech);
        }
        if let (Some(syllabus), Some(sst)) = (context.syllabus_id, context.sst_id) {
            ev = ev.syllabus(syllabus).sst(sst).context_kind("syllabus");
        } else if context.technique_id.is_some() {
            ev = ev.context_kind("library");
        }
        emit(&mut tx, ev).await?;
    }
```

- [ ] **Step 2: Accept the context in the request and pass it through**

In `crates/syllabus-tracker/src/videos/routes.rs`:

Add to `WatchEventBatch`:

```rust
    #[serde(default)]
    pub context: Option<WatchContextBody>,
```

Add the body type:

```rust
#[derive(Deserialize, Default)]
pub struct WatchContextBody {
    pub technique_id: Option<i64>,
    pub syllabus_id: Option<i64>,
    pub sst_id: Option<i64>,
}
```

In `api_video_watch_events`, build a `db::WatchContext` from `req.context` and pass it to `ingest_watch_events`:

```rust
    let context = req.context.unwrap_or_default();
    let watch_context = db::WatchContext {
        technique_id: context.technique_id,
        syllabus_id: context.syllabus_id,
        sst_id: context.sst_id,
    };
    db::ingest_watch_events(pool.inner(), vid, user.id, play_id, &inputs, &watch_context)
        .await
        .map_err(Status::from)?;
```

Ensure `WatchContext` is re-exported from `db` (the `db` module re-exports `watch` items the way `WatchEventInput` and `ingest_watch_events` are exported; add `WatchContext` to that re-export list).

- [ ] **Step 3: Build**

Run: `just lint-backend`
Expected: clean. Regenerate the sqlx cache if the emit macro expansion changed (it reuses the same INSERT from Task 8, so likely no `.sqlx` change; run `just sqlx-check` to confirm).

- [ ] **Step 4: Backend tests for both surfaces**

Add to `crates/syllabus-tracker/src/test/activity.rs`, copying the watch-threshold setup from `crossing_watch_threshold_emits_video_watched_once` (which already seeds a video and crosses the threshold). Two tests:

```rust
#[sqlx::test]
async fn watch_in_syllabus_sets_syllabus_context(pool: sqlx::SqlitePool) {
    // ... copy the seed + threshold-crossing event setup from
    // crossing_watch_threshold_emits_video_watched_once, but call
    // ingest_watch_events with a syllabus WatchContext.
    let ctx = crate::db::WatchContext {
        technique_id: Some(/* video's technique id from setup */ 1),
        syllabus_id: Some(/* seeded syllabus id */ 1),
        sst_id: Some(/* seeded sst id */ 1),
    };
    // ingest_watch_events(&pool, video_id, user_id, play_id, &events, &ctx).await.unwrap();

    let row = sqlx::query!(
        r#"SELECT context_kind AS "context_kind?: String",
                  syllabus_id  AS "syllabus_id?: i64",
                  sst_id       AS "sst_id?: i64"
           FROM activity WHERE verb = 'video_watched'"#
    )
    .fetch_one(&pool).await.unwrap();
    assert_eq!(row.context_kind.as_deref(), Some("syllabus"));
    assert!(row.syllabus_id.is_some());
    assert!(row.sst_id.is_some());
}

#[sqlx::test]
async fn watch_in_library_sets_library_context(pool: sqlx::SqlitePool) {
    // Same setup, but ctx has only technique_id set.
    let row = sqlx::query!(
        r#"SELECT context_kind AS "context_kind?: String"
           FROM activity WHERE verb = 'video_watched'"#
    )
    .fetch_one(&pool).await.unwrap();
    assert_eq!(row.context_kind.as_deref(), Some("library"));
}
```

Fill in the seeding by copying the sibling test exactly; do not invent ids or table columns.

- [ ] **Step 5: Run tests**

Run: `cargo nextest run -p syllabus-tracker watch_in_`
Expected: PASS. Then `cargo nextest run -p syllabus-tracker` (full suite) and `just sqlx-check`.

- [ ] **Step 6: Commit**

```bash
git add crates/syllabus-tracker/src/db/watch.rs crates/syllabus-tracker/src/videos/routes.rs crates/syllabus-tracker/src/test/activity.rs .sqlx
git commit -m "feat(watch): Captured video view-context on the watch emit."
```

---

## Task 10: Send watch context from the client

**Files:**
- Modify: `frontend/src/components/videos/useWatchTracker.ts`
- Modify: `frontend/src/components/videos/video-player-dialog.tsx`
- Modify: `frontend/src/components/videos/video-list.tsx`
- Modify: `frontend/src/components/technique-row/videos-block.tsx`

- [ ] **Step 1: Define the WatchContext type and accept it in the tracker**

In `frontend/src/components/videos/useWatchTracker.ts`:

```ts
export interface WatchContext {
  technique_id: number;
  syllabus_id?: number;
  sst_id?: number;
}
```

Change the signature to `useWatchTracker(videoId: number, context?: WatchContext): PlayerEvents`. In `flush`, include the context in the payload when present:

```ts
      const payload = {
        play_id: state.playId,
        events: state.buffer,
        ...(context ? { context } : {}),
      };
```

Add `context` to the `flush` `useCallback` dependency array (`[videoId, context]`). To keep `context` referentially stable, the callers pass a memoized object (Step 3/4 use `useMemo`).

- [ ] **Step 2: Pass context through the dialog**

In `frontend/src/components/videos/video-player-dialog.tsx`, add an optional `watchContext?: WatchContext` prop to `VideoPlayerDialogProps`, thread it to `PlayerContent`, and pass it to `useWatchTracker(video.id, watchContext)`. Import the type:

```ts
import { useWatchTracker, type WatchContext } from "./useWatchTracker";
```

- [ ] **Step 3: Pass context through the list**

In `frontend/src/components/videos/video-list.tsx`, add `watchContext?: WatchContext` to `VideoListProps`, accept it in the component, and forward it to `<VideoPlayerDialog video={playing} watchContext={watchContext} onClose={...} />`. Import the type from `./useWatchTracker`.

- [ ] **Step 4: Derive context in the videos block**

In `frontend/src/components/technique-row/videos-block.tsx`, derive a memoized `WatchContext` from the row context and pass it to `VideoList`:

```tsx
import { useMemo } from "react";
import type { WatchContext } from "@/components/videos/useWatchTracker";
```

```tsx
  const watchContext = useMemo<WatchContext>(() => {
    if (context.kind === "student-syllabus") {
      return {
        technique_id: technique.id,
        syllabus_id: context.syllabusId,
        sst_id: context.sst.id,
      };
    }
    return { technique_id: technique.id };
  }, [context, technique.id]);
```

Pass `watchContext={watchContext}` on the existing `<VideoList ... />`.

- [ ] **Step 5: Typecheck + lint + node tests**

Run: `cd frontend && npx tsc --noEmit && pnpm lint && pnpm vitest run --project node`
Expected: clean / PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/videos/useWatchTracker.ts frontend/src/components/videos/video-player-dialog.tsx frontend/src/components/videos/video-list.tsx frontend/src/components/technique-row/videos-block.tsx
git commit -m "feat(watch): Sent the surrounding view-context with watch events."
```

---

## Task 11: Remove "Ready for a syllabus"

**Files:**
- Modify: `frontend/src/app/dashboard/page.tsx`
- Modify: `frontend/src/app/dashboard/components/queue-panel.tsx`

- [ ] **Step 1: Remove the dashboard computation and prop**

In `frontend/src/app/dashboard/page.tsx`, delete the `needsSyllabus` `useMemo` (the block filtering students with zero techniques) and remove `needsSyllabus={needsSyllabus}` from the `<QueuePanel ... />` call.

- [ ] **Step 2: Remove it from QueuePanel**

In `frontend/src/app/dashboard/components/queue-panel.tsx`, remove the `needsSyllabus` prop from the props interface and the destructure, and delete the JSX block that renders the "Ready for a syllabus" group. If removing it makes the panel render nothing when the other queues are empty, keep the existing empty-state behavior the panel already had for the other groups (do not add new copy).

- [ ] **Step 3: Typecheck + lint**

Run: `cd frontend && npx tsc --noEmit && pnpm lint`
Expected: clean. Fix any now-unused imports in both files (e.g. an icon only used by the removed block).

- [ ] **Step 4: Update the queue-panel test if present**

`grep -rn "needsSyllabus\|Ready for a syllabus" frontend/src`. If a test asserts the removed block, delete that assertion/test. Run node tests: `cd frontend && pnpm vitest run --project node`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/dashboard/page.tsx frontend/src/app/dashboard/components/queue-panel.tsx
git commit -m "feat(dashboard): Removed the Ready for a syllabus queue."
```

---

## Task 12: Context surface indicator chip on activity rows

User-requested after seeing Task 5: each row should show which surface the action happened on (syllabus / global library / future targets) as a small icon + short label chip below the description. Chosen form: icon + short label (syllabus name for syllabus actions, "Library" for global, extensible to camps/matches later).

**Files:**
- Modify: `frontend/src/lib/view-context.ts` (add `activitySurface` pure helper)
- Modify: `frontend/src/lib/view-context.unit.test.ts`
- Modify: `frontend/src/components/activity-feed-list.tsx` (render the chip)
- Modify: `frontend/src/components/activity-feed-list.test.tsx`

- [ ] **Step 1: Add the pure surface helper + tests**

In `frontend/src/lib/view-context.ts`, add:

```ts
export interface ActivitySurface {
  kind: ViewContext["kind"];
  /** Display label: the syllabus name for syllabus actions, "Library" for global. */
  label: string;
}

/**
 * The surface chip for an activity row: derived from the same ViewContext model
 * so it stays consistent with the deep link, and extends with new kinds. Returns
 * null when there is no resolvable surface (no chip shown).
 */
export function activitySurface(
  row: ViewContextRow & { syllabus_name: string | null },
): ActivitySurface | null {
  const ctx = rowToViewContext(row);
  if (!ctx) return null;
  if (ctx.kind === "syllabus") {
    return { kind: "syllabus", label: row.syllabus_name ?? "Syllabus" };
  }
  return { kind: "library", label: "Library" };
}
```

Add tests to `view-context.unit.test.ts`:

```ts
import { activitySurface } from "./view-context";

describe("activitySurface", () => {
  test("syllabus action shows the syllabus name", () => {
    expect(
      activitySurface({
        verb: "attempt_logged",
        context_kind: null,
        target_student_id: 4,
        syllabus_id: 2,
        sst_id: 42,
        technique_id: 9,
        video_id: null,
        syllabus_name: "Blue Belt",
      }),
    ).toEqual({ kind: "syllabus", label: "Blue Belt" });
  });
  test("library video shows Library", () => {
    expect(
      activitySurface({
        verb: "video_watched",
        context_kind: "library",
        target_student_id: 4,
        syllabus_id: null,
        sst_id: null,
        technique_id: 9,
        video_id: 7,
        syllabus_name: null,
      }),
    ).toEqual({ kind: "library", label: "Library" });
  });
  test("no resolvable surface returns null", () => {
    expect(
      activitySurface({
        verb: "syllabus_assigned",
        context_kind: null,
        target_student_id: 4,
        syllabus_id: 2,
        sst_id: null,
        technique_id: null,
        video_id: null,
        syllabus_name: "Blue Belt",
      }),
    ).toBeNull();
  });
});
```

Run: `cd frontend && pnpm vitest run --project node src/lib/view-context.unit.test.ts` (expect pass).

- [ ] **Step 2: Render the chip in `ActivityFeedList`**

In `frontend/src/components/activity-feed-list.tsx`:
- Import the helper and two lucide icons: `import { NotebookPen, Globe } from "lucide-react";` and `import { activitySurface } from "@/lib/view-context";`.
- Inside the row map, after computing `line`, compute `const surface = activitySurface(item.row);`.
- After the description `<p>`, render the chip when `surface` is set:

```tsx
{surface && (
  <span className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
    {surface.kind === "syllabus" ? (
      <NotebookPen className="h-3 w-3 shrink-0" aria-hidden />
    ) : (
      <Globe className="h-3 w-3 shrink-0" aria-hidden />
    )}
    <span className="truncate">{surface.label}</span>
  </span>
)}
```

Keep it inside the row's text column (part of the `inner` fragment), below the description line. The icons are decorative (`aria-hidden`); the label text carries the meaning.

- [ ] **Step 3: Test the chip**

Add to `activity-feed-list.test.tsx` an assertion that a syllabus-context row renders its syllabus name as a chip. The default `row()` fixture is `attempt_logged` with `syllabus_id: 2`/`sst_id: 42`; give it a `syllabus_name` (e.g. "Blue Belt") and assert `screen.getByText("Blue Belt")` is in the document. Add a `video_watched` library-context row (`context_kind: "library"`, `technique_id` set, `video_id` set) and assert `screen.getByText("Library")`.

- [ ] **Step 4: Verify**

Run: `cd frontend && npx tsc --noEmit && pnpm lint && pnpm vitest run --project node`. Expect clean / green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/view-context.ts frontend/src/lib/view-context.unit.test.ts frontend/src/components/activity-feed-list.tsx frontend/src/components/activity-feed-list.test.tsx
git commit -m "feat(activity-feed): Added a context surface chip to activity rows."
```

---

## Task 13: Seed video-watch activity (so the feed shows watches)

User-requested: the seed data produces no `video_watched` activity, so the feed and digest never show watches. Live watches emit `video_watched` only when a play crosses the watch threshold (`record_watch`); the seed populates `video_watch_aggregates` directly and never emits the activity. Extend the seed's activity backfill to insert `video_watched` activity rows from the seeded watch data, with a realistic mix of syllabus-context and library-context watches.

**Files:**
- Modify: `crates/syllabus-tracker/src/db/activity.rs` (the `run_backfill` function) OR `crates/syllabus-tracker/src/bin/seed.rs`, whichever owns the activity backfill. Read `run_backfill` first to see the existing pattern (it direct-INSERTs activity rows from source tables, preserving source timestamps).
- Modify: `.sqlx/` (regenerate).

**Depends on:** Task 8 (the `context_kind` column must exist) and Task 9 (so the emit/columns are consistent). Run this AFTER Tasks 8 and 9.

- [ ] **Step 1: Understand the existing backfill and watch seed**

Read `run_backfill` in `crates/syllabus-tracker/src/db/activity.rs` (it backfills attempts and other verbs via direct INSERT ... SELECT from source tables). Read how the seed creates watch data: `grep -n "video_watch_aggregates\|last_watched_at\|first_watched_at\|days_ago" crates/syllabus-tracker/src/bin/seed.rs`. Note that prior work spread watch recency via `days_ago = ((student_idx*3 + v_idx*5) % 26)`, so some watches are within the last 7 days (these should surface in the feed/digest).

- [ ] **Step 2: Add a `video_watched` backfill INSERT**

In `run_backfill`, add an INSERT that creates one `video_watched` activity row per row in `video_watch_aggregates` (one per student+video that has watch data). For each:
- `occurred_at` = the aggregate's `last_watched_at` (preserves the seeded spread; do NOT use now()).
- `verb` = `'video_watched'`, `actor_user_id` = the watcher (`user_id`), `target_student_id` = the same user.
- `video_id` = the video, `technique_id` = the video's technique (`videos.technique_id`).
- `payload_json` = a `video_watched` payload (cumulative + duration); reuse `payload::video_watched(...)` shape or inline JSON matching it.
- **Context mix:** set syllabus context for watches where the watcher has a matching non-graduated `student_syllabus_techniques` row for the video's technique (join `student_syllabus_techniques sst` -> `syllabus_assignments a` on the watcher + technique): set `syllabus_id` = `a.syllabus_id`, `sst_id` = `sst.id`, `context_kind` = `'syllabus'`. Otherwise set `context_kind` = `'library'` and leave `syllabus_id`/`sst_id` null (technique still set). If a video's technique maps to several of the watcher's ssts, pick one deterministically (e.g. `MIN(sst.id)`), so a single activity row is produced per student+video.

Make the distribution realistic: most students should get at least one in-window watch (recent `last_watched_at`), and the mix should include both syllabus and library contexts across the seeded students so the new context chip shows both kinds. If the current seed's technique/syllabus overlap does not yield any library-context watches (every watched technique is in the student's syllabus), watch a few videos whose technique is NOT in the student's syllabus, or relax the join so some are library-context. Verify empirically in Step 4.

- [ ] **Step 3: Regenerate the sqlx cache**

Follow the "sqlx cache regen recipe" below (new query in `run_backfill` changes the cache). Then `just lint-backend` and `cargo nextest run -p syllabus-tracker` and `just sqlx-check`.

- [ ] **Step 4: Verify the seed empirically (against a temp DB, never the running dev DB)**

Seed a temp DB (the recipe seeds `/tmp/clean.db`). Then query it:

```bash
sqlite3 /tmp/clean.db "SELECT context_kind, COUNT(*) FROM activity WHERE verb='video_watched' GROUP BY context_kind;"
sqlite3 /tmp/clean.db "SELECT COUNT(*) FROM activity WHERE verb='video_watched' AND occurred_at >= datetime('now','-6 days','start of day');"
```

Expect: both `syllabus` and `library` rows present, and a non-zero count in the last 7 days. If either is zero, adjust the distribution in Step 2 and re-verify.

- [ ] **Step 5: Commit**

```bash
git add crates/syllabus-tracker/src/db/activity.rs crates/syllabus-tracker/src/bin/seed.rs .sqlx
git commit -m "feat(seed): Backfilled video-watch activity with mixed surface context."
```

---

## Task 14: Activity rows: stretched link + separate "N more" link + detailed variant

User-requested: the coalesced "and N more" should be its OWN link (to a per-student activity page) distinct from the whole-row tap, and the feed should be able to show richer rows. A link inside a link is invalid HTML, so use the stretched-link pattern: the row's primary deep-link is an absolutely-positioned overlay; the visible content sits above it with `pointer-events-none` so clicks fall through to the overlay, and any interactive child (the "N more" link) re-enables `pointer-events-auto`.

**Files:**
- Modify: `frontend/src/components/activity-feed-list.tsx`
- Modify: `frontend/src/components/activity-feed-list.test.tsx`

- [ ] **Step 1: Restructure the row to the stretched-link pattern**

Replace the per-row render so each `<li>` is `relative`, with the primary `<Link>` as an absolute overlay and the content above it:

```tsx
const rowClasses = "flex items-start gap-3 px-4 py-3";

// inside the map:
const studentActivityHref = `/student/${item.row.actor_user_id}/activity`;
const ariaLabel = `${item.row.actor_name ?? "A student"} ${line.verb}${line.subject ? ` ${line.subject}` : ""}`;

return (
  <li key={key} className="relative">
    {line.href && (
      <Link
        to={line.href}
        aria-label={ariaLabel}
        className="absolute inset-0 z-0 transition-colors hover:bg-muted/40"
      />
    )}
    <div className={cn(rowClasses, "pointer-events-none relative z-10")}>
      {showAvatar && (
        <StudentAvatar id={item.row.actor_user_id} name={item.row.actor_name ?? "?"} />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className={cn("text-sm font-medium", detailed ? "" : "truncate")}>
            {item.row.actor_name ?? "A student"}
          </p>
          <span className="shrink-0 text-xs text-muted-foreground">
            {detailed ? formatAbsolute(item.row.occurred_at) : formatRelativeShort(item.row.occurred_at)}
          </span>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {line.verb}
          {line.subject ? ` ${line.subject}` : ""}
          {item.count > 1 && (
            <>
              {" "}
              <Link
                to={studentActivityHref}
                className="pointer-events-auto relative z-20 font-medium text-foreground underline underline-offset-2 hover:no-underline"
              >
                and {item.count - 1} more
              </Link>
            </>
          )}
        </p>
        {surface && (
          <span className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
            {surface.kind === "syllabus" ? (
              <NotebookPen className="h-3 w-3 shrink-0" aria-hidden />
            ) : (
              <Globe className="h-3 w-3 shrink-0" aria-hidden />
            )}
            <span className={detailed ? "" : "truncate"}>{surface.label}</span>
          </span>
        )}
      </div>
    </div>
  </li>
);
```

Notes:
- The coalesced suffix is now the explicit `and {count - 1} more` link, replacing the old `coalescedSuffix` text folded into `subject`. Remove the prior `const subject = ...coalescedSuffix...` line and stop importing `coalescedSuffix` if it becomes unused (the `coalesceActivity` import stays for the item grouping; `coalescedSuffix` may now be unused, remove its import if so).
- Add a `detailed?: boolean` prop (default false) to `ActivityFeedListProps`; thread it in.
- Import `formatAbsolute` from `@/lib/dates` (it already exists).
- Keep the loading and empty states unchanged.
- When `line.href` is absent (non-interactive row), there is no overlay link; the "N more" link (if present) still works because it has `pointer-events-auto`. But note: without an overlay, the surrounding `pointer-events-none` content would block the "N more" link unless the row also sets the content interactive. Simplest rule: only apply `pointer-events-none` to the content `<div>` when `line.href` is set. So compute `cn(rowClasses, "relative z-10", line.href && "pointer-events-none")`.

- [ ] **Step 2: Update the test**

In `activity-feed-list.test.tsx`:
- The whole-row link is now the overlay anchor. Update the "whole row is a link" test to find the link by its `aria-label` (or `getByRole('link', { name: /Alex Rivera/i })`) and assert its `href`.
- Add a test: a coalesced feed (`coalesce` + two same-actor same-verb rows) renders a SEPARATE link with text matching `/and \d+ more/` whose href is `/student/<actorId>/activity`. Assert there are two distinct links in that row (the overlay + the "N more").
- Keep the no-href and empty-state tests (a no-href row has no overlay link; if also coalesced, the "N more" link is still present).

- [ ] **Step 3: Verify**

Run: `cd frontend && npx tsc --noEmit && pnpm lint && pnpm vitest run --project node` (clean/green; the .test.tsx runs in CI).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/activity-feed-list.tsx frontend/src/components/activity-feed-list.test.tsx
git commit -m "feat(activity-feed): Made the coalesced count a separate link and added a detailed variant."
```

---

## Task 15: Per-student activity page

User-requested destination for the "N more" link: a minimal, uncoalesced per-student activity feed. This is the same route the future social feed will later upgrade; build only the minimal page now.

**Files:**
- Create: `frontend/src/app/student-activity/page.tsx`
- Modify: `frontend/src/App.tsx` (add the route)
- Modify: `frontend/src/app/student-profile/page.tsx` (add a "See all activity" link to the Recent activity section)
- Test: `frontend/src/app/student-activity/student-activity.test.tsx`

- [ ] **Step 1: Create the page**

`frontend/src/app/student-activity/page.tsx`: resolve `studentId` from `useParams` (guard non-finite -> Navigate to /dashboard); enforce the same access rule as the profile page (owner or coach/admin, else Navigate). Resolve the student for the title via `useAllUsers` (coach) or `useUser` (owner), mirroring `student-profile/page.tsx`. Use `useStudentActivityFeed(studentId)` (already used by the profile). Render a header (back button + "<Name>'s activity" / "Your activity") and the feed:

```tsx
<ActivityFeedList
  rows={feedQuery.data ?? []}
  isLoading={feedQuery.isLoading}
  showAvatar={false}
  detailed
  emptyText="No activity recorded yet."
/>
```

(`coalesce` defaults false, so the page shows every event uncoalesced with full titles and absolute timestamps via `detailed`.) Default-export the component.

- [ ] **Step 2: Add the route**

In `frontend/src/App.tsx`, add a lazy import `const StudentActivityPage = lazy(() => import('./app/student-activity/page'));` and a route inside `AuthedRoutes`, guarded like the other `/student/:id/*` routes:

```tsx
<Route
  path="/student/:id/activity"
  element={
    <RequireAuth>
      <StudentActivityPage />
    </RequireAuth>
  }
/>
```

- [ ] **Step 3: Link from the profile**

In `frontend/src/app/student-profile/page.tsx`, in the "Recent activity" section header, add a "See all" `<Link to={\`/student/${studentId}/activity\`}>` (small, `text-xs`, right-aligned in the section header). Keep the existing capped `ActivityFeedList` there as-is.

- [ ] **Step 4: Browser test**

`student-activity.test.tsx` (CI-only): mount the page on `/student/4/activity` via `<Routes><Route path="/student/:id/activity" .../>`, `renderWithProviders` with a coach `buildUser`, stub `window.fetch` to return the student (users list) and a couple of activity rows for the student-feed endpoint (check `frontend/src/lib/queries.ts` for the exact `useStudentActivityFeed` URL). Assert a row's text renders and the feed is uncoalesced (no "N more"). Follow the `student-profile-activity.test.tsx` fetch-stub pattern; no `vi.spyOn` of api; no `as` casts.

- [ ] **Step 5: Verify**

Run: `cd frontend && npx tsc --noEmit && pnpm lint && pnpm vitest run --project node` (clean/green).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/student-activity/page.tsx frontend/src/App.tsx frontend/src/app/student-profile/page.tsx frontend/src/app/student-activity/student-activity.test.tsx
git commit -m "feat(activity): Added a per-student activity page for the coalesced count link."
```

---

## Final verification

- [ ] **Frontend full check**

Run: `cd frontend && npx tsc --noEmit && pnpm lint && pnpm vitest run --project node`
Expected: clean / PASS. (Browser `*.test.tsx` run only in CI.)

- [ ] **Backend full check**

Run from repo root: `just lint-backend && cargo nextest run -p syllabus-tracker && just sqlx-check`
Expected: clean / PASS.

- [ ] **Manual smoke (optional, needs running app + reseed)**

Restart the backend (so it has the schema/emit changes), reseed a fresh dev DB, watch a video in a syllabus as a student, then as a coach tap that row in the dashboard feed and confirm it lands on the syllabus with the technique expanded and the video highlighted; tap an attempt row and confirm it lands on the syllabus technique.

---

## sqlx cache regen recipe (Tasks 8, 9)

Per `project-sqlx-check-seed-dependency`. The dev app holds `data/sqlite.db` open; never rebuild it. Regenerate against a temp DB by temporarily pointing `.env` at it:

```bash
cp .env /tmp/env.bak
trap 'cp /tmp/env.bak .env' EXIT
sqlite3 /tmp/clean.db < config/schema.sql
sed -i 's#^DATABASE_URL=.*#DATABASE_URL=sqlite:///tmp/clean.db#' .env
SQLX_OFFLINE=false cargo run -p syllabus-tracker --bin seed
find crates/syllabus-tracker/src -name '*.rs' -exec touch {} +
RUSTC_WRAPPER="" SQLX_OFFLINE=false cargo sqlx prepare --workspace -- -p syllabus-tracker --tests --all-features
cp /tmp/env.bak .env
trap - EXIT
```

Then `just sqlx-check` should pass. Commit the changed `.sqlx/` files (a removed query orphans its `.sqlx/query-*.json`; commit the deletion).

---

## Notes for the executor

- Tasks 1-7 and 11 are frontend-only and independently committable. Tasks 8-9 are backend. Task 10 depends on Task 9 for end-to-end behavior but compiles independently.
- Suggested PR grouping for stacking: PR1 = Tasks 1-4 (model + lines), PR2 = Task 5 (layout), PR3 = Tasks 6-7 (focus consumers), PR4 = Tasks 8-9 (backend capture), PR5 = Tasks 10-11 (client capture + cleanup).
- The `ActivityRow` type lives only in `activity-line.ts` and is imported elsewhere; adding `context_kind` there is the single wire-type change.
