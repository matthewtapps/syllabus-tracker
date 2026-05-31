import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Archive, GraduationCap, MoreVertical, UserPlus, Users, X } from 'lucide-react';
import {
  getStudents,
  setStudentGraduated,
  updateUser,
  type User,
} from '@/lib/api';
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
import { PageHeader } from '@/components/page-header';
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

interface StudentsListProps {
  user: User;
}

export default function StudentsList({ user }: StudentsListProps) {
  const navigate = useNavigate();
  const isAdmin = user.role?.toLowerCase() === 'admin';
  const [students, setStudents] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('recent_update');
  const [statusTab, setStatusTab] = useState<StatusTab>('active');
  const [graduateTarget, setGraduateTarget] = useState<User | null>(null);

  useEffect(() => {
    loadStudents();
  }, []);

  async function loadStudents() {
    try {
      setLoading(true);
      const data = await getStudents('recent_update', true);
      setStudents(data);
      setError(null);
    } catch (err) {
      console.error(err);
      setError('Failed to load students. Please try again.');
    } finally {
      setLoading(false);
    }
  }

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

  async function handleUnGraduate(student: User) {
    const previous = student.graduated_at;
    setStudents((prev) =>
      prev.map((s) => (s.id === student.id ? { ...s, graduated_at: null } : s)),
    );
    try {
      const response = await setStudentGraduated(student.id, false);
      if (!response.ok) throw new Error('Failed');
      toast.success('Un-graduated');
    } catch (err) {
      console.error(err);
      setStudents((prev) =>
        prev.map((s) =>
          s.id === student.id ? { ...s, graduated_at: previous ?? null } : s,
        ),
      );
      toast.error('Failed to un-graduate');
    }
  }

  async function handleUnArchive(student: User) {
    setStudents((prev) =>
      prev.map((s) => (s.id === student.id ? { ...s, archived: false } : s)),
    );
    try {
      const response = await updateUser(student.id, { archived: false });
      if (!response.ok) throw new Error('Failed');
      toast.success('Unarchived');
    } catch (err) {
      console.error(err);
      setStudents((prev) =>
        prev.map((s) => (s.id === student.id ? { ...s, archived: true } : s)),
      );
      toast.error('Failed to unarchive');
    }
  }

  function rowActions(student: User) {
    const showUnGraduate = !!student.graduated_at;
    const showUnArchive = isAdmin && student.archived;
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
      <PageHeader
        title="Students"
        actions={
          <Button onClick={() => navigate('/register-user')}>
            <UserPlus className="mr-2 h-4 w-4" aria-hidden />
            Register student
          </Button>
        }
      />

      <div className="mb-6 space-y-3">
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

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-md">
            <Input
              placeholder="Filter students..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter students"
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
            <Button variant="outline" onClick={loadStudents}>
              Try again
            </Button>
          </div>
        ) : filteredStudents.length > 0 ? (
          <div className="divide-y divide-border">
            {filteredStudents.map((student) => (
              <StudentRow
                key={student.id}
                student={student}
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
