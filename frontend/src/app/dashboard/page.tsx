import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity,
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
  useAttemptHeatmap,
  useLibraryStats,
  useRecentAttempts,
  useRecentlyActiveStudents,
  useStudentTechniques,
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
import { StudentRow } from '@/components/student-row';
import type { RecentlyActiveStudent, Technique } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatRelative } from '@/lib/dates';
import { statusToDotClass } from '@/lib/status';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AttemptHeatmap } from '@/components/attempt-heatmap';
import { EmptyState } from '@/components/empty-state';
import {
  SkeletonListRow,
  SkeletonStatTile,
} from '@/components/skeleton-row';
import { StatusDonut } from '@/components/status-donut';
import type { Status } from '@/lib/status';
import { activityLine } from '@/lib/activity-line';
import type { ActivityRow } from '@/lib/activity-line';
import { DashboardTotals } from './components/dashboard-totals';
import { QueuePanel } from './components/queue-panel';

const STALE_THRESHOLD_DAYS = 14;
const INITIATIVE_THRESHOLD_DAYS = 7;

const DASHBOARD_DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});

type RosterTab = 'initiative' | 'recent' | 'quiet';

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
  const recentlyActiveQuery = useRecentlyActiveStudents();
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

  const statusCounts = useMemo<Record<Status, number>>(() => {
    const totals: Record<Status, number> = { red: 0, amber: 0, green: 0 };
    for (const s of activeStudents) {
      totals.red += s.red_count ?? 0;
      totals.amber += s.amber_count ?? 0;
      totals.green += s.green_count ?? 0;
    }
    return totals;
  }, [activeStudents]);

  const totalAssignments =
    statusCounts.red + statusCounts.amber + statusCounts.green;

  const initiativeStudents = useMemo(() => {
    const cutoff = Date.now() - INITIATIVE_THRESHOLD_DAYS * 86400 * 1000;
    return activeStudents.filter((s) => {
      const ts = s.last_student_initiative_at;
      if (!ts) return false;
      const parsed = Date.parse(ts);
      return Number.isFinite(parsed) && parsed >= cutoff;
    });
  }, [activeStudents]);

  const pendingApprovals = useMemo(
    () => activeStudents.filter((s) => s.claimed_at && !s.approved_at),
    [activeStudents],
  );

  const needsSyllabus = useMemo(
    () =>
      activeStudents.filter((s) => {
        if ((s.total_techniques ?? 0) !== 0) return false;
        if (s.claimed_at && !s.approved_at) return false;
        return true;
      }),
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

  const recentStudents = useMemo(() => {
    const cutoff = Date.now() - STALE_THRESHOLD_DAYS * 86400 * 1000;
    return activeStudents.filter((s) => {
      if (!s.last_update) return false;
      const ts = Date.parse(s.last_update);
      return Number.isFinite(ts) && ts >= cutoff;
    });
  }, [activeStudents]);

  const quietStudents = useMemo(() => {
    const cutoff = Date.now() - STALE_THRESHOLD_DAYS * 86400 * 1000;
    return activeStudents.filter((s) => {
      if ((s.total_techniques ?? 0) === 0) return false;
      const last = s.last_coach_update_at ?? s.last_update;
      if (!last) return true;
      const ts = new Date(last).getTime();
      return !isNaN(ts) && ts < cutoff;
    });
  }, [activeStudents]);

  const [rosterTab, setRosterTab] = useState<RosterTab>('initiative');

  const rosterCounts = {
    initiative: initiativeStudents.length,
    recent: recentStudents.length,
    quiet: quietStudents.length,
  };

  const rosterForTab =
    rosterTab === 'initiative'
      ? initiativeStudents
      : rosterTab === 'quiet'
        ? quietStudents
        : recentStudents;

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

      {totalAssignments > 0 && <StatusDonut counts={statusCounts} className="mb-6" />}

      <Tabs
        value={rosterTab}
        onValueChange={(v) => setRosterTab(v as RosterTab)}
        className="mb-8 gap-3"
      >
        <TabsList className="w-full">
          <TabsTrigger value="initiative">
            Initiative
            <RosterCountBadge n={rosterCounts.initiative} />
          </TabsTrigger>
          <TabsTrigger value="recent">
            Recent
            <RosterCountBadge n={rosterCounts.recent} />
          </TabsTrigger>
          <TabsTrigger value="quiet">
            Quiet
            <RosterCountBadge n={rosterCounts.quiet} />
          </TabsTrigger>
        </TabsList>

        <p className="px-1 text-xs text-muted-foreground">
          {rosterDescription(rosterTab)}
        </p>

        <TabsContent value={rosterTab}>
          <Roster
            students={rosterForTab}
            emptyMessage={rosterEmptyMessage(rosterTab)}
            showWatchTitle={rosterTab === 'initiative'}
          />
        </TabsContent>
      </Tabs>

      <div className="mb-8">
        <QueuePanel
          resetRequests={resetRequests}
          pendingApprovals={pendingApprovals}
          needsSyllabus={needsSyllabus}
          onSendResetLink={handleSendResetLink}
          onApprove={handleApprove}
        />
      </div>

      <RecentlyActivePanel
        data={recentlyActiveQuery.data ?? null}
        isLoading={recentlyActiveQuery.isLoading}
      />

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

function Roster({
  students,
  emptyMessage,
  showWatchTitle,
}: {
  students: User[];
  emptyMessage: string;
  showWatchTitle?: boolean;
}) {
  if (students.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card px-4 py-10 text-center">
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }
  return (
    <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
      {students.map((s) => (
        <StudentRow
          key={s.id}
          student={s}
          href={`/student/${s.id}?from=dashboard`}
          showWatchTitle={showWatchTitle}
        />
      ))}
    </div>
  );
}

function rosterDescription(tab: RosterTab): string {
  switch (tab) {
    case 'initiative':
      return `Students who edited their own notes or watched a video in the last ${INITIATIVE_THRESHOLD_DAYS} days.`;
    case 'recent':
      return `Any update (by you or them) in the last ${STALE_THRESHOLD_DAYS} days.`;
    case 'quiet':
      return `Students with techniques assigned but no coach update in the last ${STALE_THRESHOLD_DAYS} days.`;
  }
}

function RosterCountBadge({ n }: { n: number }) {
  return (
    <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded bg-muted px-1 text-[10px] font-semibold tabular-nums text-muted-foreground">
      {n}
    </span>
  );
}

function rosterEmptyMessage(tab: RosterTab): string {
  switch (tab) {
    case 'initiative':
      return 'No students active in the past week.';
    case 'quiet':
      return `No students have gone ${STALE_THRESHOLD_DAYS} days without a coach update.`;
    case 'recent':
      return `No activity in the last ${STALE_THRESHOLD_DAYS} days.`;
  }
}

function StudentDashboard() {
  const user = useUser();
  const techniquesQuery = useStudentTechniques(user.id);
  const recentAttemptsQuery = useRecentAttempts(user.id, 5);
  const heatmapQuery = useAttemptHeatmap(user.id);
  const techniques = techniquesQuery.data?.techniques ?? null;
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

  const currentlyWorking = useMemo(() => {
    return (techniques ?? [])
      .filter((t) => t.status === 'amber')
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
      .slice(0, 5);
  }, [techniques]);

  const recentlyDone = useMemo(() => {
    return (techniques ?? [])
      .filter((t) => t.status === 'green')
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
      .slice(0, 3);
  }, [techniques]);

  const newFromCoach = useMemo(() => {
    return (techniques ?? [])
      .filter((t) => t.has_unseen_activity)
      .sort(
        (a, b) =>
          Date.parse(b.last_coach_update_at ?? '0') -
          Date.parse(a.last_coach_update_at ?? '0'),
      )
      .slice(0, 5);
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

// Build a minimal ActivityRow-shaped object from a RecentlyActiveStudent so
// activityLine can format the verb copy and produce deep-link hrefs.
function recentlyActiveToActivityRow(r: RecentlyActiveStudent): ActivityRow {
  return {
    id: 0,
    occurred_at: r.occurred_at,
    verb: r.verb,
    actor_user_id: r.student_id,
    actor_name: r.student_name,
    target_student_id: r.student_id,
    technique_id: r.technique_id ?? null,
    technique_name: r.technique_name ?? null,
    syllabus_id: r.syllabus_id ?? null,
    syllabus_name: r.syllabus_name ?? null,
    sst_id: null,
    video_id: r.video_id ?? null,
    video_title: r.video_title ?? null,
    payload_json: r.payload_json ?? null,
    unread: false,
  };
}

function RecentlyActivePanel({
  data,
  isLoading,
}: {
  data: RecentlyActiveStudent[] | null;
  isLoading: boolean;
}) {
  return (
    <section className="mb-8 overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <Activity className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-semibold">Recent student activity</h2>
      </header>

      {isLoading ? (
        <div className="divide-y divide-border">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="px-4 py-3">
              <div className="h-3 w-1/4 animate-pulse rounded bg-muted" />
              <div className="mt-2 h-3 w-2/5 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-muted-foreground">
          No recent student activity yet.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {data.map((row, idx) => {
            const line = activityLine(recentlyActiveToActivityRow(row));
            return (
              <li
                key={`${row.student_id}-${row.occurred_at}-${idx}`}
                className="flex items-start justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="truncate text-sm font-medium">
                    {row.student_name ?? 'A student'}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {line.href ? (
                      <Link
                        to={line.href}
                        className="underline-offset-2 hover:underline"
                      >
                        {line.text}
                      </Link>
                    ) : (
                      line.text
                    )}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatRelative(row.occurred_at)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
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
