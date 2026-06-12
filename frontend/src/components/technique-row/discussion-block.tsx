import { useTechniqueRow } from "./technique-row-context";
import { useThreadsForAnchor } from "@/lib/queries";
import { useCreateThread } from "@/lib/mutations";
import { useUser } from "@/lib/current-user-context";
import { ThreadView } from "@/components/threads/thread-view";
import { ThreadComposer } from "@/components/threads/thread-composer";

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

  // Students ask; coaches comment. The composer copy follows the viewer.
  const composerPlaceholder =
    user.role === "student"
      ? "Ask about this technique…"
      : "Comment on this technique…";

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Discussion</h4>
      {threadsQuery.isLoading ? (
        <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
      ) : threads.length === 0 ? (
        <p className="text-sm text-muted-foreground">No discussion yet.{scopeStudentId !== undefined ? " Start one." : ""}</p>
      ) : (
        <div className="divide-y divide-border">
          {threads.map((t) => (
            <div key={t.id} className="py-4 first:pt-0 last:pb-0">
              <ThreadView thread={t} anchorKind={anchor.kind} anchorId={anchor.id} />
            </div>
          ))}
        </div>
      )}
      {scopeStudentId !== undefined && (
        <ThreadComposer
          placeholder={composerPlaceholder}
          submitLabel="Post"
          pending={createThread.isPending}
          onSubmit={start}
        />
      )}
    </div>
  );
}
