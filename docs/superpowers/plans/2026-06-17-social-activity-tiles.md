# Social Activity Tiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new social-media-style feed page that renders each activity as the noun it acted on (a technique row in its surface context, or a thread/comment), stacked under a "who did what" header. It becomes the default landing for students and coaches; the existing `ActivityFeedList` and the classic dashboard are preserved.

**Architecture:** A standalone `ActivityTileFeed` (separate from `ActivityFeedList`) maps each `ActivityRow` to a social header plus an embedded tile. A pure `tile-kind` taxonomy picks the tile; `TechniqueTile` hydrates the unified `TechniqueRow` from cached list queries; `CommentTile` hydrates a thread and embeds `ThreadView`. A role-aware `SocialFeedPage` renders the student's own feed or the coach's gym-wide feed and is wired at `/dashboard`; the old dashboard moves to `/dashboard/classic`.

**Tech Stack:** React 19 + Vite SPA, TanStack Query, react-router-dom v7, shadcn/ui, Vitest (node `*.unit.test.ts` + browser `*.test.tsx`). No backend change.

---

## Conventions

- Commit format: `feat(scope): Sentence in past tense.` No co-author trailer. No em-dashes (use commas/periods/parens). Status copy is `New`/`Doing`/`Done`.
- Frontend checks (runnable here): `cd frontend && npx tsc --noEmit && pnpm lint && pnpm vitest run --project node`. Browser `*.test.tsx` runs in CI only; write to convention. In `*.test.tsx` never `vi.spyOn` an `@/lib/api` export (stub `window.fetch`); no `as` casts (build fixtures with helpers).
- Never `git stash` in this repo.

## File structure

**New (`frontend/src/components/activity-feed/`):**
- `tile-kind.ts` - pure `activityTileKind(row)`; the one place the taxonomy lives.
- `to-library-shape.ts` - shared `SstRow -> LibraryTechniqueRow` adapter.
- `activity-tile-header.tsx` - social header (avatar + actor + verb line + surface chip + time).
- `technique-tile.tsx` - hydrate + render embedded `TechniqueRow`.
- `comment-tile.tsx` - hydrate thread + render embedded `ThreadView` with anchor chip.
- `activity-tile.tsx` - per-row slot: dispatch by tile-kind; fixed-height skeleton; null = header-only.
- `activity-tile-feed.tsx` - the list (header + tile per row), loading/empty states.

**New page:** `frontend/src/app/feed/page.tsx` - role-aware `SocialFeedPage`.

**Changed:**
- `components/technique-row/technique-row.tsx` - add `embedded?: boolean`; gate the four chrome buttons.
- `components/activity-feed-list.tsx` - export `verbIconMeta` (no behavior change).
- `app/student-syllabi/[syllabusId]/page.tsx` - import the shared `toLibraryShape`.
- `lib/queries.ts` - `useActivityFeed(enabled, limit)` (limit param).
- `App.tsx` - `/dashboard` -> `SocialFeedPage`; add `/dashboard/classic` -> classic `Dashboard`.
- `components/navbar.tsx`, `components/bottom-nav.tsx` - relabel the `/dashboard` link to "Feed".

---

## Task 1: Shared toLibraryShape adapter

**Files:** Create `frontend/src/components/activity-feed/to-library-shape.ts`; Modify `frontend/src/app/student-syllabi/[syllabusId]/page.tsx`.

- [ ] **Step 1:** Create the adapter (lifted verbatim from the page):

```ts
import type { LibraryTechniqueRow, SstRow } from "@/lib/api";

/** Adapt an SstRow to the LibraryTechniqueRow shape the technique-row blocks
 *  expect. The SST carries technique fields under different keys. */
export function toLibraryShape(sst: SstRow): LibraryTechniqueRow {
  return {
    id: sst.technique_id,
    name: sst.technique_name,
    description: sst.technique_description,
    tags: sst.tags,
    collection_ids: [],
    collection_count: 0,
    student_count: 0,
    video_count: sst.video_count,
    last_activity_at: sst.last_attempt_at,
    is_pinned: false,
  };
}
```

- [ ] **Step 2:** In the page, delete the local `toLibraryShape` and import it:
  `import { toLibraryShape } from "@/components/activity-feed/to-library-shape";`
- [ ] **Step 3:** `cd frontend && npx tsc --noEmit` -> PASS.
- [ ] **Step 4:** Commit: `refactor(activity): Extract shared toLibraryShape adapter.`

---

## Task 2: Tile-kind taxonomy (pure)

**Files:** Create `frontend/src/components/activity-feed/tile-kind.ts`; Test `frontend/src/components/activity-feed/tile-kind.unit.test.ts`.

- [ ] **Step 1: Write the failing test:**

```ts
import { describe, it, expect } from "vitest";
import { activityTileKind } from "./tile-kind";
import type { ActivityRow } from "@/lib/activity-line";

const base: ActivityRow = {
  id: 1, occurred_at: "2026-06-17T00:00:00Z", verb: "sst_status_changed",
  actor_user_id: 1, actor_name: "Coach", target_student_id: 2,
  target_student_name: "Sam", technique_id: 3, technique_name: "Armbar",
  syllabus_id: 4, syllabus_name: "Blue Belt", sst_id: 5, video_id: null,
  video_title: null, payload_json: null, unread: false,
  context_kind: "syllabus", thread_id: null, camp_id: null,
  competition_id: null, match_id: null,
};

describe("activityTileKind", () => {
  it("maps technique verbs to a technique tile", () => {
    expect(activityTileKind(base)).toEqual({ kind: "technique" });
    expect(activityTileKind({ ...base, verb: "video_watched", video_id: 9, video_title: "Drill" }))
      .toEqual({ kind: "technique" });
  });
  it("maps a comment to a comment tile with the right anchor", () => {
    expect(activityTileKind({ ...base, verb: "thread_comment_posted", thread_id: 7 }))
      .toEqual({ kind: "comment", anchorKind: "sst", anchorId: 5, threadId: 7 });
    expect(activityTileKind({
      ...base, verb: "thread_comment_posted", thread_id: 7,
      context_kind: "library", sst_id: null,
    })).toEqual({ kind: "comment", anchorKind: "technique", anchorId: 3, threadId: 7 });
    expect(activityTileKind({
      ...base, verb: "thread_comment_posted", thread_id: 7, video_id: 11,
    })).toEqual({ kind: "comment", anchorKind: "video", anchorId: 11, threadId: 7 });
  });
  it("returns null for non-noun verbs", () => {
    expect(activityTileKind({ ...base, verb: "syllabus_assigned" })).toBeNull();
    expect(activityTileKind({ ...base, verb: "camp_created", context_kind: "camp" })).toBeNull();
  });
});
```

- [ ] **Step 2:** Run `cd frontend && pnpm vitest run --project node tile-kind` -> FAIL (no module).
- [ ] **Step 3:** Implement:

```ts
import type { ActivityRow } from "@/lib/activity-line";
import type { AnchorKind } from "@/lib/api";

export type TileKind =
  | { kind: "technique" }
  | { kind: "comment"; anchorKind: AnchorKind; anchorId: number; threadId: number }
  | null;

const TECHNIQUE_VERBS = new Set([
  "attempt_logged", "attempt_edited", "attempt_deleted",
  "sst_status_changed", "sst_student_notes_edited", "sst_coach_notes_edited",
  "technique_pinned", "technique_unpinned",
  "sst_added", "sst_hidden", "sst_unhidden",
  "syllabus_technique_added", "syllabus_technique_removed", "technique_edited",
  "video_watched", "video_added", "video_visibility_set",
]);

/** Pick the tile (and, for comments, the thread anchor) for an activity row.
 *  Pure. null means header-only (no noun to embed). The one place the feed
 *  taxonomy lives. */
export function activityTileKind(row: ActivityRow): TileKind {
  if (row.verb === "thread_comment_posted") {
    if (row.thread_id == null) return null;
    if (row.video_id != null) {
      return { kind: "comment", anchorKind: "video", anchorId: row.video_id, threadId: row.thread_id };
    }
    if (row.context_kind === "syllabus" && row.sst_id != null) {
      return { kind: "comment", anchorKind: "sst", anchorId: row.sst_id, threadId: row.thread_id };
    }
    if (row.technique_id != null) {
      return { kind: "comment", anchorKind: "technique", anchorId: row.technique_id, threadId: row.thread_id };
    }
    return null;
  }
  // Camp/competition/match surfaces are gated off; no tile yet.
  if (row.context_kind === "camp" || row.context_kind === "competition") return null;
  if (TECHNIQUE_VERBS.has(row.verb) && row.technique_id != null) return { kind: "technique" };
  return null;
}
```

- [ ] **Step 4:** Run the test -> PASS.
- [ ] **Step 5:** Commit: `feat(activity): Add the activity tile-kind taxonomy.`

---

## Task 3: Embedded flag on TechniqueRow

**Files:** Modify `frontend/src/components/technique-row/technique-row.tsx`.

- [ ] **Step 1:** Add `embedded?: boolean;` to `TechniqueRowProps` (doc: "Feed/preview mode: suppress the row-chrome action buttons (pin, remove, hidden toggle, add-to-camp). The expand panel and its per-role blocks are unchanged.").
- [ ] **Step 2:** Destructure `embedded` in the component signature.
- [ ] **Step 3:** Gate the four chrome booleans with `!embedded &&`:
  `const showPinButton = !embedded && viewerIsOwner && (...)`,
  `const showAddToCampButton = !embedded && context.kind === "student-pinned" && (...)`,
  `const showRemoveButton = !embedded && (context.kind === "syllabus-management" || (...))`,
  `const showHiddenToggle = !embedded && context.kind === "student-syllabus" && (...)`.
- [ ] **Step 4:** `cd frontend && npx tsc --noEmit && pnpm lint` -> PASS.
- [ ] **Step 5:** Commit: `feat(technique-row): Add an embedded mode that hides curation chrome.`

---

## Task 4: Export verbIconMeta + activity header

**Files:** Modify `frontend/src/components/activity-feed-list.tsx`; Create `frontend/src/components/activity-feed/activity-tile-header.tsx`.

- [ ] **Step 1:** In `activity-feed-list.tsx` change `function verbIconMeta` to `export function verbIconMeta` (no other change).
- [ ] **Step 2:** Create the header. It renders the same narrative as a feed row (avatar + actor + verb/status/subject line + surface chip + time), reusing `activityLine`, `verbIconMeta`, `activitySurface`, `statusToDotClass`:

```tsx
import { Link } from "react-router-dom";
import { Dumbbell, Library, NotebookPen } from "lucide-react";
import { StudentAvatar } from "@/components/student-avatar";
import { activityLine, type ActivityRow, type ActivityScope } from "@/lib/activity-line";
import { verbIconMeta } from "@/components/activity-feed-list";
import { activitySurface } from "@/lib/view-context";
import { statusToDotClass } from "@/lib/status";
import { formatRelativeShort } from "@/lib/dates";
import { cn } from "@/lib/utils";

/** The "who did what, when" header above a feed tile. The header (not the
 *  tile) is the deep-link to the source surface. */
export function ActivityTileHeader({
  row,
  scope,
  showAvatar = true,
}: {
  row: ActivityRow;
  scope: ActivityScope;
  showAvatar?: boolean;
}) {
  const line = activityLine(row, scope);
  const surface = activitySurface(row);
  const { Icon: VerbIcon, colorClass } = verbIconMeta(row.verb);
  const actorName = row.actor_name ?? "A student";

  const body = (
    <div className="flex items-start gap-3 px-4 py-3">
      {showAvatar && (
        <StudentAvatar id={row.actor_user_id} name={row.actor_name ?? "?"} />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-medium">{actorName}</p>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatRelativeShort(row.occurred_at)}
          </span>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          <VerbIcon className={cn("mr-1 inline-block h-4 w-4 align-text-bottom", colorClass)} aria-hidden />
          {line.verb}
          {line.statusLabel ? (
            <>
              {" "}
              <span className={cn("inline-block h-2 w-2 rounded-full align-middle", line.statusColor ? statusToDotClass(line.statusColor) : "")} aria-hidden />
              {" "}{line.statusLabel}{line.subject ? ` on ${line.subject}` : ""}
            </>
          ) : (
            line.subject ? ` ${line.subject}` : ""
          )}
        </p>
        {surface && !line.suppressSurface && (
          <span className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
            {surface.kind === "syllabus" ? (
              <NotebookPen className="h-3 w-3 shrink-0" aria-hidden />
            ) : surface.kind === "camp" ? (
              <Dumbbell className="h-3 w-3 shrink-0" aria-hidden />
            ) : (
              <Library className="h-3 w-3 shrink-0" aria-hidden />
            )}
            <span className="truncate">{surface.label}</span>
          </span>
        )}
      </div>
    </div>
  );

  return line.href ? (
    <Link to={line.href} className="block transition-colors hover:bg-muted/40">
      {body}
    </Link>
  ) : (
    body
  );
}
```

- [ ] **Step 3:** `cd frontend && npx tsc --noEmit && pnpm lint && pnpm vitest run --project node` -> PASS (existing feed tests unaffected).
- [ ] **Step 4:** Commit: `feat(activity): Add a reusable activity tile header.`

---

## Task 5: TechniqueTile

**Files:** Create `frontend/src/components/activity-feed/technique-tile.tsx`.

- [ ] **Step 1:** Implement. Resolve the row's `ViewContext`; switch into a per-kind subcomponent that calls exactly one list hook, locates the entity, and renders an `Accordion` wrapping one embedded `TechniqueRow`. Returns `null` when unresolved/missing so the entry is header-only.

```tsx
import { useState } from "react";
import { Accordion } from "@/components/ui/accordion";
import { TechniqueRow } from "@/components/technique-row";
import { useUser } from "@/lib/current-user-context";
import { isCoachOrAdmin } from "@/lib/api";
import {
  useLibraryTechniques,
  useStudentLibrary,
  useStudentSyllabusTechniques,
} from "@/lib/queries";
import { rowToViewContext } from "@/lib/view-context";
import type { ActivityRow } from "@/lib/activity-line";
import { toLibraryShape } from "./to-library-shape";

/** Embedded technique row for a feed entry. Hydrates from the same cached
 *  list queries the native surfaces use (TanStack Query dedups across the
 *  feed). null while no entity resolves -> the entry stays header-only. */
export function TechniqueTile({ row }: { row: ActivityRow }) {
  const ctx = rowToViewContext(row);
  if (ctx?.kind === "syllabus") {
    return <SyllabusTile row={row} studentId={ctx.student.id} syllabusId={ctx.syllabus.id} sstId={ctx.sst.id} />;
  }
  if (ctx?.kind === "library" && row.technique_id != null) {
    return <LibraryTile techniqueId={row.technique_id} videoId={row.video_id} />;
  }
  return null;
}

function TileShell({ children }: { children: React.ReactNode }) {
  return <div className="mx-3 mb-3 overflow-hidden rounded-md border border-border bg-card">{children}</div>;
}

function SyllabusTile({ row, studentId, syllabusId, sstId }: {
  row: ActivityRow; studentId: number; syllabusId: number; sstId: number;
}) {
  const query = useStudentSyllabusTechniques(studentId, syllabusId);
  const [open, setOpen] = useState<string>("");
  if (query.isLoading) return <TileSkeleton />;
  const data = query.data;
  const assignment = data?.assignment;
  const sst = data?.techniques.find((s) => s.id === sstId);
  if (!sst || !assignment) return null;
  const value = `sst-${sst.id}`;
  return (
    <TileShell>
      <Accordion type="single" collapsible value={open} onValueChange={setOpen}>
        <TechniqueRow
          embedded
          technique={toLibraryShape(sst)}
          context={{
            kind: "student-syllabus",
            studentId, syllabusId,
            syllabusName: assignment.syllabus_name,
            assignmentId: assignment.id,
            sst,
            graduatedAt: assignment.graduated_at,
          }}
          value={value}
          isOpen={open === value}
          scrollToVideoId={open === value ? row.video_id : null}
        />
      </Accordion>
    </TileShell>
  );
}

function LibraryTile({ techniqueId, videoId }: { techniqueId: number; videoId: number | null }) {
  const user = useUser();
  const coach = isCoachOrAdmin(user);
  const coachLib = useLibraryTechniques();
  const studentLib = useStudentLibrary(coach ? undefined : user.id);
  const [open, setOpen] = useState<string>("");
  const lib = coach ? coachLib : studentLib;
  if (lib.isLoading) return <TileSkeleton />;
  const technique = (lib.data ?? []).find((t) => t.id === techniqueId);
  if (!technique) return null;
  const value = `tech-${technique.id}`;
  return (
    <TileShell>
      <Accordion type="single" collapsible value={open} onValueChange={setOpen}>
        <TechniqueRow
          embedded
          technique={technique}
          context={{ kind: "global-library" }}
          value={value}
          isOpen={open === value}
          scrollToVideoId={open === value ? videoId : null}
        />
      </Accordion>
    </TileShell>
  );
}

export function TileSkeleton() {
  return (
    <div className="mx-3 mb-3 rounded-md border border-border bg-card px-4 py-3">
      <div className="h-4 w-2/5 animate-pulse rounded bg-muted" />
      <div className="mt-2 h-3 w-1/4 animate-pulse rounded bg-muted" />
    </div>
  );
}
```

- [ ] **Step 2:** `cd frontend && npx tsc --noEmit && pnpm lint` -> PASS.
- [ ] **Step 3:** Commit: `feat(activity): Add the embedded technique tile.`

---

## Task 6: CommentTile

**Files:** Create `frontend/src/components/activity-feed/comment-tile.tsx`.

- [ ] **Step 1:** Implement. Hydrate the thread for the row's anchor, find it by id, and embed `ThreadView` with an anchor chip. null when unresolved.

```tsx
import { MessageSquare } from "lucide-react";
import { ThreadView } from "@/components/threads/thread-view";
import { useThreadsForAnchor } from "@/lib/queries";
import type { ActivityRow } from "@/lib/activity-line";
import type { AnchorKind } from "@/lib/api";
import { TileSkeleton } from "./technique-tile";

/** Embedded thread for a comment activity. Anchor chip names the video or
 *  technique the conversation lives on. null while the thread can't resolve. */
export function CommentTile({ row, anchorKind, anchorId, threadId }: {
  row: ActivityRow; anchorKind: AnchorKind; anchorId: number; threadId: number;
}) {
  const query = useThreadsForAnchor(anchorKind, anchorId);
  if (query.isLoading) return <TileSkeleton />;
  const thread = (query.data ?? []).find((t) => t.id === threadId);
  if (!thread) return null;
  const anchorLabel = row.video_title ?? row.technique_name ?? null;
  return (
    <div className="mx-3 mb-3 overflow-hidden rounded-md border border-border bg-card">
      {anchorLabel && (
        <div className="flex items-center gap-1.5 border-b border-border px-4 py-2 text-xs text-muted-foreground">
          <MessageSquare className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">on {anchorLabel}</span>
        </div>
      )}
      <div className="px-4 py-3">
        <ThreadView thread={thread} anchorKind={anchorKind} anchorId={anchorId} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2:** `cd frontend && npx tsc --noEmit && pnpm lint` -> PASS.
- [ ] **Step 3:** Commit: `feat(activity): Add the embedded comment tile.`

---

## Task 7: ActivityTile slot

**Files:** Create `frontend/src/components/activity-feed/activity-tile.tsx`.

- [ ] **Step 1:** Implement the dispatch:

```tsx
import { activityTileKind } from "./tile-kind";
import { TechniqueTile } from "./technique-tile";
import { CommentTile } from "./comment-tile";
import type { ActivityRow } from "@/lib/activity-line";

/** The embedded tile beneath a feed entry's header. null = header-only. */
export function ActivityTile({ row }: { row: ActivityRow }) {
  const kind = activityTileKind(row);
  if (kind == null) return null;
  if (kind.kind === "technique") return <TechniqueTile row={row} />;
  return <CommentTile row={row} anchorKind={kind.anchorKind} anchorId={kind.anchorId} threadId={kind.threadId} />;
}
```

- [ ] **Step 2:** `cd frontend && npx tsc --noEmit && pnpm lint` -> PASS.
- [ ] **Step 3:** Commit: `feat(activity): Add the activity tile slot dispatcher.`

---

## Task 8: ActivityTileFeed

**Files:** Create `frontend/src/components/activity-feed/activity-tile-feed.tsx`.

- [ ] **Step 1:** Implement the list. Gate out gated surfaces (mirror `ActivityFeedList`'s `campsUiEnabled` filter via `activitySurface`). Reverse-chronological is already the row order.

```tsx
import { ActivityTileHeader } from "./activity-tile-header";
import { ActivityTile } from "./activity-tile";
import { activitySurface } from "@/lib/view-context";
import { campsUiEnabled } from "@/lib/features";
import type { ActivityRow, ActivityScope } from "@/lib/activity-line";

/** Social-media-style feed: each row renders a "who did what" header over an
 *  embedded tile of the noun it acted on. Separate from ActivityFeedList (the
 *  compact one-line feed), which is still used by the dashboard glance and the
 *  profile/timeline surfaces. */
export function ActivityTileFeed({
  rows, isLoading, scope, showAvatar = true,
  emptyText = "No activity yet.",
}: {
  rows: ActivityRow[];
  isLoading: boolean;
  scope: ActivityScope;
  showAvatar?: boolean;
  emptyText?: string;
}) {
  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="px-4 py-3">
              <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
              <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-muted" />
            </div>
            <div className="mx-3 mb-3 h-16 animate-pulse rounded-md bg-muted/50" />
          </div>
        ))}
      </div>
    );
  }

  const visible = campsUiEnabled
    ? rows
    : rows.filter((row) => {
        const kind = activitySurface(row)?.kind;
        return kind !== "camp" && kind !== "competition" && kind !== "match";
      });

  if (visible.length === 0) {
    return <p className="rounded-lg border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <ul className="space-y-4">
      {visible.map((row) => (
        <li key={`${row.id}-${row.occurred_at}`} className="overflow-hidden rounded-lg border border-border bg-card">
          <ActivityTileHeader row={row} scope={scope} showAvatar={showAvatar} />
          <ActivityTile row={row} />
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2:** `cd frontend && npx tsc --noEmit && pnpm lint` -> PASS.
- [ ] **Step 3:** Commit: `feat(activity): Add the social activity tile feed.`

---

## Task 9: useActivityFeed limit param

**Files:** Modify `frontend/src/lib/queries.ts`.

- [ ] **Step 1:** Change the gym feed hook to accept a limit:

```ts
export function useActivityFeed(enabled: boolean = true, limit = 20) {
  return useQuery({
    queryKey: qk.activityFeed(limit),
    queryFn: enabled ? () => getActivityFeed({ limit }) : skipToken,
  });
}
```
If `qk.activityFeed` takes no arg, update its key factory in `lib/query-keys.ts` to `(limit: number) => [...]` and fix the one existing caller (`useActivityFeed()` default still works).

- [ ] **Step 2:** `cd frontend && npx tsc --noEmit` -> PASS.
- [ ] **Step 3:** Commit: `feat(activity): Allow a custom limit on the gym activity feed hook.`

---

## Task 10: SocialFeedPage (role-aware)

**Files:** Create `frontend/src/app/feed/page.tsx`.

- [ ] **Step 1:** Implement:

```tsx
import { Link } from "react-router-dom";
import { Activity, LayoutDashboard } from "lucide-react";
import { ActivityTileFeed } from "@/components/activity-feed/activity-tile-feed";
import { useStudentActivityFeed, useActivityFeed } from "@/lib/queries";
import { useUser } from "@/lib/current-user-context";
import { isCoachOrAdmin } from "@/lib/api";

export default function SocialFeedPage() {
  const user = useUser();
  return isCoachOrAdmin(user) ? <CoachFeed /> : <StudentFeed studentId={user.id} />;
}

function StudentFeed({ studentId }: { studentId: number }) {
  const feed = useStudentActivityFeed(studentId, 50);
  return (
    <Shell title="Your feed">
      <ActivityTileFeed
        rows={feed.data ?? []}
        isLoading={feed.isLoading}
        scope={{ kind: "student", studentId }}
        showAvatar={false}
        emptyText="Nothing here yet. Train, log attempts, and watch videos to fill your feed."
      />
    </Shell>
  );
}

function CoachFeed() {
  const feed = useActivityFeed(true, 50);
  return (
    <Shell title="Gym feed" showClassicLink>
      <ActivityTileFeed
        rows={feed.data ?? []}
        isLoading={feed.isLoading}
        scope={{ kind: "gym" }}
        emptyText="No gym activity yet."
      />
    </Shell>
  );
}

function Shell({ title, children, showClassicLink = false }: {
  title: string; children: React.ReactNode; showClassicLink?: boolean;
}) {
  return (
    <div className="container mx-auto max-w-2xl px-4 py-6 sm:px-6 md:py-8 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-base font-semibold">
          <Activity className="h-4 w-4" aria-hidden />
          {title}
        </h1>
        {showClassicLink && (
          <Link to="/dashboard/classic" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <LayoutDashboard className="h-3.5 w-3.5" aria-hidden />
            Classic dashboard
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}
```

- [ ] **Step 2:** `cd frontend && npx tsc --noEmit && pnpm lint` -> PASS.
- [ ] **Step 3:** Commit: `feat(activity): Add the role-aware social feed page.`

---

## Task 11: Wire routes + nav

**Files:** Modify `frontend/src/App.tsx`, `frontend/src/components/navbar.tsx`, `frontend/src/components/bottom-nav.tsx`.

- [ ] **Step 1:** In `App.tsx` add a lazy import near the other page imports:
  `const SocialFeedPage = lazy(() => import("./app/feed/page"));` (match the file's existing lazy-import style; if pages are imported eagerly, mirror that).
- [ ] **Step 2:** Point `/dashboard` at the feed and preserve the classic dashboard:

```tsx
<Route path="/dashboard" element={<RequireAuth><SocialFeedPage /></RequireAuth>} />
<Route path="/dashboard/classic" element={<RequireAuth><Dashboard /></RequireAuth>} />
```

- [ ] **Step 3:** In `navbar.tsx` change the `/dashboard` link label from `"Dashboard"` to `"Feed"`. In `bottom-nav.tsx` change the `/dashboard` item label to `"Feed"` (keep the icon or swap `LayoutDashboard` -> `Activity` from lucide; keep it minimal).
- [ ] **Step 4:** `cd frontend && npx tsc --noEmit && pnpm lint && pnpm vitest run --project node` -> PASS.
- [ ] **Step 5:** Commit: `feat(activity): Default the dashboard to the social feed, keep classic at /dashboard/classic.`

---

## Task 12: Component tests (CI-only)

**Files:** Create `frontend/src/components/activity-feed/activity-tile.test.tsx`.

- [ ] **Step 1:** Write tests (stub `window.fetch`; render with the project's `renderWithProviders` + `buildUser`; no `as`). Cover: a `sst_status_changed` row renders the header verb line and, once its syllabus fetch resolves, an embedded technique row with no pin/remove chrome; a `syllabus_assigned` row renders header-only (no tile container); a `thread_comment_posted` row renders the embedded thread after the threads fetch resolves. Follow the existing `activity-feed-list.test.tsx` fixture/stub patterns.
- [ ] **Step 2:** `cd frontend && npx tsc --noEmit && pnpm lint` -> PASS (browser test runs in CI).
- [ ] **Step 3:** Commit: `test(activity): Cover the social activity tile rendering.`

---

## Final verification

- [ ] `cd frontend && npx tsc --noEmit && pnpm lint && pnpm vitest run --project node` -> all green.
- [ ] `nix develop .#ci --command just lint` (backend untouched; keep green) if quick.
- [ ] Manual smoke via `/run` if practical: log in as a student -> land on the feed, a status/attempt entry shows the technique tile in syllabus context, expands in place to videos/notes, the header deep-links to the syllabus; log in as a coach -> land on the gym feed; "Classic dashboard" link reaches `/dashboard/classic`.
- [ ] Rebase onto `main`; push; open PR; deploy to staging.

## Self-review notes

- Spec coverage: technique tile (Task 5), comment tile incl. video/sst/technique anchors (Tasks 2,6), header-only fallback + gated surfaces (Tasks 2,8), embedded chrome suppression (Task 3), skeleton/no-CLS (Tasks 5,8), separate from ActivityFeedList (Task 8, untouched except an export), new default page for both roles (Tasks 10,11), classic dashboard preserved (Task 11).
- Type consistency: `TileKind` discriminant `kind` used the same in `tile-kind.ts`, `activity-tile.tsx`. `TileSkeleton` defined in `technique-tile.tsx`, imported by `comment-tile.tsx`. `toLibraryShape` single source (Task 1) used by Task 5 and the page.
- Deferred: camp/match tiles, standalone video card, batch hydration endpoint, syllabus card.
