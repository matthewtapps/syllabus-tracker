import { useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import {
  Archive,
  Dumbbell,
  History,
  MessageSquare,
  NotebookPen,
  Pin,
  Plus,
  Settings,
} from "lucide-react";
import { toast } from "sonner";
import { StudentAvatar } from "@/components/student-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Accordion } from "@/components/ui/accordion";
import { CreateCampDialog } from "@/components/camps/create-camp-dialog";
import { AccountDialog } from "@/components/account-dialog";
import { EmptyState } from "@/components/empty-state";
import { TechniqueRow } from "@/components/technique-row";
import {
  useStudentActivityFeed,
  useAllUsers,
  useCampsForStudent,
  useThreadsForAnchor,
  useStudentSyllabi,
  useStudentPinnedTechniques,
} from "@/lib/queries";
import { useCreateThread, useArchiveStudent } from "@/lib/mutations";
import { useUser } from "@/lib/current-user-context";
import { isAdmin, isCoachOrAdmin } from "@/lib/api";
import { CampSummaryCard } from "@/components/camp-summary-card";
import { ActivityFeedList } from "@/components/activity-feed-list";
import { ThreadView } from "@/components/threads/thread-view";
import { ReplyComposer } from "@/components/threads/reply-composer";
import { useThreadFocus } from "@/components/threads/use-thread-focus";
import { cn } from "@/lib/utils";
import { SyllabusAssignmentRow } from "@/app/student-syllabi/components/syllabus-assignment-row";
import type { User } from "@/lib/api";

export default function StudentProfilePage() {
  const params = useParams<{ id: string }>();
  const studentId = params.id ? parseInt(params.id, 10) : NaN;
  const viewer = useUser();

  if (!Number.isFinite(studentId)) {
    return <Navigate to="/dashboard" replace />;
  }

  const isOwner = viewer.id === studentId;
  const isCoach = isCoachOrAdmin(viewer);
  if (!isOwner && !isCoach) {
    return <Navigate to="/dashboard" replace />;
  }

  return <ProfileHub studentId={studentId} isOwnView={isOwner} />;
}

function ProfileHub({
  studentId,
  isOwnView,
}: {
  studentId: number;
  isOwnView: boolean;
}) {
  const viewer = useUser();
  const navigate = useNavigate();
  // Coaches can create a camp for the student whose profile they're viewing.
  const canCreateCamp = isCoachOrAdmin(viewer) && !isOwnView;
  const [createCampOpen, setCreateCampOpen] = useState(false);
  // For the owning student we already have the viewer; for coaches we
  // need to fetch the student by id. /api/me only returns the current
  // user, so coaches use the users list (cached, cheap) to resolve.
  const usersQuery = useAllUsers();
  const student: User | undefined = useMemo(() => {
    if (isOwnView) return viewer;
    return (usersQuery.data ?? []).find((u) => u.id === studentId);
  }, [isOwnView, viewer, usersQuery.data, studentId]);
  // Use the student-scoped feed so a coach sees only THIS student's activity
  // rather than the gym-wide coach feed.
  const feedQuery = useStudentActivityFeed(studentId);
  const profileThreadsQuery = useThreadsForAnchor("student_profile", studentId);
  // `?thread=<id>` from the activity feed scrolls to and highlights that thread.
  const profileThreads = useMemo(
    () => profileThreadsQuery.data ?? [],
    [profileThreadsQuery.data],
  );
  const profileThreadsRef = useRef<HTMLDivElement>(null);
  const { highlightThreadId } = useThreadFocus(
    profileThreads,
    profileThreadsRef,
    profileThreadsQuery.isLoading,
  );
  const createProfileThread = useCreateThread();
  async function startProfileThread(body: string, attachment: import("@/components/threads/reply-composer").VideoAttachment | null) {
    await createProfileThread.mutateAsync({
      anchor_kind: "student_profile",
      anchor_id: studentId,
      visibility: "private",
      scope_student_id: studentId,
      body,
      attached_video_id: attachment?.videoId ?? null,
      attached_video_is_reference: attachment?.isReference ?? null,
      attached_video_title: attachment?.title ?? null,
    });
  }

  const loading = !isOwnView && usersQuery.isLoading;

  const viewerIsAdmin = isAdmin(viewer);
  const isCoach = isCoachOrAdmin(viewer);
  const canManageAccount = isOwnView || (viewerIsAdmin && !isOwnView);
  const canArchive = isCoach && !isOwnView;
  const [accountOpen, setAccountOpen] = useState(false);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const archiveMutation = useArchiveStudent();
  const syllabiQuery = useStudentSyllabi(studentId);
  const pinnedQuery = useStudentPinnedTechniques(studentId);
  const campsQuery = useCampsForStudent(studentId);
  const [pinnedExpanded, setPinnedExpanded] = useState<string>("");

  if (loading || !student) {
    return (
      <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 animate-pulse rounded-full bg-muted" />
          <div className="space-y-2">
            <div className="h-4 w-32 animate-pulse rounded bg-muted" />
            <div className="h-3 w-24 animate-pulse rounded bg-muted" />
          </div>
        </div>
      </div>
    );
  }

  const displayName = student.display_name || student.username;

  const previewSyllabi = (syllabiQuery.data ?? []).slice(0, 5);
  const previewPinned = (pinnedQuery.data ?? []).slice(0, 5);
  const previewCamps = (campsQuery.data ?? []).filter((c) => !c.archived_at).slice(0, 5);

  return (
    <div className="container mx-auto space-y-6 px-4 py-6 sm:px-6 md:py-8">
      <section className="space-y-3">
        <div className="flex items-center gap-4">
          <StudentAvatar id={student.id} name={displayName} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 truncate text-base font-semibold">
              {displayName}
              {student.archived && (
                <Badge variant="outline" className="gap-1 text-muted-foreground">
                  <Archive className="h-3 w-3" aria-hidden />
                  Archived
                </Badge>
              )}
            </h1>
            {student.display_name &&
              student.display_name !== student.username && (
                <p className="truncate text-xs text-muted-foreground">
                  {student.username}
                </p>
              )}
            <p className="mt-1 text-xs capitalize text-muted-foreground">
              {student.role}
            </p>
          </div>
        </div>
        {(canManageAccount || canArchive) && (
          <div className="flex items-center gap-2">
            {canManageAccount && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setAccountOpen(true)}>
                <Settings className="h-4 w-4" aria-hidden />
                <span>Account</span>
              </Button>
            )}
            {canArchive && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setArchiveConfirmOpen(true)}>
                <Archive className="h-4 w-4" aria-hidden />
                <span>{student.archived ? "Unarchive" : "Archive"}</span>
              </Button>
            )}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Link
            to={`/student/${studentId}/camps`}
            className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
          >
            <Dumbbell className="h-3.5 w-3.5" aria-hidden />
            Camps
          </Link>
          {canCreateCamp && (
            <Dialog open={createCampOpen} onOpenChange={setCreateCampOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="gap-1.5">
                  <Plus className="h-4 w-4" aria-hidden />
                  <span>Add camp</span>
                </Button>
              </DialogTrigger>
              <CreateCampDialog
                studentId={studentId}
                studentName={displayName}
                onCreated={(id) => {
                  setCreateCampOpen(false);
                  navigate(`/camps/${id}`);
                }}
              />
            </Dialog>
          )}
        </div>
        {campsQuery.isLoading ? (
          <div className="rounded-lg border border-border bg-card px-4 py-4">
            <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
          </div>
        ) : previewCamps.length === 0 ? null : (
          <div className="space-y-2">
            {previewCamps.map((c) => (
              <CampSummaryCard key={c.id} camp={c} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <NotebookPen className="h-3.5 w-3.5" aria-hidden />
            {isOwnView ? "My syllabi" : "Syllabi"}
          </h2>
          <Link to={`/student/${studentId}/syllabi`} className="text-xs text-muted-foreground hover:text-foreground">
            See all
          </Link>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {syllabiQuery.isLoading ? (
            <div className="px-4 py-4"><div className="h-4 w-1/3 animate-pulse rounded bg-muted" /></div>
          ) : previewSyllabi.length === 0 ? (
            <EmptyState compact icon={NotebookPen} title="No syllabi yet" description={isOwnView ? "A coach has not assigned you a syllabus yet." : "This student has no active syllabus assignments."} />
          ) : (
            <ul className="divide-y divide-border">
              {previewSyllabi.map((a) => (
                <li key={a.id}>
                  <SyllabusAssignmentRow studentId={studentId} assignment={a} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Pin className="h-3.5 w-3.5" aria-hidden />
            {isOwnView ? "Pinned" : "Pinned techniques"}
          </h2>
          <Link to={`/student/${studentId}/pinned`} className="text-xs text-muted-foreground hover:text-foreground">
            See all
          </Link>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {pinnedQuery.isLoading ? (
            <div className="px-4 py-4"><div className="h-4 w-1/3 animate-pulse rounded bg-muted" /></div>
          ) : previewPinned.length === 0 ? (
            <EmptyState compact icon={Pin} title="No pins yet" description={isOwnView ? "Pin techniques from the library to keep them within reach." : "This student has not pinned anything yet."} />
          ) : (
            <Accordion type="single" collapsible value={pinnedExpanded} onValueChange={setPinnedExpanded}>
              {previewPinned.map((t) => (
                <TechniqueRow
                  key={t.id}
                  technique={t}
                  context={{ kind: "student-pinned", studentId, studentName: isOwnView ? null : displayName }}
                  value={String(t.id)}
                  isOpen={pinnedExpanded === String(t.id)}
                />
              ))}
            </Accordion>
          )}
        </div>
      </section>

      {/* Discussion + recent activity are a coach's per-student view. A student
          viewing their own profile gets these from their feed instead (the feed
          replaces the recent-activity list, and the feed carries the discussion
          composer). */}
      {!isOwnView && (
        <>
      {/* Discussion */}
      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <MessageSquare className="h-3.5 w-3.5" aria-hidden />
          Discussion
        </h2>
        <div ref={profileThreadsRef} className="space-y-4 rounded-lg border border-border bg-card p-4">
          {profileThreadsQuery.isLoading ? (
            <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
          ) : profileThreads.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No discussion yet. Start one below.
            </p>
          ) : (
            profileThreads.map((t) => (
              <div
                key={t.id}
                data-thread-id={t.id}
                className={cn(
                  "-mx-3 rounded-md border-l-[3px] border-transparent px-3 py-1 transition-colors",
                  highlightThreadId === t.id && "border-primary bg-primary/5",
                )}
              >
                <ThreadView
                  thread={t}
                  anchorKind="student_profile"
                  anchorId={studentId}
                />
              </div>
            ))
          )}
          <ReplyComposer
            placeholder="Start a thread…"
            anchorKind="student_profile"
            anchorId={studentId}
            pending={createProfileThread.isPending}
            onSubmit={startProfileThread}
          />
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="flex flex-1 items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <History className="h-3.5 w-3.5" aria-hidden />
            Recent activity
          </h2>
          <Link
            to={`/student/${studentId}/activity`}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            See all
          </Link>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <ActivityFeedList
            rows={feedQuery.data ?? []}
            isLoading={feedQuery.isLoading}
            showAvatar={false}
            inlineAvatar
            emptyText="No activity recorded yet."
            scope={{ kind: "student", studentId }}
          />
        </div>
      </section>
        </>
      )}

      {canManageAccount && (
        <AccountDialog
          open={accountOpen}
          onOpenChange={setAccountOpen}
          user={student}
          mode={isOwnView ? "self" : "admin"}
        />
      )}

      <AlertDialog open={archiveConfirmOpen} onOpenChange={setArchiveConfirmOpen}>
        <AlertDialogContent className="w-[calc(100vw-1rem)] max-w-sm p-4 sm:p-6">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {student.archived ? `Unarchive ${displayName}?` : `Archive ${displayName}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {student.archived ? "They return to the active roster." : "They drop off the active roster. Their data is preserved and you can unarchive any time."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setArchiveConfirmOpen(false);
                try {
                  await archiveMutation.mutateAsync({ studentId, archived: !student.archived });
                  toast.success(student.archived ? "Student unarchived" : "Student archived");
                } catch {
                  toast.error("Failed to update student");
                }
              }}
            >
              {student.archived ? "Unarchive" : "Archive"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

