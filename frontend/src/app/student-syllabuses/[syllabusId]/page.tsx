import { useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, NotebookPen, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Accordion } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/empty-state';
import { TechniqueRow } from '@/components/technique-row';
import { useStudentSyllabusTechniques } from '@/lib/queries';
import { useUnassignSyllabusFromStudent } from '@/lib/mutations';
import { useUser } from '@/lib/current-user-context';
import { isCoachOrAdmin } from '@/lib/api';
import type { LibraryTechniqueRow, SstRow } from '@/lib/api';

function toLibraryShape(sst: SstRow): LibraryTechniqueRow {
  // The Header / blocks expect a LibraryTechniqueRow-shaped object; SST
  // carries the technique fields under different keys, so we adapt at the
  // page boundary. video_count is left at 0 because SST doesn't include
  // the aggregate (PR 4 can wire it in if the meta strip needs it).
  return {
    id: sst.technique_id,
    name: sst.technique_name,
    description: sst.technique_description,
    tags: sst.tags,
    collection_ids: [],
    collection_count: 0,
    student_count: 0,
    video_count: 0,
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
  const assignment = query.data?.assignment;
  const techniques = useMemo(
    () => query.data?.techniques ?? [],
    [query.data?.techniques],
  );
  const [expandedValue, setExpandedValue] = useState<string>('');
  const [unassignOpen, setUnassignOpen] = useState(false);
  const unassignMutation = useUnassignSyllabusFromStudent();

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
      navigate(`/student/${studentId}/syllabuses`);
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
              onClick={() => navigate(`/student/${studentId}/syllabuses`)}
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
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="mb-3 -ml-2 gap-1.5"
          onClick={() => navigate(`/student/${studentId}/syllabuses`)}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to syllabuses
        </Button>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-base font-semibold">
              <NotebookPen className="h-4 w-4" aria-hidden />
              {assignment.syllabus_name}
            </h1>
            <p className="text-xs text-muted-foreground">
              {assignment.total_count}{' '}
              {assignment.total_count === 1 ? 'technique' : 'techniques'}
            </p>
          </div>
          {!isOwnView && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-destructive"
              onClick={() => setUnassignOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              Unassign
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {techniques.length === 0 ? (
          <EmptyState
            icon={NotebookPen}
            title="No techniques yet"
            description="The coach hasn't added any techniques to this syllabus yet."
          />
        ) : (
          <Accordion
            type="single"
            collapsible
            value={expandedValue}
            onValueChange={setExpandedValue}
          >
            {techniques.map((sst) => {
              const value = `sst-${sst.id}`;
              return (
                <TechniqueRow
                  key={sst.id}
                  technique={toLibraryShape(sst)}
                  context={{
                    kind: 'student-syllabus',
                    studentId,
                    syllabusId,
                    assignmentId: assignment.id,
                    sst,
                  }}
                  value={value}
                  isOpen={expandedValue === value}
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnassignOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleUnassign}
              disabled={unassignMutation.isPending}
            >
              Unassign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
