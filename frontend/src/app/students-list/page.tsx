import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, UserPlus, X } from 'lucide-react';
import { getStudents, type User } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
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

type SortBy = 'recent_update' | 'alphabetical';

export default function StudentsList() {
  const navigate = useNavigate();
  const [students, setStudents] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('recent_update');
  const [showArchived, setShowArchived] = useState(false);
  const [showGraduated, setShowGraduated] = useState(false);

  useEffect(() => {
    loadStudents();
  }, [showArchived]);

  async function loadStudents() {
    try {
      setLoading(true);
      const data = await getStudents('recent_update', showArchived);
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
      if (!showArchived && student.archived) return false;
      if (!showGraduated && student.graduated_at) return false;
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
  }, [students, filter, sortBy, showArchived, showGraduated]);

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

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full max-w-md">
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

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="show-graduated"
              checked={showGraduated}
              onCheckedChange={setShowGraduated}
            />
            <Label htmlFor="show-graduated" className="text-sm">
              Show graduated
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="show-archived"
              checked={showArchived}
              onCheckedChange={setShowArchived}
            />
            <Label htmlFor="show-archived" className="text-sm">
              Show archived
            </Label>
          </div>

          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
            <SelectTrigger className="w-[180px]">
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
              <StudentRow key={student.id} student={student} />
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
            description="Try a different search or clear the filter."
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
