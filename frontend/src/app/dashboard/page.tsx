import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Dumbbell,
  GraduationCap,
  type LucideIcon,
  PlayCircle,
  Sparkles,
  Users,
} from 'lucide-react';
import type { User } from '@/lib/api';
import { useUser } from '@/lib/current-user-context';
import { toast } from 'sonner';
import { type InviteResponse, type RecentAttemptItem } from '@/lib/api';
import {
  useLibraryStats,
  useStudentSyllabusTechniquesFlat,
  useRecentSyllabusAttempts,
  useSyllabusAttemptHeatmap,
  useStudents,
} from '@/lib/queries';
import { useApproveUser, useResetUserClaim } from '@/lib/mutations';
import { qk } from '@/lib/query-keys';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ClaimLinkPanel } from '@/components/claim-link-panel';
import type { StudentSyllabusTechniqueOverview, Technique } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatRelative } from '@/lib/dates';
import { statusToDotClass } from '@/lib/status';
import { Button } from '@/components/ui/button';
import { AttemptHeatmap } from '@/components/attempt-heatmap';
import { EmptyState } from '@/components/empty-state';
import {
  SkeletonListRow,
  SkeletonStatTile,
} from '@/components/skeleton-row';
import { StatusDonut } from '@/components/status-donut';
import type { Status } from '@/lib/status';
import { DashboardTotals } from './components/dashboard-totals';
import { QueuePanel } from './components/queue-panel';
import { ActivityDigest } from './components/activity-digest';
import { RecentActivityFeed } from './components/recent-activity-feed';

const DASHBOARD_DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});

export default function Dashboard() {
  const user = useUser();
  if (user.role === 'student') {
    return <StudentDashboard />;
  }
  return <CoachDashboard />;
}

function CoachDashboard() {
  const user = useUser();
  const qc = useQueryClient();
  const studentsQuery = useStudents('recent_update', false);
  const libraryStatsQuery = useLibraryStats();
  const students = studentsQuery.data ?? null;
  const totalTechniques = libraryStatsQuery.data?.total_techniques ?? null;
  const loading = studentsQuery.isLoading;
  const error = studentsQuery.error ? 'Failed to load dashboard data. Please try again.' : null;
  const resetClaimMutation = useResetUserClaim();
  const approveMutation = useApproveUser();

  const activeStudents = useMemo(
    () => (students ?? []).filter((s) => !s.archived && !s.graduated_at),
    [students],
  );

  const totalAssignments = useMemo(() => {
    let red = 0, amber = 0, green = 0;
    for (const s of activeStudents) {
      red += s.red_count ?? 0;
      amber += s.amber_count ?? 0;
      green += s.green_count ?? 0;
    }
    return red + amber + green;
  }, [activeStudents]);

  const pendingApprovals = useMemo(
    () => activeStudents.filter((s) => s.claimed_at && !s.approved_at),
    [activeStudents],
  );

  const resetRequests = useMemo(
    () => activeStudents.filter((s) => s.reset_requested_at),
    [activeStudents],
  );

  const [issuedClaimUrl, setIssuedClaimUrl] = useState<string | null>(null);

  async function handleSendResetLink(studentId: number) {
    try {
      const response = await resetClaimMutation.mutateAsync(studentId);
      const invite: InviteResponse = await response.json();
      setIssuedClaimUrl(`${window.location.origin}${invite.claim_path}`);
      // Reflect locally pending: clear reset_requested_at so it disappears from the queue.
      qc.setQueryData<User[]>(
        qk.students('recent_update', false),
        (prev) =>
          prev?.map((s) =>
            s.id === studentId
              ? { ...s, reset_requested_at: null, claimed_at: null }
              : s,
          ),
      );
    } catch (err) {
      console.error(err);
      toast.error('Failed to create link');
    }
  }

  async function handleApprove(studentId: number) {
    try {
      await approveMutation.mutateAsync(studentId);
      toast.success('Approved');
    } catch (err) {
      console.error(err);
      toast.error('Failed to approve');
    }
  }

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
          <div className="mb-6 grid grid-cols-3 gap-3 sm:gap-4">
          <SkeletonStatTile />
          <SkeletonStatTile />
          <SkeletonStatTile />
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonListRow key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (error || !students) {
    return (
      <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
          <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card px-6 py-12 text-center">
          <p className="text-sm text-destructive">
            {error ?? 'Failed to load dashboard data.'}
          </p>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (activeStudents.length === 0) {
    return (
      <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
          <div className="rounded-lg border border-border bg-card">
          <EmptyState
            icon={Users}
            title="No students yet"
            description="Register your first student to start tracking their progress."
            action={
              <Button asChild>
                <Link to="/register-user">Register student</Link>
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  const greetingName = user.display_name || user.username;

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">

      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {DASHBOARD_DATE_FORMAT.format(new Date())}
      </p>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">
        Hi, {greetingName}
      </h1>

      <DashboardTotals
        className="mb-4"
        students={activeStudents.length}
        techniques={totalTechniques}
        assignments={totalAssignments}
      />

      <ActivityDigest className="mb-6" />

      <div className="mb-8">
        <QueuePanel
          resetRequests={resetRequests}
          pendingApprovals={pendingApprovals}
          onSendResetLink={handleSendResetLink}
          onApprove={handleApprove}
        />
      </div>

      <RecentActivityFeed />

      <Dialog
        open={!!issuedClaimUrl}
        onOpenChange={(next) => {
          if (!next) setIssuedClaimUrl(null);
        }}
      >
        <DialogContent className="w-[calc(100vw-1rem)] max-w-md p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>Sign-in link ready</DialogTitle>
            <DialogDescription>
              Show this QR code to the student or send them the link. Valid
              for 7 days.
            </DialogDescription>
          </DialogHeader>
          {issuedClaimUrl && <ClaimLinkPanel url={issuedClaimUrl} />}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIssuedClaimUrl(null)}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Minimal adapter: maps a StudentSyllabusTechniqueOverview onto the Technique
// shape expected by TechniqueSection. Only the fields TechniqueSection reads
// are populated; the rest are set to safe empty values.
function sstOverviewToTechnique(t: StudentSyllabusTechniqueOverview): Technique {
  return {
    id: t.sst_id,
    technique_id: t.technique_id,
    technique_name: t.technique_name,
    technique_description: '',
    status: t.status,
    student_notes: '',
    coach_notes: '',
    created_at: t.updated_at,
    updated_at: t.updated_at,
    last_coach_update_at: t.last_coach_update_at,
    last_coach_update_by_name: null,
    last_student_update_at: t.last_student_update_at,
    last_student_update_by_name: null,
    has_unseen_activity: false,
    collection_id: null,
    collection_name: null,
    tags: [],
    attempt_count: 0,
    last_attempt_at: t.last_attempt_at,
  };
}

function StudentDashboard() {
  const user = useUser();
  const techniquesQuery = useStudentSyllabusTechniquesFlat(user.id);
  const recentAttemptsQuery = useRecentSyllabusAttempts(user.id, 5);
  const heatmapQuery = useSyllabusAttemptHeatmap(user.id);
  const techniques = techniquesQuery.data ?? null;
  const recentAttempts: RecentAttemptItem[] = recentAttemptsQuery.data ?? [];
  const heatmap = heatmapQuery.data ?? [];
  const loading = techniquesQuery.isLoading;
  const error = techniquesQuery.error ? 'Failed to load your techniques.' : null;

  const counts = useMemo<Record<Status, number>>(() => {
    const totals: Record<Status, number> = { red: 0, amber: 0, green: 0 };
    for (const t of techniques ?? []) {
      totals[t.status as Status] += 1;
    }
    return totals;
  }, [techniques]);

  const total = counts.red + counts.amber + counts.green;
  const pctDone = total > 0 ? Math.round((counts.green / total) * 100) : 0;
  const isGraduate = !!user.graduated_at;

  // Techniques the student is actively working on: amber status, most recently
  // updated first. Mapped to the Technique shape expected by TechniqueSection.
  const currentlyWorking = useMemo<Technique[]>(() => {
    return (techniques ?? [])
      .filter((t) => t.status === 'amber')
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
      .slice(0, 5)
      .map((t) => sstOverviewToTechnique(t));
  }, [techniques]);

  // Techniques the student has marked green, most recently updated first.
  const recentlyDone = useMemo<Technique[]>(() => {
    return (techniques ?? [])
      .filter((t) => t.status === 'green')
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
      .slice(0, 3)
      .map((t) => sstOverviewToTechnique(t));
  }, [techniques]);

  // Techniques with recent coach attention the student hasn't yet responded to:
  // not green, coach has touched it, and no student update since then (or ever).
  const newFromCoach = useMemo<Technique[]>(() => {
    return (techniques ?? [])
      .filter((t) => {
        if (t.status === 'green') return false;
        if (!t.last_coach_update_at) return false;
        if (
          t.last_student_update_at &&
          t.last_student_update_at >= t.last_coach_update_at
        )
          return false;
        return true;
      })
      .sort(
        (a, b) =>
          Date.parse(b.last_coach_update_at ?? '0') -
          Date.parse(a.last_coach_update_at ?? '0'),
      )
      .slice(0, 5)
      .map((t) => sstOverviewToTechnique(t));
  }, [techniques]);

  const greetingName = user.display_name || user.username;

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {DASHBOARD_DATE_FORMAT.format(new Date())}
      </p>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">
        Hi, {greetingName}
      </h1>

      {isGraduate && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-status-green/30 bg-status-green-bg px-4 py-3 text-sm">
          <GraduationCap className="mt-0.5 h-4 w-4 shrink-0 text-status-green" aria-hidden />
          <div className="space-y-0.5">
            <p className="font-medium text-status-green">Congrats on graduating 🎓</p>
            <p className="text-muted-foreground">
              Keep taking notes on your techniques.
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-3 gap-3 sm:gap-4">
          <SkeletonStatTile />
          <SkeletonStatTile />
          <SkeletonStatTile />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card px-6 py-12 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </div>
      ) : total === 0 ? (
        <div className="rounded-lg border border-border bg-card">
          <EmptyState
            icon={AlertCircle}
            title="No techniques assigned yet"
            description="Your coach hasn't assigned any techniques. Check back soon."
          />
        </div>
      ) : (
        <>
          <p className="-mt-4 mb-6 text-sm text-muted-foreground">
            You're {pctDone}% done with your syllabus.
          </p>
          <StatusDonut counts={counts} className="mb-6" />

          {heatmap.length > 0 && (
            <section className="mb-8 overflow-hidden rounded-lg border border-border bg-card">
              <header className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold">Training activity</h2>
                <p className="text-xs text-muted-foreground">
                  Attempts logged over the last year.
                </p>
              </header>
              <div className="px-4 py-4">
                <AttemptHeatmap buckets={heatmap} />
              </div>
            </section>
          )}

          <div className="space-y-6">
            {newFromCoach.length > 0 && (
              <TechniqueSection
                title="New from your coach"
                icon={Sparkles}
                techniques={newFromCoach}
                studentId={user.id}
                showCoachTimestamp
              />
            )}

            {recentAttempts.length > 0 && (
              <RecentAttemptsSection
                attempts={recentAttempts}
                studentId={user.id}
              />
            )}

            {currentlyWorking.length > 0 && (
              <TechniqueSection
                title="Currently working on"
                icon={PlayCircle}
                techniques={currentlyWorking}
                studentId={user.id}
              />
            )}

            {recentlyDone.length > 0 && (
              <TechniqueSection
                title="Recently done"
                icon={CheckCircle2}
                techniques={recentlyDone}
                studentId={user.id}
              />
            )}

            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link to={`/student/${user.id}`} className="flex items-center gap-2">
                Open my syllabus
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

interface TechniqueSectionProps {
  title: string;
  icon: LucideIcon;
  techniques: Technique[];
  studentId: number;
  showCoachTimestamp?: boolean;
}

interface RecentAttemptsSectionProps {
  attempts: RecentAttemptItem[];
  studentId: number;
}

function RecentAttemptsSection({
  attempts,
  studentId,
}: RecentAttemptsSectionProps) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <Dumbbell className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-semibold">Recent attempts</h2>
      </header>
      <ul className="divide-y divide-border">
        {attempts.map((a) => {
          const note = a.student_note ?? a.coach_note ?? null;
          return (
            <li key={a.id}>
              <Link
                to={`/student/${studentId}?focus=${a.student_technique_id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {a.technique_name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatRelative(a.attempted_at)}
                    {note && ` · ${note}`}
                  </p>
                </div>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function TechniqueSection({
  title,
  icon: Icon,
  techniques,
  studentId,
  showCoachTimestamp = false,
}: TechniqueSectionProps) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-semibold">{title}</h2>
      </header>
      <ul className="divide-y divide-border">
        {techniques.map((t) => {
          const ts = showCoachTimestamp ? t.last_coach_update_at : t.updated_at;
          return (
            <li key={t.id}>
              <Link
                to={`/student/${studentId}?focus=${t.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
              >
                <span
                  className={cn(
                    'h-2 w-2 shrink-0 rounded-full',
                    statusToDotClass(t.status as Status),
                  )}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.technique_name}</p>
                  {ts && (
                    <p className="text-xs text-muted-foreground">{formatRelative(ts)}</p>
                  )}
                </div>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
