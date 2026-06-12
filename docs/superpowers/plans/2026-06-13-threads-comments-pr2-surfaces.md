# Threads & Comments — PR2 (Profile + Technique surfaces) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Wire the PR1 thread/comment backend into the React frontend: an API client + TanStack hooks, one shared thread component (root post + replies + composer), surfaced as a "Discussion" block on the library technique row and a "Discussion" section on the student profile.

**Architecture:** A single reusable `ThreadView` + `ThreadComposer` + `CommentItem` trio (built from `StudentAvatar`, `Textarea`, `Button`, `border-l-2 border-border` reply indent) consumed unchanged on both surfaces. Anchors used in PR2: `technique` (library) and `student_profile`. Reads via `useQuery`, writes via `useMutation` with invalidation.

**Tech stack:** React 19 + Vite + shadcn/ui + Tailwind v4 + TanStack Query + react-hook-form/Zod. No backend changes (PR1 endpoints already live). Activate the `shadcn-ui-design` skill while building UI.

**Spec:** `docs/superpowers/specs/2026-06-12-threads-comments-design.md` (§7 frontend, §14 UI). **Divergence from §14:** the student profile page (`frontend/src/app/student-profile/page.tsx`) is a scrollable hub with NO tabs, so profile threads render as a "Discussion" `<section>` on the hub, not an "Activity tab".

**Conventions (verified in recon):**
- API: per-call `fetch` with `credentials: "include"`; GET helpers throw on `!ok` and return parsed JSON; POST/mutation helpers `throw response` on `!ok` so `TracedForm`/`unwrap` can map validation errors. Response types are `export interface` in `frontend/src/lib/api.ts`.
- Query keys: hierarchical `as const` tuples in `frontend/src/lib/query-keys.ts`.
- Hooks: `useQuery` wrappers in `frontend/src/lib/queries.ts` (use `whenId`/skipToken for optional ids); `useMutation` wrappers in `frontend/src/lib/mutations.ts` (use local `unwrap`, invalidate via `qc.invalidateQueries`).
- Technique blocks: add a `BlockId` in `frontend/src/components/technique-row/block-visibility.ts`, list it in `BLOCK_VISIBILITY`, render it in `expanded-panel.tsx`'s `BlockRenderer` switch; blocks read context via `useTechniqueRow()`.
- Tests: vitest `.test.tsx`, stub `window.fetch` via `vi.spyOn(window, "fetch")` (NOT `vi.spyOn(api, ...)`), render with `renderWithProviders` + `buildUser` from `@/test/render` / `@/test/fixtures`. These run in Chromium in CI only (not on the dev box) — write them but expect to verify via CI.
- Never edit `frontend/src/components/ui/*` (shadcn-owned). Use semantic color tokens only.

**Local gate before pushing:** `just verify` (includes frontend lint/build/test). At minimum run `cd frontend && npx tsc --noEmit && npm run lint`.

---

## File map
- Modify `frontend/src/lib/api.ts` — thread/comment fetch helpers + types.
- Modify `frontend/src/lib/query-keys.ts` — `qk.threads(...)`, `qk.thread(id)`.
- Modify `frontend/src/lib/queries.ts` — `useThreadsForAnchor`.
- Modify `frontend/src/lib/mutations.ts` — `useCreateThread`, `useCreateComment`, `useDeleteThread`, `useDeleteComment`.
- Create `frontend/src/components/threads/thread-view.tsx` — root post + replies + composer.
- Create `frontend/src/components/threads/comment-item.tsx` — a single comment/reply row.
- Create `frontend/src/components/threads/thread-composer.tsx` — new-thread + reply composer.
- Create `frontend/src/components/threads/thread-view.test.tsx` — fetch-stubbed render tests.
- Modify `frontend/src/components/technique-row/block-visibility.ts` + `expanded-panel.tsx` — `discussion` block.
- Create `frontend/src/components/technique-row/discussion-block.tsx`.
- Modify `frontend/src/app/student-profile/page.tsx` — Discussion section.

---

## Task 1: API client + types + query keys + hooks

**Files:** `api.ts`, `query-keys.ts`, `queries.ts`, `mutations.ts`.

- [ ] **Step 1: Add types + fetch helpers to `frontend/src/lib/api.ts`**

```ts
export type AnchorKind =
  | "student_profile" | "technique" | "video"
  | "video_timestamp" | "sst" | "pinned_technique";
export type ThreadVisibility = "private" | "broadcast";

export interface CommentView {
  id: number;
  thread_id: number;
  parent_comment_id: number | null;
  author_id: number;
  body: string | null; // null when soft-deleted (tombstone)
  created_at: string;
  deleted_at: string | null;
}
export interface ThreadView {
  id: number;
  anchor_kind: string;
  author_id: number;
  visibility: string;
  scope_student_id: number | null;
  body: string | null;
  created_at: string;
  deleted_at: string | null;
  comments: CommentView[];
}

export async function listThreads(
  anchorKind: AnchorKind, anchorId: number,
): Promise<ThreadView[]> {
  const res = await fetch(
    `/api/threads?anchor_kind=${anchorKind}&anchor_id=${anchorId}`,
    { credentials: "include" },
  );
  if (!res.ok) throw new Error(`Failed to load threads: ${res.statusText}`);
  const data = (await res.json()) as { threads: ThreadView[] };
  return data.threads;
}

export interface CreateThreadInput {
  anchor_kind: AnchorKind;
  anchor_id: number;
  video_ts_seconds?: number | null;
  pinned_student_id?: number | null;
  visibility: ThreadVisibility;
  scope_student_id?: number | null;
  body: string;
}
export async function createThread(input: CreateThreadInput): Promise<Response> {
  return fetch(`/api/threads`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
export async function createComment(
  threadId: number, body: string, parentCommentId?: number | null,
): Promise<Response> {
  return fetch(`/api/threads/${threadId}/comments`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body, parent_comment_id: parentCommentId ?? null }),
  });
}
export async function deleteThread(threadId: number): Promise<Response> {
  return fetch(`/api/threads/${threadId}`, { method: "DELETE", credentials: "include" });
}
export async function deleteComment(commentId: number): Promise<Response> {
  return fetch(`/api/comments/${commentId}`, { method: "DELETE", credentials: "include" });
}
```

- [ ] **Step 2: Query keys in `frontend/src/lib/query-keys.ts`** (add to the `qk` object, matching the `as const` tuple style):

```ts
  threads: (anchorKind: string, anchorId: number) =>
    ["threads", anchorKind, anchorId] as const,
  thread: (id: number) => ["thread", id] as const,
```

- [ ] **Step 3: Read hook in `frontend/src/lib/queries.ts`:**

```ts
import { listThreads, type AnchorKind } from "./api";
export function useThreadsForAnchor(anchorKind: AnchorKind, anchorId: number | undefined) {
  return useQuery({
    queryKey: qk.threads(anchorKind, anchorId ?? 0),
    queryFn: whenId(anchorId, (id) => listThreads(anchorKind, id)),
  });
}
```
(Match the existing `whenId`/`skipToken` helper signature in that file; adapt if `whenId` takes `(id, fn)` differently.)

- [ ] **Step 4: Mutations in `frontend/src/lib/mutations.ts`** (use the local `unwrap` + invalidation pattern):

```ts
import { createThread, createComment, deleteThread, deleteComment, type CreateThreadInput } from "./api";

export function useCreateThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateThreadInput) => unwrap(await createThread(input)),
    onSuccess: (_d, input) => {
      qc.invalidateQueries({ queryKey: qk.threads(input.anchor_kind, input.anchor_id) });
    },
  });
}
export function useCreateComment(anchorKind: string, anchorId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { threadId: number; body: string; parentCommentId?: number | null }) =>
      unwrap(await createComment(v.threadId, v.body, v.parentCommentId)),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.threads(anchorKind, anchorId) }),
  });
}
export function useDeleteThread(anchorKind: string, anchorId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (threadId: number) => unwrap(await deleteThread(threadId)),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.threads(anchorKind, anchorId) }),
  });
}
export function useDeleteComment(anchorKind: string, anchorId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (commentId: number) => unwrap(await deleteComment(commentId)),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.threads(anchorKind, anchorId) }),
  });
}
```
If `unwrap` returns the `Response` and a DELETE has empty body, do not `.json()` it — `unwrap` should just check `.ok`. Match the existing `unwrap` implementation.

- [ ] **Step 5: typecheck + commit**
Run: `cd frontend && npx tsc --noEmit` → no errors.
```bash
git add frontend/src/lib/api.ts frontend/src/lib/query-keys.ts frontend/src/lib/queries.ts frontend/src/lib/mutations.ts
git commit -m "feat(threads): Add frontend API client, query keys, and hooks"
```

---

## Task 2: Shared thread component (ThreadView + ThreadComposer + CommentItem)

**Files:** create `thread-view.tsx`, `thread-composer.tsx`, `comment-item.tsx`, `thread-view.test.tsx` under `frontend/src/components/threads/`.

Build per spec §14: root post = `StudentAvatar` + author name + relative time + body; replies indented under `border-l-2 border-border`; a composer (`Textarea` + `Button`). Use `useUser()` for the viewer; show a delete affordance (with `alert-dialog`) only when the viewer is the author or a coach (`user.role !== "student"`). Tombstoned bodies (`body === null`) render an italic muted "comment removed". Four states: loading (skeleton), empty ("No discussion yet. Start one."), error (toast on mutation failure), success.

- [ ] **Step 1: `comment-item.tsx`** — presentational single comment:
```tsx
import { StudentAvatar } from "@/components/student-avatar";
import { formatRelativeShort } from "@/lib/dates";
import type { CommentView } from "@/lib/api";

export function CommentItem({ comment, authorName }: { comment: CommentView; authorName: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <StudentAvatar id={comment.author_id} name={authorName} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium">{authorName}</span>
          <span className="text-xs text-muted-foreground">{formatRelativeShort(comment.created_at)}</span>
        </div>
        {comment.body === null ? (
          <p className="text-sm italic text-muted-foreground">comment removed</p>
        ) : (
          <p className="text-sm">{comment.body}</p>
        )}
      </div>
    </div>
  );
}
```
(Author display names: PR2 may not have a name lookup for arbitrary author ids. Use the `useAllUsers()` query already in the app — see `student-profile/page.tsx` import — to resolve `author_id -> display_name`, falling back to "Coach"/"Student" generic if absent. Keep it simple; a missing name renders "?".)

- [ ] **Step 2: `thread-composer.tsx`** — a `Textarea` + submit `Button`, controlled, disabled while pending, clears on success. Props: `placeholder`, `submitLabel`, `onSubmit: (body: string) => Promise<void>`, `pending: boolean`. Use semantic tokens; min-height on the textarea.

- [ ] **Step 3: `thread-view.tsx`** — renders one `ThreadView`: the root post (avatar/name/time/body), replies under `border-l-2 border-border ml-4 pl-3 space-y-3`, then a reply `ThreadComposer` wired to `useCreateComment`. A delete button (author-or-coach) using `AlertDialog`. Accept the `anchorKind`/`anchorId` so mutations can invalidate.

- [ ] **Step 4: `thread-view.test.tsx`** — stub `window.fetch`, render a thread with one reply, assert the body + reply render; assert a tombstoned comment shows "comment removed". Use `renderWithProviders` + `buildUser`.

- [ ] **Step 5: typecheck + lint + commit**
Run: `cd frontend && npx tsc --noEmit && npm run lint`.
```bash
git add frontend/src/components/threads
git commit -m "feat(threads): Add shared thread view, composer, and comment components"
```

---

## Task 3: Technique "Discussion" block

**Files:** `block-visibility.ts`, `expanded-panel.tsx`, create `discussion-block.tsx`.

- [ ] **Step 1:** Add `"discussion"` to the `BlockId` union in `block-visibility.ts`, and append `"discussion"` to the block arrays for the surfaces that should show it: `global-library` (student + coach + admin) and `student-pinned` (all). Leave `syllabus-management` out.

- [ ] **Step 2:** Create `frontend/src/components/technique-row/discussion-block.tsx`:
```tsx
import { useTechniqueRow } from "./technique-row-context";
import { useThreadsForAnchor } from "@/lib/queries";
import { useCreateThread } from "@/lib/mutations";
import { ThreadView } from "@/components/threads/thread-view";
import { ThreadComposer } from "@/components/threads/thread-composer";
import { useUser } from "@/lib/current-user-context";

export function DiscussionBlock() {
  const { technique, context } = useTechniqueRow();
  const user = useUser();
  const threadsQuery = useThreadsForAnchor("technique", technique.id);
  const createThread = useCreateThread();

  async function start(body: string) {
    // Students post a private thread scoped to themselves; coaches likewise
    // create a private thread scoped to the student in question when on a
    // per-student surface, else a private self-scoped thread.
    const scope = user.role === "student" ? user.id
      : (context.kind === "student-pinned" ? context.studentId : user.id);
    await createThread.mutateAsync({
      anchor_kind: "technique", anchor_id: technique.id,
      visibility: "private", scope_student_id: scope, body,
    });
  }

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Discussion</h4>
      {/* loading / empty / list via threadsQuery */}
      {(threadsQuery.data ?? []).map((t) => (
        <ThreadView key={t.id} thread={t} anchorKind="technique" anchorId={technique.id} />
      ))}
      <ThreadComposer placeholder="Ask about this technique…" submitLabel="Post"
        pending={createThread.isPending} onSubmit={start} />
    </div>
  );
}
```
Handle loading (skeleton) and empty ("No discussion yet. Start one.") states.

- [ ] **Step 3:** In `expanded-panel.tsx` `BlockRenderer`, add `case "discussion": return <DiscussionBlock />;` and import it.

- [ ] **Step 4: typecheck + lint + commit**
```bash
git add frontend/src/components/technique-row
git commit -m "feat(threads): Add discussion block to the technique row"
```

---

## Task 4: Profile Discussion section

**Files:** `frontend/src/app/student-profile/page.tsx`.

- [ ] **Step 1:** Add a `<section>` (above the "Recent activity" section) titled "Discussion" that lists `student_profile` threads for `studentId` via `useThreadsForAnchor("student_profile", studentId)` and renders each with `ThreadView`. Below the list, a `ThreadComposer` ("Start a thread with <name>…") wired to `useCreateThread` with `anchor_kind:"student_profile", anchor_id: studentId, visibility:"private", scope_student_id: studentId`. (A coach or the student themselves can post; the backend enforces who.) Match the existing section markup (the `rounded-lg border border-border bg-card` wrapper used by the activity list).

- [ ] **Step 2: typecheck + lint + commit**
```bash
git add frontend/src/app/student-profile/page.tsx
git commit -m "feat(threads): Add a Discussion section to the student profile"
```

---

## Task 5: Full frontend gate

- [ ] **Step 1:** Run `cd frontend && npx tsc --noEmit && npm run lint && npm run build`. Fix any errors.
- [ ] **Step 2:** Run the frontend tests if they run locally (`npm run test` — may be Chromium-only; if they don't run on this box, note it and rely on CI).
- [ ] **Step 3:** Commit any lint/build fixups:
```bash
git add -A && git commit -m "chore(threads): Frontend lint/build fixups" # only if needed
```

---

## Self-review notes
- **Profile has no tabs** — threads go in a hub `<section>`, per the real page (divergence from spec §14 noted).
- **Author name resolution** — reuse `useAllUsers()`; fall back gracefully. Don't surface email/legal name (privacy stance) — use `display_name` only.
- **Visibility** — PR2 only creates `private` threads (broadcast UI is M15/PR-later). Students self-scope; the backend rejects cross-student posts.
- **No backend changes** — if a 4xx surfaces, it's an API-contract mismatch to fix in the client, not the server.
- **Verification limit** — `.test.tsx` run in Chromium in CI only; local verification is tsc + lint + build + staging eyeball.
