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
import { useSyllabi } from '@/lib/queries';
import { useAssignSyllabusToStudent } from '@/lib/mutations';
import type { Syllabus } from '@/lib/api';

interface AssignSyllabusDialogProps {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  studentId: number;
  studentName?: string | null;
  /** Syllabus ids the student already has assigned. */
  assignedIds: Set<number>;
}

export function AssignSyllabusDialog({
  open,
  onOpenChange,
  studentId,
  studentName,
  assignedIds,
}: AssignSyllabusDialogProps) {
  const syllabiQuery = useSyllabi();
  const assignMutation = useAssignSyllabusToStudent();
  const [search, setSearch] = useState('');

  const syllabi = useMemo(() => syllabiQuery.data ?? [], [syllabiQuery.data]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return syllabi;
    return syllabi.filter((s: Syllabus) =>
      s.name.toLowerCase().includes(needle),
    );
  }, [syllabi, search]);

  async function handleAssign(syllabus: Syllabus) {
    try {
      await assignMutation.mutateAsync({ studentId, syllabusId: syllabus.id });
      toast.success(
        `Assigned ${syllabus.name}${studentName ? ` to ${studentName}` : ''}`,
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
          <DialogTitle>Assign syllabus</DialogTitle>
        </DialogHeader>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search syllabi"
        />
        <div className="min-h-0 flex-1 overflow-y-auto rounded border border-border bg-card">
          {syllabiQuery.isLoading ? (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">
              Loading syllabi...
            </p>
          ) : filtered.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">
              No matching syllabi.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((s: Syllabus) => {
                const already = assignedIds.has(s.id);
                return (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-2 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{s.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {s.technique_count}{' '}
                        {s.technique_count === 1 ? 'technique' : 'techniques'}
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
