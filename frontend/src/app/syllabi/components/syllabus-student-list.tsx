import { useState } from 'react';
import { Link } from 'react-router-dom';
import { GraduationCap, Search } from 'lucide-react';
import { toast } from 'sonner';
import type { SyllabusStudentRow } from '@/lib/api';
import { useInfiniteSyllabusStudents } from '@/lib/queries';
import { useSetAssignmentGraduated } from '@/lib/mutations';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { formatRelative } from '@/lib/dates';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { StudentAvatar } from '@/components/student-avatar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

function isReadyToGraduate(row: SyllabusStudentRow): boolean {
  return (
    row.graduated_at === null &&
    row.total_count > 0 &&
    row.green_count === row.total_count
  );
}

export function SyllabusStudentList({ syllabusId }: { syllabusId: number }) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const rowsQuery = useInfiniteSyllabusStudents(syllabusId, debouncedSearch);
  const [graduateTarget, setGraduateTarget] = useState<SyllabusStudentRow | null>(null);
  const graduateMutation = useSetAssignmentGraduated();

  const rows = (rowsQuery.data?.pages ?? []).flatMap((page) => page.items);
  const total = rowsQuery.data?.pages[0]?.total ?? 0;

  async function handleGraduate() {
    if (!graduateTarget) return;
    const name = graduateTarget.display_name || graduateTarget.username;
    try {
      await graduateMutation.mutateAsync({
        studentId: graduateTarget.student_id,
        syllabusId,
        graduated: true,
      });
      toast.success(`Graduated ${name}`);
      setGraduateTarget(null);
    } catch {
      toast.error(`Failed to graduate ${name}`);
    }
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          placeholder="Search students"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {rowsQuery.isLoading ? (
          <div className="px-4 py-6">
            <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
          </div>
        ) : rowsQuery.error ? (
          <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
            <p className="text-sm text-destructive">Failed to load students.</p>
            <Button variant="outline" onClick={() => rowsQuery.refetch()}>
              Try again
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-muted-foreground">
            {debouncedSearch
              ? 'No students match the search.'
              : 'Nobody is assigned yet.'}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li key={row.assignment_id}>
                <StudentProgressRow
                  row={row}
                  syllabusId={syllabusId}
                  onGraduate={() => setGraduateTarget(row)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {rows.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {rows.length === total
            ? `${total} ${total === 1 ? 'student' : 'students'}`
            : `${rows.length} of ${total} students`}
        </p>
      )}

      {rowsQuery.hasNextPage && (
        <Button
          variant="outline"
          className="w-full"
          disabled={rowsQuery.isFetchingNextPage}
          onClick={() => rowsQuery.fetchNextPage()}
        >
          {rowsQuery.isFetchingNextPage ? 'Loading...' : 'Load more'}
        </Button>
      )}

      <AlertDialog
        open={graduateTarget !== null}
        onOpenChange={(open) => !open && setGraduateTarget(null)}
      >
        <AlertDialogContent className="w-[calc(100vw-1rem)] max-w-sm p-4 sm:p-6">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Graduate {graduateTarget?.display_name || graduateTarget?.username}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Their record becomes a completed snapshot. They stop being able to edit it,
              and you can still correct it from their syllabus page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={graduateMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={graduateMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                handleGraduate();
              }}
            >
              {graduateMutation.isPending ? 'Graduating...' : 'Graduate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StudentProgressRow({
  row,
  syllabusId,
  onGraduate,
}: {
  row: SyllabusStudentRow;
  syllabusId: number;
  onGraduate: () => void;
}) {
  const name = row.display_name || row.username;
  const percent =
    row.total_count > 0 ? Math.round((row.green_count / row.total_count) * 100) : 0;
  const ready = isReadyToGraduate(row);

  return (
    <div className="group flex items-center gap-2 pr-2 transition-colors hover:bg-muted/40 focus-within:bg-muted/40">
      <Link
        to={`/student/${row.student_id}/syllabi/${syllabusId}`}
        className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 focus-visible:outline-none"
      >
        <StudentAvatar id={row.student_id} name={name} />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{name}</span>
            {row.graduated_at && (
              <Badge variant="outline" className="shrink-0 gap-1 text-muted-foreground">
                <GraduationCap className="h-3 w-3" aria-hidden />
                Graduated
              </Badge>
            )}
            {ready && (
              <Badge variant="outline" className="shrink-0 gap-1 border-emerald-600 text-emerald-600">
                <GraduationCap className="h-3 w-3" aria-hidden />
                Ready
              </Badge>
            )}
          </div>
          {row.total_count > 0 && (
            <div className="flex items-center gap-3">
              <Progress value={percent} className="h-1.5 max-w-40" />
              <span className="shrink-0 text-xs text-muted-foreground">
                {row.green_count}/{row.total_count} done
                {row.amber_count > 0 && ` · ${row.amber_count} doing`}
              </span>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {row.last_activity_at
              ? `Last touched ${formatRelative(row.last_activity_at).toLowerCase()}`
              : 'No activity yet'}
          </p>
        </div>
      </Link>
      {ready && (
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 gap-1.5"
          onClick={onGraduate}
        >
          <GraduationCap className="h-4 w-4" aria-hidden />
          Graduate
        </Button>
      )}
    </div>
  );
}
