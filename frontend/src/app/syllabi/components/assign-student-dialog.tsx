import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useStudents, useSyllabusStudents } from '@/lib/queries';
import { useAssignSyllabusToStudent } from '@/lib/mutations';
import type { User } from '@/lib/api';

interface AssignStudentDialogProps {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  syllabusId: number;
  syllabusName?: string;
}

export function AssignStudentDialog({
  open,
  onOpenChange,
  syllabusId,
  syllabusName,
}: AssignStudentDialogProps) {
  const studentsQuery = useStudents('alphabetical', false);
  const assignedQuery = useSyllabusStudents(
    open && syllabusId > 0 ? syllabusId : undefined,
  );
  const assignMutation = useAssignSyllabusToStudent();
  const [search, setSearch] = useState('');
  const assigned = useMemo(
    () => new Set(assignedQuery.data ?? []),
    [assignedQuery.data],
  );
  const students = useMemo(
    () => (studentsQuery.data ?? []).filter((s: User) => s.role === 'student'),
    [studentsQuery.data],
  );
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return students;
    return students.filter(
      (s: User) =>
        (s.display_name?.toLowerCase().includes(needle) ?? false) ||
        s.username.toLowerCase().includes(needle),
    );
  }, [students, search]);

  async function handleAssign(student: User) {
    try {
      await assignMutation.mutateAsync({
        studentId: student.id,
        syllabusId,
      });
      toast.success(
        `Assigned ${student.display_name || student.username}${
          syllabusName ? ` to ${syllabusName}` : ''
        }`,
      );
    } catch {
      toast.error('Failed to assign');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[90vh] flex-col"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>
            Assign{syllabusName ? ` ${syllabusName}` : ' syllabus'}
          </DialogTitle>
        </DialogHeader>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search students"
        />
        <div className="min-h-0 flex-1 overflow-y-auto rounded border border-border bg-card">
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">
              No matching students.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((s: User) => {
                const already = assigned.has(s.id);
                return (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-2 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {s.display_name || s.username}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {s.username}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={already || assignMutation.isPending}
                      onClick={() => handleAssign(s)}
                    >
                      {already ? 'Assigned' : 'Assign'}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
