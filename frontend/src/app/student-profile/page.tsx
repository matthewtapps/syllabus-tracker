import { useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import {
  Archive,
  BookOpen,
  ChevronRight,
  Dumbbell,
  History,
  Medal,
  MessageSquare,
  NotebookPen,
  Pin,
  Plus,
  Settings,
  UserRound,
} from "lucide-react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TracedForm } from "@/components/traced-form";
import {
  handleApiFormError,
  useFormWithValidation,
} from "@/components/hooks/useFormErrors";
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
import { useCreateCamp, useCreateThread, useArchiveStudent } from "@/lib/mutations";
import { useUser } from "@/lib/current-user-context";
import { isAdmin, isCoachOrAdmin } from "@/lib/api";
import { cn } from "@/lib/utils";
import { campsUiEnabled } from "@/lib/features";
import { ActivityFeedList } from "@/components/activity-feed-list";
import { ThreadView } from "@/components/threads/thread-view";
import { ThreadComposer } from "@/components/threads/thread-composer";
import { SyllabusAssignmentRow } from "@/app/student-syllabi/components/syllabus-assignment-row";
import type { User } from "@/lib/api";

const createCampSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(100, "Name must be under 100 characters"),
  description: z.string().max(1000, "Description is too long").optional(),
  references_camp_id: z.string().optional(),
});
type CreateCampValues = z.infer<typeof createCampSchema>;

function initials(u: Pick<User, "display_name" | "username">): string {
  const source = u.display_name?.trim() || u.username || "";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

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
  const createProfileThread = useCreateThread();
  async function startProfileThread(body: string) {
    try {
      await createProfileThread.mutateAsync({
        anchor_kind: "student_profile",
        anchor_id: studentId,
        visibility: "private",
        scope_student_id: studentId,
        body,
      });
    } catch {
      toast.error("Couldn't post your thread.");
    }
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

  return (
    <div className="container mx-auto space-y-6 px-4 py-6 sm:px-6 md:py-8">
      <section className="flex items-center gap-4">
        <Avatar size="lg" className="shrink-0">
          <AvatarFallback>{initials(student)}</AvatarFallback>
        </Avatar>
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
        {(canManageAccount || canArchive) && (
          <div className="flex shrink-0 items-center gap-2">
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

      {(isOwnView || campsUiEnabled) && (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {isOwnView ? "Your spaces" : `${displayName}'s spaces`}
            </h2>
            {canCreateCamp && campsUiEnabled && (
              <Dialog open={createCampOpen} onOpenChange={setCreateCampOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline" className="gap-1.5">
                    <Plus className="h-4 w-4" aria-hidden />
                    <span>New camp</span>
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
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            {/* The Library is a global gym-wide resource. Students see a link
             * to their own library view; coaches don't need it here since
             * the Library nav entry already takes them there. */}
            {isOwnView && (
              <HubLink to="/library" icon={BookOpen} title="Library" last={!campsUiEnabled} />
            )}
            {campsUiEnabled && (
              <>
                <HubLink
                  to={`/student/${studentId}/camps`}
                  icon={Dumbbell}
                  title="Camps"
                />
                <HubLink
                  to={`/student/${studentId}/matches`}
                  icon={Medal}
                  title={isOwnView ? "My matches" : "Matches"}
                  last
                />
              </>
            )}
          </div>
        </section>
      )}

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

      {/* Discussion */}
      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <MessageSquare className="h-3.5 w-3.5" aria-hidden />
          Discussion
        </h2>
        <div className="space-y-4 rounded-lg border border-border bg-card p-4">
          {profileThreadsQuery.isLoading ? (
            <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
          ) : (profileThreadsQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No discussion yet. Start one below.
            </p>
          ) : (
            (profileThreadsQuery.data ?? []).map((t) => (
              <ThreadView
                key={t.id}
                thread={t}
                anchorKind="student_profile"
                anchorId={studentId}
              />
            ))
          )}
          <ThreadComposer
            placeholder={"Start a thread..."}
            submitLabel="Post"
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

function HubLink({
  to,
  icon: Icon,
  title,
  last,
}: {
  to: string;
  icon: typeof UserRound;
  title: string;
  last?: boolean;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40",
        !last && "border-b border-border",
      )}
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <p className="min-w-0 flex-1 truncate text-sm font-medium">{title}</p>
      <ChevronRight
        className="h-4 w-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
    </Link>
  );
}

function CreateCampDialog({
  studentId,
  studentName,
  onCreated,
}: {
  studentId: number;
  studentName: string;
  onCreated: (id: number) => void;
}) {
  const createMutation = useCreateCamp(studentId);
  const campsQuery = useCampsForStudent(studentId);
  const existingCamps = campsQuery.data ?? [];

  const form = useFormWithValidation<CreateCampValues>({
    resolver: zodResolver(createCampSchema),
    defaultValues: { name: "", description: "", references_camp_id: "" },
  });

  async function handleSubmit(values: CreateCampValues) {
    try {
      const refId =
        values.references_camp_id && values.references_camp_id !== "none"
          ? Number(values.references_camp_id)
          : null;
      const { id } = await createMutation.mutateAsync({
        name: values.name,
        description: values.description?.trim() ? values.description : null,
        references_camp_id: refId,
      });
      toast.success(`Created ${values.name}`);
      onCreated(id);
    } catch (err) {
      const handled = await handleApiFormError(
        err,
        form.setError,
        Object.keys(form.getValues()),
      );
      if (!handled) toast.error("Failed to create camp");
    }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>New camp for {studentName}</DialogTitle>
        <DialogDescription>
          Add a name and optional description. You can add techniques after.
        </DialogDescription>
      </DialogHeader>
      <Form {...form}>
        <TracedForm
          id="create_camp"
          onSubmit={form.handleSubmit(handleSubmit)}
          className="space-y-3"
        >
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <Input autoFocus placeholder="e.g. Worlds prep" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl>
                  <Textarea {...field} className="min-h-20" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {existingCamps.length > 0 && (
            <FormField
              control={form.control}
              name="references_camp_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Builds on (optional)</FormLabel>
                  <Select
                    value={field.value ?? ""}
                    onValueChange={field.onChange}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="None" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {existingCamps.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.name}
                          {c.archived_at ? " (archived)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
          <DialogFooter>
            <Button
              type="submit"
              size="sm"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </TracedForm>
      </Form>
    </DialogContent>
  );
}
