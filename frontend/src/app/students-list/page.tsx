import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Archive,
  MoreVertical,
  NotebookPen,
  Search,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { type User, isAdmin } from '@/lib/api';
import { useUser } from '@/lib/current-user-context';
import { useStudents } from '@/lib/queries';
import { useToggleUserArchived } from '@/lib/mutations';
import { categorizeStudent, isStudentLed } from '@/lib/student-triage';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EmptyState } from '@/components/empty-state';
import { SkeletonListRow } from '@/components/skeleton-row';
import { StudentRow } from '@/components/student-row';

type SortBy = 'recent_update' | 'alphabetical';

// Top-level activity tabs. "Active" now gathers every student with recent
// activity on either side (own or coach-led); the active/coach-led split lives
// in the sub-tab pills below.
type ActivityTab = 'active' | 'quiet';

const ACTIVITY_TABS: { value: ActivityTab; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'quiet', label: 'Quiet' },
];

const ACTIVITY_TAB_VALUES = new Set<ActivityTab>(['active', 'quiet']);

function isActivityTab(v: string | null): v is ActivityTab {
  return v !== null && ACTIVITY_TAB_VALUES.has(v as ActivityTab);
}

// Sub-tab pills that refine the Active tab.
type ActiveView = 'everyone' | 'student_led' | 'coach_led';

const ACTIVE_VIEWS: { value: ActiveView; label: string }[] = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'student_led', label: 'Student-led' },
  { value: 'coach_led', label: 'Coach-led' },
];

const ACTIVE_VIEW_VALUES = new Set<ActiveView>([
  'everyone',
  'student_led',
  'coach_led',
]);

function isActiveView(v: string | null): v is ActiveView {
  return v !== null && ACTIVE_VIEW_VALUES.has(v as ActiveView);
}

function flavour(tab: ActivityTab, view: ActiveView): string {
  if (tab === 'quiet') return 'No recent activity from either side.';
  if (view === 'student_led')
    return 'Active on their own, with no recent updates from you.';
  if (view === 'coach_led')
    return 'You\'ve updated them recently, with no recent activity from the student.';
  return 'Students with activity lately, whether from them or from you.';
}

export default function StudentsList() {
  const user = useUser();
  const navigate = useNavigate();
  const admin = isAdmin(user);
  const studentsQuery = useStudents('recent_update', true);
  const students = useMemo(() => studentsQuery.data ?? [], [studentsQuery.data]);
  const loading = studentsQuery.isLoading;
  const error = studentsQuery.error
    ? 'Failed to load students. Please try again.'
    : null;
  const archiveMutation = useToggleUserArchived();
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
  const sortParam = searchParams.get('sort');
  const sortBy: SortBy =
    sortParam === 'alphabetical' ? 'alphabetical' : 'recent_update';
  function setSortBy(next: SortBy) {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next === 'recent_update') params.delete('sort');
      else params.set('sort', next);
      return params;
    }, { replace: true });
  }
  const tabParam = searchParams.get('tab');
  const activityTab: ActivityTab = isActivityTab(tabParam) ? tabParam : 'active';
  // The sub-tab pill lives in its own param so it survives switching to the
  // Quiet tab and back, and never blips through a reset on tab change.
  const viewParam = searchParams.get('view');
  const activeView: ActiveView = isActiveView(viewParam) ? viewParam : 'everyone';
  function setActivityTab(next: ActivityTab) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === 'active') params.delete('tab');
        else params.set('tab', next);
        return params;
      },
      { replace: true },
    );
  }
  function setActiveView(next: ActiveView) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === 'everyone') params.delete('view');
        else params.set('view', next);
        return params;
      },
      { replace: true },
    );
  }

  const now = useMemo(() => Date.now(), []);

  const counts = useMemo(() => {
    let active = 0, studentLed = 0, coach = 0, quiet = 0;
    for (const s of students) {
      const c = categorizeStudent(s, now);
      if (c === 'active') { active++; if (isStudentLed(s, now)) studentLed++; }
      else if (c === 'coach_led') coach++;
      else quiet++;
    }
    return { active, studentLed, coach, quiet, activeTotal: active + coach };
  }, [students, now]);

  const filteredStudents = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    let result = students.filter((s) => {
      if (needle) {
        const name = s.display_name?.toLowerCase() || '';
        return name.includes(needle) || s.username.toLowerCase().includes(needle);
      }
      const c = categorizeStudent(s, now);
      if (activityTab === 'quiet') return c === 'quiet';
      // Active tab: everyone with recent activity on either side, refined by pill.
      if (c !== 'active' && c !== 'coach_led') return false;
      if (activeView === 'student_led') return isStudentLed(s, now);
      if (activeView === 'coach_led') return c === 'coach_led';
      return true;
    });
    if (sortBy === 'alphabetical') {
      result = [...result].sort((a, b) => (a.display_name || a.username).localeCompare(b.display_name || b.username));
    }
    return result;
  }, [students, filter, sortBy, activityTab, activeView, now]);

  function handleUnArchive(student: User) {
    archiveMutation.mutate(
      { userId: student.id, archived: false },
      {
        onSuccess: () => toast.success('Unarchived'),
        onError: () => toast.error('Failed to unarchive'),
      },
    );
  }

  function rowActions(student: User) {
    const showUnArchive = admin && student.archived;
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
        {showUnArchive && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                aria-label={`Actions for ${student.display_name || student.username}`}
              >
                <MoreVertical className="h-4 w-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => setTimeout(() => handleUnArchive(student), 0)}
              >
                <Archive className="mr-2 h-4 w-4" aria-hidden />
                Unarchive
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
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

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <Tabs value={activityTab} onValueChange={(v) => setActivityTab(v as ActivityTab)}>
            <TabsList className="w-full sm:w-auto">
              {ACTIVITY_TABS.map(({ value, label }) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="flex-1 px-2 sm:flex-initial sm:px-3"
                >
                  {label}{' '}
                  <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground tabular-nums">
                    {value === 'active' ? counts.activeTotal : counts.quiet}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {activityTab === 'active' && (
            <Tabs value={activeView} onValueChange={(v) => setActiveView(v as ActiveView)}>
              <TabsList className="h-8 w-full bg-muted/60 p-0.5 sm:w-auto">
                {ACTIVE_VIEWS.map(({ value, label }) => (
                  <TabsTrigger
                    key={value}
                    value={value}
                    className="h-7 flex-1 gap-1 px-2.5 text-xs sm:flex-initial"
                  >
                    {label}
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums">
                      {value === 'everyone'
                        ? counts.activeTotal
                        : value === 'student_led'
                          ? counts.studentLed
                          : counts.coach}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}

          {/* Reserve a static height so the row count doesn't shift when the
            * flavour text wraps to a second line on narrow screens. */}
          <div className="mb-2 min-h-[2.5rem]">
            <p className="text-xs text-muted-foreground">
              {flavour(activityTab, activeView)}
            </p>
          </div>
        </div>

        <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="Sort by..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent_update">Recently active</SelectItem>
            <SelectItem value="alphabetical">Alphabetical</SelectItem>
          </SelectContent>
        </Select>
      </div>

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
        ) : filteredStudents.length > 0 ? (
          <div className="divide-y divide-border">
            {filteredStudents.map((student) => (
              <StudentRow
                key={student.id}
                student={student}
                href={`/student/${student.id}`}
                actions={rowActions(student)}
              />
            ))}
          </div>
        ) : students.length === 0 ? (
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
        ) : (
          <EmptyState
            icon={Users}
            title="No matching students"
            description={
              filter
                ? 'Try a different search or clear the filter.'
                : 'No students in this view.'
            }
            action={
              filter && (
                <Button variant="outline" onClick={() => setFilter('')}>
                  Clear filter
                </Button>
              )
            }
          />
        )}
      </div>
    </div>
  );
}
