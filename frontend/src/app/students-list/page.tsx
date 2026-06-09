import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Archive, GraduationCap, MoreVertical, Search, UserPlus, Users, X } from 'lucide-react';
import { type User, isAdmin } from '@/lib/api';
import { useStudents } from '@/lib/queries';
import { useSetStudentGraduated, useToggleUserArchived } from '@/lib/mutations';
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
import { GraduateConfirmDialog } from '@/components/graduate-confirm-dialog';

type SortBy = 'recent_update' | 'alphabetical';
type StatusTab = 'active' | 'graduated' | 'archived' | 'all';

const STATUS_TABS: { value: StatusTab; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'graduated', label: 'Graduated' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All' },
];

const STATUS_TAB_VALUES = new Set<StatusTab>(['active', 'graduated', 'archived', 'all']);

function isStatusTab(value: string | null): value is StatusTab {
  return value !== null && STATUS_TAB_VALUES.has(value as StatusTab);
}

interface StudentsListProps {
  user: User;
}

export default function StudentsList({ user }: StudentsListProps) {
  const navigate = useNavigate();
  const admin = isAdmin(user);
  const studentsQuery = useStudents('recent_update', true);
  const students = useMemo(() => studentsQuery.data ?? [], [studentsQuery.data]);
  const loading = studentsQuery.isLoading;
  const error = studentsQuery.error
    ? 'Failed to load students. Please try again.'
    : null;
  const graduateMutation = useSetStudentGraduated();
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
  const statusTab: StatusTab = isStatusTab(tabParam) ? tabParam : 'active';
  function setStatusTab(next: StatusTab) {
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
  const [graduateTarget, setGraduateTarget] = useState<User | null>(null);

  const filteredStudents = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    let result = students.filter((student) => {
      if (statusTab === 'active') {
        if (student.archived || student.graduated_at) return false;
      } else if (statusTab === 'graduated') {
        if (!student.graduated_at) return false;
      } else if (statusTab === 'archived') {
        if (!student.archived) return false;
      }

      if (!needle) return true;
      const name = student.display_name?.toLowerCase() || '';
      const username = student.username.toLowerCase();
      return name.includes(needle) || username.includes(needle);
    });

    if (sortBy === 'alphabetical') {
      result = [...result].sort((a, b) => {
        const aName = a.display_name || a.username;
        const bName = b.display_name || b.username;
        return aName.localeCompare(bName);
      });
    }

    return result;
  }, [students, filter, sortBy, statusTab]);

  function handleUnGraduate(student: User) {
    graduateMutation.mutate(
      { id: student.id, graduated: false },
      {
        onSuccess: () => toast.success('Un-graduated'),
        onError: () => toast.error('Failed to un-graduate'),
      },
    );
  }

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
    const showUnGraduate = !!student.graduated_at;
    const showUnArchive = admin && student.archived;
    if (!showUnGraduate && !showUnArchive) return undefined;
    return (
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
          {showUnGraduate && (
            <DropdownMenuItem
              onSelect={() => setTimeout(() => setGraduateTarget(student), 0)}
            >
              <GraduationCap className="mr-2 h-4 w-4" aria-hidden />
              Un-graduate
            </DropdownMenuItem>
          )}
          {showUnArchive && (
            <DropdownMenuItem
              onSelect={() => setTimeout(() => handleUnArchive(student), 0)}
            >
              <Archive className="mr-2 h-4 w-4" aria-hidden />
              Unarchive
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
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
            placeholder="Search students"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Search students"
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

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={statusTab} onValueChange={(v) => setStatusTab(v as StatusTab)}>
          <TabsList className="w-full sm:w-auto">
            {STATUS_TABS.map(({ value, label }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="flex-1 px-2 sm:flex-initial sm:px-3"
              >
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

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
                href={`/student/${student.id}${statusTab !== 'active' ? `?from_tab=${statusTab}` : ''}`}
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
                : statusTab === 'graduated'
                  ? 'No graduated students.'
                  : statusTab === 'archived'
                    ? 'No archived students.'
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

      <GraduateConfirmDialog
        open={!!graduateTarget}
        onOpenChange={(open) => {
          if (!open) setGraduateTarget(null);
        }}
        mode="ungraduate"
        studentName={
          graduateTarget?.display_name || graduateTarget?.username || ''
        }
        onConfirm={() => {
          if (graduateTarget) {
            handleUnGraduate(graduateTarget);
            setGraduateTarget(null);
          }
        }}
      />
    </div>
  );
}
