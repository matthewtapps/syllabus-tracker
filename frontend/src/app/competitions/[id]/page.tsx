import { useEffect, useMemo, useState } from 'react';
import { Navigate, Link, useParams } from 'react-router-dom';
import { Award, Calendar, Check, ExternalLink, UserPlus, UserMinus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/empty-state';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  CampChoiceList,
  type CampChoiceValue,
} from '@/components/camps/camp-choice-list';
import { useCompetition, useStudents, useCampsForStudent } from '@/lib/queries';
import {
  useRegisterSelf,
  useRegisterStudent,
  useUnregisterStudent,
} from '@/lib/mutations';
import { useUser } from '@/lib/current-user-context';
import { isCoachOrAdmin } from '@/lib/api';
import type { RosterRow } from '@/lib/api';

export default function CompetitionDetailPage() {
  const params = useParams<{ id: string }>();
  const competitionId = params.id ? parseInt(params.id, 10) : NaN;

  if (!Number.isFinite(competitionId)) {
    return <Navigate to="/competitions" replace />;
  }

  return <CompetitionDetail competitionId={competitionId} />;
}

function CompetitionDetail({ competitionId }: { competitionId: number }) {
  const viewer = useUser();
  const isCoach = isCoachOrAdmin(viewer);

  const competitionQuery = useCompetition(competitionId);
  const competition = competitionQuery.data;

  const [registerOpen, setRegisterOpen] = useState(false);

  const registerSelfMutation = useRegisterSelf(competitionId);
  const unregisterStudentMutation = useUnregisterStudent(competitionId);

  const roster: RosterRow[] = useMemo(
    () => competition?.roster ?? [],
    [competition?.roster],
  );

  const isRegistered = useMemo(
    () => roster.some((r) => r.student_id === viewer.id),
    [roster, viewer.id],
  );

  async function handleRegisterSelf() {
    try {
      await registerSelfMutation.mutateAsync();
      toast.success('Registered for competition');
    } catch {
      toast.error('Failed to register. Please try again.');
    }
  }

  async function handleUnregisterStudent(studentId: number, name: string | null) {
    try {
      await unregisterStudentMutation.mutateAsync(studentId);
      toast.success(`Unregistered ${name ?? 'student'}`);
    } catch {
      toast.error('Failed to unregister student. Please try again.');
    }
  }

  if (competitionQuery.isError) {
    return <Navigate to="/competitions" replace />;
  }

  if (competitionQuery.isLoading || !competition) {
    return (
      <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
        <div className="space-y-3">
          <div className="h-5 w-1/2 animate-pulse rounded bg-muted" />
          <div className="h-4 w-1/4 animate-pulse rounded bg-muted" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-6 px-4 py-6 sm:px-6 md:py-8">
      <header className="space-y-1">
        <div className="flex items-start justify-between gap-2">
          <h1 className="flex items-center gap-2 text-base font-semibold">
            <Award className="h-4 w-4 shrink-0" aria-hidden />
            {competition.name}
          </h1>

          {!isCoach && (
            isRegistered ? (
              <Badge variant="secondary" className="shrink-0">
                Registered
              </Badge>
            ) : (
              <Button
                size="sm"
                className="h-7 shrink-0 gap-1.5 text-xs"
                onClick={handleRegisterSelf}
                disabled={registerSelfMutation.isPending}
              >
                {registerSelfMutation.isPending ? 'Registering...' : 'Register'}
              </Button>
            )
          )}
        </div>

        {competition.date && (
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            <Calendar className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {formatDate(competition.date)}
          </p>
        )}
      </header>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Roster
          </h2>
          {isCoach && (
            <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
              <DialogTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 text-xs"
                >
                  <UserPlus className="h-3.5 w-3.5" aria-hidden />
                  Register student
                </Button>
              </DialogTrigger>
              <RegisterStudentDialog
                competitionId={competitionId}
                roster={roster}
                open={registerOpen}
                onDone={() => setRegisterOpen(false)}
              />
            </Dialog>
          )}
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {roster.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No students registered"
              description={
                isCoach
                  ? 'Register students using the button above.'
                  : 'No students have registered yet.'
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {roster.map((row) => (
                <li
                  key={row.student_id}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="truncate text-sm font-medium">
                      {row.student_name ?? `Student #${row.student_id}`}
                      {row.student_id === viewer.id && (
                        <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Registered {formatDateTime(row.registered_at)}
                    </p>
                    {row.camp_id != null && (
                      <Link
                        to={`/camps/${row.camp_id}`}
                        className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" aria-hidden />
                        View camp
                      </Link>
                    )}
                  </div>

                  {isCoach && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Unregister ${row.student_name ?? 'student'}`}
                      onClick={() =>
                        handleUnregisterStudent(row.student_id, row.student_name)
                      }
                      disabled={unregisterStudentMutation.isPending}
                    >
                      <UserMinus className="h-4 w-4" aria-hidden />
                      <span className="sr-only">
                        Unregister {row.student_name ?? 'student'}
                      </span>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function RegisterStudentDialog({
  competitionId,
  roster,
  open,
  onDone,
}: {
  competitionId: number;
  roster: RosterRow[];
  open: boolean;
  onDone: () => void;
}) {
  const studentsQuery = useStudents();
  const students = useMemo(() => studentsQuery.data ?? [], [studentsQuery.data]);
  const registerMutation = useRegisterStudent(competitionId);

  const registeredIds = useMemo(
    () => new Set(roster.map((r) => r.student_id)),
    [roster],
  );

  const available = useMemo(
    () => students.filter((s) => !registeredIds.has(s.id)),
    [students, registeredIds],
  );

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [campChoice, setCampChoice] = useState<CampChoiceValue>({
    kind: 'create_new',
  });

  const selectedStudent = available.find((s) => s.id === selectedId);

  const campsQuery = useCampsForStudent(selectedId ?? undefined);
  const camps = useMemo(() => campsQuery.data ?? [], [campsQuery.data]);

  // Reset the whole flow when the dialog closes.
  useEffect(() => {
    if (!open) {
      setSelectedId(null);
      setCampChoice({ kind: 'create_new' });
    }
  }, [open]);

  // Reset the camp choice whenever the selected student changes.
  useEffect(() => {
    setCampChoice({ kind: 'create_new' });
  }, [selectedId]);

  async function handleSubmit() {
    if (selectedId == null) return;
    try {
      await registerMutation.mutateAsync({
        studentId: selectedId,
        choice:
          campChoice.kind === 'existing'
            ? { kind: 'existing', campId: campChoice.campId }
            : { kind: 'create_new' },
      });
      toast.success(
        `Registered ${
          (selectedStudent?.display_name || selectedStudent?.username) ??
          'student'
        }`,
      );
      onDone();
    } catch {
      toast.error('Failed to register student. Please try again.');
    }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Register student</DialogTitle>
        <DialogDescription>
          Pick a student to register for this competition.
        </DialogDescription>
      </DialogHeader>

      {studentsQuery.isLoading ? (
        <div className="space-y-2 py-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded bg-muted" />
          ))}
        </div>
      ) : available.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          All students are already registered.
        </p>
      ) : (
        <div className="space-y-4">
          <Command className="rounded-lg border border-border">
            <CommandInput placeholder="Search students..." />
            <CommandList className="max-h-48">
              <CommandEmpty>No students found.</CommandEmpty>
              {available.map((s) => {
                const name = s.display_name || s.username;
                const isSelected = selectedId === s.id;
                return (
                  <CommandItem
                    key={s.id}
                    value={name}
                    onSelect={() =>
                      setSelectedId(isSelected ? null : s.id)
                    }
                  >
                    <Check
                      className={`h-4 w-4 ${
                        isSelected ? 'opacity-100' : 'opacity-0'
                      }`}
                      aria-hidden
                    />
                    {name}
                  </CommandItem>
                );
              })}
            </CommandList>
          </Command>

          {selectedId != null && (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Camp
              </p>
              {campsQuery.isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-14 animate-pulse rounded-lg bg-muted"
                    />
                  ))}
                </div>
              ) : (
                <CampChoiceList
                  camps={camps}
                  value={campChoice}
                  onChange={setCampChoice}
                />
              )}
            </div>
          )}
        </div>
      )}

      <DialogFooter>
        <Button
          type="button"
          size="sm"
          disabled={selectedId == null || registerMutation.isPending}
          onClick={handleSubmit}
        >
          {registerMutation.isPending ? 'Registering...' : 'Register'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatDateTime(isoStr: string): string {
  try {
    return new Date(isoStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return isoStr;
  }
}
