import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { NotebookPen, Search, UserPlus, Users, X } from 'lucide-react';
import { type User } from '@/lib/api';
import { useInfiniteStudents } from '@/lib/queries';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { SkeletonListRow } from '@/components/skeleton-row';
import { StudentRow } from '@/components/student-row';

export default function StudentsList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = searchParams.get('q') ?? '';
  function setFilter(next: string) {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (!next) params.delete('q');
      else params.set('q', next);
      return params;
    }, { replace: true });
  }

  // Archived students are hidden here; unarchive lives on the admin page.
  const debouncedFilter = useDebouncedValue(filter);
  const studentsQuery = useInfiniteStudents(debouncedFilter);
  const students: User[] = useMemo(
    () => (studentsQuery.data?.pages ?? []).flatMap((page) => page.items),
    [studentsQuery.data],
  );
  const total = studentsQuery.data?.pages[0]?.total ?? 0;
  const loading = studentsQuery.isLoading;
  const error = studentsQuery.error
    ? 'Failed to load students. Please try again.'
    : null;

  function rowActions(student: User) {
    return (
      <div className="flex items-center gap-1">
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          aria-label={`View ${student.display_name || student.username}'s syllabi`}
        >
          <Link
            to={`/student/${student.id}/syllabi`}
            onClick={(e) => e.stopPropagation()}
          >
            <NotebookPen className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 px-4 sm:px-6 md:py-8">
      <div className="mb-4 flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            placeholder="Search for any student"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Search for any student"
            className="pl-9 pr-9"
          />
          {filter && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
              onClick={() => setFilter('')}
            >
              <X className="h-4 w-4" aria-hidden />
              <span className="sr-only">Clear filter</span>
            </Button>
          )}
        </div>
        <Button onClick={() => navigate('/register-user')} className="shrink-0">
          <UserPlus className="mr-2 h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Register student</span>
          <span className="sm:hidden">Register</span>
        </Button>
      </div>

      <p className="mb-2 text-xs text-muted-foreground">
        {loading
          ? 'Loading students'
          : students.length === total
            ? `${total} ${total === 1 ? 'student' : 'students'}, most recently active first`
            : `${students.length} of ${total} students, most recently active first`}
      </p>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {loading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 5 }).map((_, i) => (
              <SkeletonListRow key={i} />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" onClick={() => studentsQuery.refetch()}>
              Try again
            </Button>
          </div>
        ) : students.length > 0 ? (
          <div className="divide-y divide-border">
            {students.map((student) => (
              <StudentRow
                key={student.id}
                student={student}
                href={`/student/${student.id}`}
                actions={rowActions(student)}
              />
            ))}
          </div>
        ) : filter ? (
          <EmptyState
            icon={Users}
            title="No matching students"
            description="Try a different search or clear the filter."
            action={
              <Button variant="outline" onClick={() => setFilter('')}>
                Clear filter
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Users}
            title="No students yet"
            description="Register your first student to start tracking their progress."
            action={
              <Button onClick={() => navigate('/register-user')}>
                <UserPlus className="mr-2 h-4 w-4" aria-hidden />
                Register student
              </Button>
            }
          />
        )}
      </div>

      {studentsQuery.hasNextPage && (
        <Button
          variant="outline"
          className="mt-3 w-full"
          disabled={studentsQuery.isFetchingNextPage}
          onClick={() => studentsQuery.fetchNextPage()}
        >
          {studentsQuery.isFetchingNextPage ? 'Loading...' : 'Load more'}
        </Button>
      )}
    </div>
  );
}
