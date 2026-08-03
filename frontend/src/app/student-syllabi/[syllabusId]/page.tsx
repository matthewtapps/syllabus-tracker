import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useTechniqueListNav } from '@/components/technique-row/use-technique-list-nav';
import { TechniqueFilters } from '@/components/technique-row/technique-filters';
import {
  GitCompare,
  GraduationCap,
  NotebookPen,
  Plus,
  Settings,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Accordion } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AccountDialog } from '@/components/account-dialog';
import { EmptyState } from '@/components/empty-state';
import { TechniqueRow } from '@/components/technique-row';
import { partitionSsts, sortSsts, type SstSort } from './sst-view';
import { useAllUsers, useStudentSyllabusTechniques } from '@/lib/queries';
import {
  useSetAssignmentGraduated,
  useUnassignSyllabusFromStudent,
} from '@/lib/mutations';
import { useUser } from '@/lib/current-user-context';
import { isCoachOrAdmin, isAdmin } from '@/lib/api';
import { toLibraryShape } from '@/components/activity-feed/to-library-shape';
import { cn } from '@/lib/utils';
import { DiffDialog } from './components/diff-dialog';
import { AddToStudentDialog } from './components/add-to-student-dialog';

export default function StudentSyllabusDetailPage() {
  const params = useParams<{ id: string; syllabusId: string }>();
  const studentId = params.id ? parseInt(params.id, 10) : NaN;
  const syllabusId = params.syllabusId ? parseInt(params.syllabusId, 10) : NaN;
  const user = useUser();
  if (!Number.isFinite(studentId) || !Number.isFinite(syllabusId)) {
    return <Navigate to="/dashboard" replace />;
  }
  const isOwner = user.id === studentId;
  const isCoach = isCoachOrAdmin(user);
  if (!isOwner && !isCoach) {
    return <Navigate to="/dashboard" replace />;
  }
  return (
    <Detail
      studentId={studentId}
      syllabusId={syllabusId}
      isOwnView={isOwner}
    />
  );
}

function Detail({
  studentId,
  syllabusId,
  isOwnView,
}: {
  studentId: number;
  syllabusId: number;
  isOwnView: boolean;
}) {
  const navigate = useNavigate();
  const user = useUser();
  const query = useStudentSyllabusTechniques(studentId, syllabusId);
  const usersQuery = useAllUsers();
  const assignment = query.data?.assignment;
  const studentName = useMemo(() => {
    if (isOwnView) return null;
    const u = (usersQuery.data ?? []).find((u) => u.id === studentId);
    return u ? u.display_name || u.username : null;
  }, [isOwnView, usersQuery.data, studentId]);
  const viewerIsAdmin = isAdmin(user);
  const managedStudent = useMemo(
    () => (usersQuery.data ?? []).find((u) => u.id === studentId) ?? null,
    [usersQuery.data, studentId],
  );
  const [accountOpen, setAccountOpen] = useState(false);
  const allSsts = useMemo(
    () => query.data?.techniques ?? [],
    [query.data?.techniques],
  );
  const [tab, setTab] = useState<'main' | 'custom' | 'hidden'>('main');
  // Techniques just hidden this visit linger (ghosted) in Main until the
  // coach leaves the tab. Per-visit only: cleared on tab change and on
  // natural unmount (state dies with the component).
  const [ghostTechniqueIds, setGhostTechniqueIds] = useState<Set<number>>(
    () => new Set(),
  );
  function handleHiddenToggled(techniqueId: number, nowHidden: boolean) {
    setGhostTechniqueIds((prev) => {
      const next = new Set(prev);
      if (nowHidden) next.add(techniqueId);
      else next.delete(techniqueId);
      return next;
    });
  }
  function changeTab(next: 'main' | 'custom' | 'hidden') {
    setGhostTechniqueIds(new Set()); // clear ghosts when leaving the current tab
    setTab(next);
  }
  const { main, custom, hidden } = useMemo(
    () => partitionSsts(allSsts, ghostTechniqueIds),
    [allSsts, ghostTechniqueIds],
  );
  // The student's own view always shows just their visible techniques; coaches
  // drive the list off the selected tab.
  const activeRows = isOwnView
    ? allSsts.filter((r) => r.hidden_at == null)
    : tab === 'main'
      ? main
      : tab === 'custom'
        ? custom
        : hidden;
  const [sort, setSort] = useState<SstSort>('recent');
  const techniques = useMemo(
    () => sortSsts(activeRows, sort),
    [activeRows, sort],
  );
  const [unassignOpen, setUnassignOpen] = useState(false);
  const [graduateOpen, setGraduateOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const unassignMutation = useUnassignSyllabusFromStudent();
  const graduateMutation = useSetAssignmentGraduated();

  const nav = useTechniqueListNav({
    items: techniques,
    kind: 'sst',
    rowId: (sst) => sst.id,
    rowElementId: (sst) => `technique-row-${sst.technique_id}`,
    tagsOf: (sst) => sst.tags.map((tag) => tag.name),
    matchesSearch: (sst, needle) =>
      sst.technique_name.toLowerCase().includes(needle) ||
      sst.technique_description.toLowerCase().includes(needle) ||
      sst.tags.some((tag) => tag.name.toLowerCase().includes(needle)),
  });
  const { filtered } = nav;

  async function handleUnassign() {
    try {
      await unassignMutation.mutateAsync({ studentId, syllabusId });
      const syllabusName = assignment?.syllabus_name ?? 'syllabus';
      toast.success(`Unassigned ${syllabusName}`, {
        action: {
          label: 'Undo',
          onClick: async () => {
            try {
              const { assignSyllabusApi } = await import('@/lib/api');
              await assignSyllabusApi(studentId, syllabusId);
              query.refetch();
              toast.success(`Reassigned ${syllabusName}`);
            } catch {
              toast.error('Failed to undo');
            }
          },
        },
      });
      setUnassignOpen(false);
      navigate(`/student/${studentId}/syllabi`);
    } catch {
      toast.error('Failed to unassign');
    }
  }

  if (query.isLoading) {
    return (
      <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
        <div className="h-6 w-1/3 animate-pulse rounded bg-muted" />
      </div>
    );
  }
  if (!assignment) {
    return (
      <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
        <EmptyState
          icon={NotebookPen}
          title="Syllabus not found"
          description="The syllabus assignment may have been removed."
          action={
            <Button
              variant="outline"
              onClick={() => navigate(`/student/${studentId}/syllabi`)}
            >
              Back
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8 space-y-4">
      <div className="space-y-1.5">
        <h1 className="flex items-start gap-2 text-base font-semibold break-words">
          <NotebookPen className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            {studentName
              ? `${studentName}'s ${assignment.syllabus_name}`
              : assignment.syllabus_name}
          </span>
        </h1>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            {assignment.total_count}{' '}
            {assignment.total_count === 1 ? 'technique' : 'techniques'}
          </span>
          {assignment.graduated_at && (
            <>
              <span aria-hidden>·</span>
              <Badge
                variant="outline"
                className="gap-1 border-status-green py-0 text-status-green"
              >
                <GraduationCap className="h-3 w-3" aria-hidden />
                Graduated
              </Badge>
            </>
          )}
        </p>
        {!isOwnView && (
          <Link
            to={`/syllabi/${syllabusId}`}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <NotebookPen className="h-3.5 w-3.5" aria-hidden />
            Open the {assignment.syllabus_name} overview
          </Link>
        )}
        {!isOwnView && (
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setDiffOpen(true)}
              aria-label="Sync with current syllabus"
              title="Sync with current syllabus"
            >
              <GitCompare className="h-4 w-4" aria-hidden />
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setGraduateOpen(true)}
              aria-label={assignment.graduated_at ? "Ungraduate syllabus" : "Graduate syllabus"}
              title={assignment.graduated_at ? "Ungraduate syllabus" : "Graduate syllabus"}
            >
              <GraduationCap className={cn("h-4 w-4", assignment.graduated_at && "text-status-green")} aria-hidden />
            </Button>
            {viewerIsAdmin && managedStudent && (
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setAccountOpen(true)}
                aria-label="Manage account"
                title="Manage account"
              >
                <Settings className="h-4 w-4" aria-hidden />
              </Button>
            )}
            <Button
              variant="outline"
              className="flex-1 text-destructive focus-visible:text-destructive"
              onClick={() => setUnassignOpen(true)}
              aria-label="Unassign syllabus"
              title="Unassign syllabus"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        )}
      </div>

      {!isOwnView && (
        <Button className="w-full" onClick={() => setAddOpen(true)}>
          <Plus className="mr-2 h-4 w-4" aria-hidden />
          Add technique
        </Button>
      )}

      {allSsts.length > 0 && (
        <>
          <TechniqueFilters
            search={nav.search}
            onSearchChange={nav.setSearch}
            availableTags={nav.availableTags}
            activeTags={nav.tags}
            onToggleTag={nav.toggleTag}
            onClearTags={nav.clearTags}
          />
          <p className="text-xs text-muted-foreground">
            {filtered.length === techniques.length
              ? `${techniques.length} ${
                  techniques.length === 1 ? 'technique' : 'techniques'
                }`
              : `${filtered.length} of ${techniques.length} techniques`}
          </p>
          {!isOwnView && (
            <Select value={sort} onValueChange={(v) => setSort(v as SstSort)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Recently active</SelectItem>
                <SelectItem value="alphabetical">Alphabetical</SelectItem>
              </SelectContent>
            </Select>
          )}
          {!isOwnView && (
            <Tabs
              value={tab}
              onValueChange={(v) =>
                changeTab(v as 'main' | 'custom' | 'hidden')
              }
            >
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="main">Main</TabsTrigger>
                <TabsTrigger value="custom">
                  Custom{custom.length ? ` (${custom.length})` : ''}
                </TabsTrigger>
                <TabsTrigger value="hidden">
                  Hidden{hidden.length ? ` (${hidden.length})` : ''}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          )}
        </>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {techniques.length === 0 ? (
          <EmptyState
            icon={NotebookPen}
            title="No techniques yet"
            description="The coach hasn't added any techniques to this syllabus yet."
          />
        ) : filtered.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            No techniques match the current filters.
          </p>
        ) : (
          <Accordion
            type="single"
            collapsible
            value={nav.expandedValue}
            onValueChange={nav.setExpandedValue}
          >
            {filtered.map((sst) => {
              const value = `sst-${sst.id}`;
              return (
                <TechniqueRow
                  key={sst.id}
                  technique={toLibraryShape(sst)}
                  context={{
                    kind: 'student-syllabus',
                    studentId,
                    studentName,
                    syllabusId,
                    syllabusName: assignment.syllabus_name,
                    assignmentId: assignment.id,
                    sst,
                    graduatedAt: assignment.graduated_at,
                    onHiddenToggled: handleHiddenToggled,
                  }}
                  value={value}
                  isOpen={nav.expandedValue === value}
                  scrollToVideoId={nav.expandedValue === value ? nav.videoId : null}
                  resumeSeconds={nav.expandedValue === value ? nav.resumeSeconds : null}
                  onVideoScrolled={nav.consumeVideo}
                  ghost={ghostTechniqueIds.has(sst.technique_id)}
                />
              );
            })}
          </Accordion>
        )}
      </div>

      <Dialog open={unassignOpen} onOpenChange={setUnassignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unassign {assignment.syllabus_name}?</DialogTitle>
            <DialogDescription>
              The student stops seeing this syllabus immediately. Their
              attempts and notes are preserved, so re-assigning later
              resumes progress.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="grid grid-cols-2 gap-2 sm:flex-none sm:justify-stretch">
            <Button
              variant="outline"
              onClick={() => setUnassignOpen(false)}
              className="w-full"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleUnassign}
              disabled={unassignMutation.isPending}
              className="w-full"
            >
              Unassign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={graduateOpen} onOpenChange={setGraduateOpen}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>
              {assignment.graduated_at
                ? `Ungraduate ${assignment.syllabus_name}?`
                : `Graduate ${assignment.syllabus_name}?`}
            </DialogTitle>
            <DialogDescription>
              {assignment.graduated_at
                ? 'Restores edits for the student. Their progress is unchanged.'
                : 'Locks the student out of edits on this syllabus. Their attempts and notes are preserved, and you can edit on their behalf.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="grid grid-cols-2 gap-2 sm:flex-none sm:justify-stretch">
            <Button
              variant="outline"
              onClick={() => setGraduateOpen(false)}
              className="w-full"
              disabled={graduateMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={async () => {
                try {
                  await graduateMutation.mutateAsync({
                    studentId,
                    syllabusId,
                    graduated: !assignment.graduated_at,
                  });
                  toast.success(
                    assignment.graduated_at
                      ? `Ungraduated ${assignment.syllabus_name}`
                      : `Graduated ${assignment.syllabus_name}`,
                  );
                  setGraduateOpen(false);
                } catch {
                  toast.error('Failed to update graduation');
                }
              }}
              className="w-full"
              disabled={graduateMutation.isPending}
            >
              {assignment.graduated_at ? 'Ungraduate' : 'Graduate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DiffDialog
        open={diffOpen}
        onOpenChange={setDiffOpen}
        studentId={studentId}
        syllabusId={syllabusId}
        studentName={undefined}
      />

      <AddToStudentDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        studentId={studentId}
        syllabusId={syllabusId}
        visibleTechniqueIds={
          new Set(
            (query.data?.techniques ?? [])
              .filter((s) => !s.hidden_at)
              .map((s) => s.technique_id),
          )
        }
        hiddenTechniqueSstByTid={
          new Map(
            (query.data?.techniques ?? [])
              .filter((s) => s.hidden_at)
              .map((s) => [s.technique_id, s.id]),
          )
        }
      />

      {viewerIsAdmin && managedStudent && (
        <AccountDialog
          open={accountOpen}
          onOpenChange={setAccountOpen}
          user={managedStudent}
          mode="admin"
        />
      )}
    </div>
  );
}
