import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useNavigationType, useParams } from 'react-router-dom';
import { useListUrlState } from '@/lib/use-list-url-state';
import { scrollToTopWhenStable } from '@/lib/scroll-when-stable';
import {
  GitCompare,
  GraduationCap,
  NotebookPen,
  Plus,
  Search,
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
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/empty-state';
import { TechniqueRow } from '@/components/technique-row';
import { useAllUsers, useStudentSyllabusTechniques } from '@/lib/queries';
import {
  useSetAssignmentGraduated,
  useUnassignSyllabusFromStudent,
} from '@/lib/mutations';
import { useUser } from '@/lib/current-user-context';
import { isCoachOrAdmin } from '@/lib/api';
import type { LibraryTechniqueRow, SstRow } from '@/lib/api';
import { cn } from '@/lib/utils';
import { DiffDialog } from './components/diff-dialog';
import { AddToStudentDialog } from './components/add-to-student-dialog';

function toLibraryShape(sst: SstRow): LibraryTechniqueRow {
  // The Header / blocks expect a LibraryTechniqueRow-shaped object; SST
  // carries the technique fields under different keys, so we adapt at the
  // page boundary.
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
  const query = useStudentSyllabusTechniques(studentId, syllabusId);
  const usersQuery = useAllUsers();
  const assignment = query.data?.assignment;
  const studentName = useMemo(() => {
    if (isOwnView) return null;
    const u = (usersQuery.data ?? []).find((u) => u.id === studentId);
    return u ? u.display_name || u.username : null;
  }, [isOwnView, usersQuery.data, studentId]);
  const techniques = useMemo(() => {
    const rows = query.data?.techniques ?? [];
    return [...rows].sort((a, b) => {
      const latestOf = (sst: SstRow): number => {
        const candidates = [
          sst.last_attempt_at,
          sst.last_coach_update_at,
          sst.last_student_update_at,
        ];
        const timestamps = candidates
          .filter((t): t is string => t != null)
          .map((t) => new Date(t).getTime());
        return timestamps.length > 0 ? Math.max(...timestamps) : 0;
      };
      return latestOf(b) - latestOf(a);
    });
  }, [query.data?.techniques]);
  const [unassignOpen, setUnassignOpen] = useState(false);
  const [graduateOpen, setGraduateOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const navType = useNavigationType();
  const { search, setSearch, tags: activeTags, setTags, focus, setFocus, videoId } =
    useListUrlState();
  const [videoConsumed, setVideoConsumed] = useState(false);
  const scrollToVideoId = videoConsumed ? null : videoId;
  const unassignMutation = useUnassignSyllabusFromStudent();
  const graduateMutation = useSetAssignmentGraduated();

  // Expansion in the URL (?focus=sst:<id>): shareable + restored on back.
  const expandedValue = focus?.type === 'sst' ? `sst-${focus.id}` : '';
  const setExpandedValue = (value: string) => {
    const id = value.startsWith('sst-') ? Number(value.slice(4)) : NaN;
    setFocus(Number.isFinite(id) ? { type: 'sst', id } : null);
  };

  // Scroll to the focused row on arrival (not POP, where the scroll manager
  // restores pixel position). Runs once when the data is ready.
  const didScrollToFocus = useRef(false);
  useEffect(() => {
    if (didScrollToFocus.current || techniques.length === 0) return;
    if (!focus || focus.type !== 'sst') {
      didScrollToFocus.current = true;
      return;
    }
    const target = techniques.find((sst) => sst.id === focus.id);
    if (!target) return;
    didScrollToFocus.current = true;
    if (navType === 'POP') return;
    requestAnimationFrame(() => {
      const el = document.getElementById(`technique-row-${target.technique_id}`);
      if (el) scrollToTopWhenStable(el);
    });
  }, [techniques, focus, navType]);

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    techniques.forEach((sst) => sst.tags.forEach((tag) => set.add(tag.name)));
    return Array.from(set).sort();
  }, [techniques]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return techniques.filter((sst) => {
      const matchesText =
        !needle ||
        sst.technique_name.toLowerCase().includes(needle) ||
        sst.technique_description.toLowerCase().includes(needle) ||
        sst.tags.some((tag) => tag.name.toLowerCase().includes(needle));
      const matchesTags =
        activeTags.length === 0 ||
        activeTags.every((tag) =>
          sst.tags.some((x) => x.name === tag),
        );
      return matchesText && matchesTags;
    });
  }, [techniques, search, activeTags]);

  function toggleTag(tag: string) {
    setTags(activeTags.includes(tag) ? activeTags.filter((t) => t !== tag) : [...activeTags, tag]);
  }

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
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <Button
              variant="outline"
              size="icon"
              aria-label="Sync with current syllabus"
              onClick={() => setDiffOpen(true)}
            >
              <GitCompare className="h-4 w-4" aria-hidden />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Add technique to this student"
              onClick={() => setAddOpen(true)}
            >
              <Plus className="h-4 w-4" aria-hidden />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label={
                assignment.graduated_at
                  ? 'Ungraduate this syllabus'
                  : 'Graduate this syllabus'
              }
              onClick={() => setGraduateOpen(true)}
              className={cn(assignment.graduated_at && 'text-status-green')}
            >
              <GraduationCap className="h-4 w-4" aria-hidden />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Unassign syllabus"
              onClick={() => setUnassignOpen(true)}
              className="text-destructive"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        )}
      </div>

      {techniques.length > 0 && (
        <div className="space-y-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              placeholder="Search techniques"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          {availableTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {availableTags.map((tag) => {
                const active = activeTags.includes(tag);
                return (
                  <Badge
                    key={tag}
                    variant={active ? 'default' : 'outline'}
                    className="cursor-pointer select-none"
                    onClick={() => toggleTag(tag)}
                  >
                    {tag}
                  </Badge>
                );
              })}
              {activeTags.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => setTags([])}
                >
                  Clear
                </Button>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {filtered.length === techniques.length
              ? `${techniques.length} ${
                  techniques.length === 1 ? 'technique' : 'techniques'
                }`
              : `${filtered.length} of ${techniques.length} techniques`}
          </p>
        </div>
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
            value={expandedValue}
            onValueChange={setExpandedValue}
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
                  }}
                  value={value}
                  isOpen={expandedValue === value}
                  scrollToVideoId={expandedValue === value ? scrollToVideoId : null}
                  onVideoScrolled={() => setVideoConsumed(true)}
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
        presentTechniqueIds={
          new Set(techniques.map((t) => t.technique_id))
        }
      />
    </div>
  );
}
