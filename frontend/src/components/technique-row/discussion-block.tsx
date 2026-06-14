import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTechniqueRow } from "./technique-row-context";
import { useThreadsForAnchor } from "@/lib/queries";
import { useCreateThread } from "@/lib/mutations";
import { useUser } from "@/lib/current-user-context";
import { ThreadView } from "@/components/threads/thread-view";
import { ThreadComposer } from "@/components/threads/thread-composer";
import { cn } from "@/lib/utils";

export function DiscussionBlock() {
  const { technique, context } = useTechniqueRow();
  const user = useUser();

  // Determine which anchor this surface's discussion uses.
  // library/pinned -> the technique anchor (the library/pinned conversation).
  // syllabus       -> the sst anchor (the syllabus-context conversation).
  const anchor =
    context.kind === "student-syllabus"
      ? { kind: "sst" as const, id: context.sst.id }
      : { kind: "technique" as const, id: technique.id };

  const threadsQuery = useThreadsForAnchor(anchor.kind, anchor.id);
  const createThread = useCreateThread();

  // Scope student for a NEW private thread: a student scopes to themselves; a
  // coach on a student's pinned surface scopes to that student. A coach
  // browsing the global library has no specific student, so no composer.
  // On the syllabus surface the coach scopes to the assignment's student.
  const scopeStudentId =
    context.kind === "student-syllabus"
      ? user.role === "student"
        ? user.id
        : context.studentId
      : user.role === "student"
        ? user.id
        : context.kind === "student-pinned"
          ? context.studentId
          : undefined;

  async function start(body: string) {
    if (scopeStudentId === undefined) return;
    await createThread.mutateAsync({
      anchor_kind: anchor.kind,
      anchor_id: anchor.id,
      visibility: "private",
      scope_student_id: scopeStudentId,
      body,
    });
  }

  const threads = threadsQuery.data ?? [];

  // Deep link from the activity feed: `?thread=<id>` scrolls to and briefly
  // highlights that thread once its discussion has mounted (the feed link also
  // carries `?focus=` which expands this row). Only the block whose anchor owns
  // the thread consumes the param; others leave it for the right block.
  const [searchParams, setSearchParams] = useSearchParams();
  const listRef = useRef<HTMLDivElement>(null);
  const [highlightThreadId, setHighlightThreadId] = useState<number | null>(null);
  const consumedTargetRef = useRef(false);
  const targetThreadId = (() => {
    const raw = searchParams.get("thread");
    if (!raw) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  })();

  useEffect(() => {
    if (consumedTargetRef.current || targetThreadId == null || threadsQuery.isLoading) {
      return;
    }
    if (!threads.some((t) => t.id === targetThreadId)) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-thread-id="${targetThreadId}"]`,
    );
    if (!el) return;
    consumedTargetRef.current = true;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightThreadId(targetThreadId);
    const timer = setTimeout(() => setHighlightThreadId(null), 2200);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("thread");
        return next;
      },
      { replace: true },
    );
    return () => clearTimeout(timer);
  }, [targetThreadId, threadsQuery.isLoading, threads, setSearchParams]);

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Discussion</h4>
      {threadsQuery.isLoading ? (
        <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
      ) : threads.length === 0 ? null : (
        <div ref={listRef} className="divide-y divide-border">
          {threads.map((t) => (
            <div
              key={t.id}
              data-thread-id={t.id}
              className={cn(
                "rounded-md py-4 transition-colors first:pt-0 last:pb-0",
                highlightThreadId === t.id && "bg-muted/60 ring-2 ring-ring/50",
              )}
            >
              <ThreadView thread={t} anchorKind={anchor.kind} anchorId={anchor.id} />
            </div>
          ))}
        </div>
      )}
      {scopeStudentId !== undefined && (
        <ThreadComposer
          placeholder="Discuss…"
          submitLabel="Post"
          pending={createThread.isPending}
          onSubmit={start}
        />
      )}
    </div>
  );
}
