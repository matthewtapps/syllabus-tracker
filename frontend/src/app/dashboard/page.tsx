import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Bell,
  CheckCircle2,
  ChevronRight,
  Clock,
  Copy,
  Dumbbell,
  GraduationCap,
  History,
  KeyRound,
  type LucideIcon,
  PlayCircle,
  Sparkles,
  UserPlus,
  Users,
} from 'lucide-react';
import type { User } from '@/lib/api';
import { toast } from 'sonner';
import {
  approveUser,
  getLibraryStats,
  getRecentAttemptsForStudent,
  getStudentTechniques,
  getStudents,
  resetUserClaim,
  type InviteResponse,
  type RecentAttemptItem,
} from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ClaimLinkPanel } from '@/components/claim-link-panel';
import type { Technique } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatRelative } from '@/lib/dates';
import { statusToDotClass } from '@/lib/status';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import {
  SkeletonListRow,
  SkeletonStatTile,
} from '@/components/skeleton-row';
import { StatusDonut } from '@/components/status-donut';
import type { Status } from '@/lib/status';
import { VideoOverviewCard } from '@/components/videos/video-overview-card';
import { useCapabilities } from '@/context/capabilities-context';
import { DashboardTotals } from './components/dashboard-totals';
import { StudentSection } from './components/student-section';

const STALE_THRESHOLD_DAYS = 14;
const INITIATIVE_THRESHOLD_DAYS = 7;
const RECENT_LIMIT = 8;

interface DashboardProps {
  user: User | null;
}

export default function Dashboard({ user }: DashboardProps) {
  if (!user) {
    return (
      <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
        <PageHeader title="Dashboard" />
      </div>
    );
  }

  const role = user.role?.toLowerCase();
  if (role === 'student') {
    return <StudentDashboard user={user} />;
  }
  return <CoachDashboard />;
}

function CoachDashboard() {
  const [students, setStudents] = useState<User[] | null>(null);
  const [totalTechniques, setTotalTechniques] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { videos: videosEnabled } = useCapabilities();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        const [studentsResult, statsResult] = await Promise.allSettled([
          getStudents('recent_update', false),
          getLibraryStats(),
        ]);
        if (cancelled) return;
        if (studentsResult.status === 'rejected') throw studentsResult.reason;
        setStudents(studentsResult.value);
        setTotalTechniques(
          statsResult.status === 'fulfilled'
            ? statsResult.value.total_techniques
            : null,
        );
        setError(null);
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        setError('Failed to load dashboard data. Please try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

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

  const needsAttention = useMemo(() => {
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

  const resetRequests = useMemo(
    () => activeStudents.filter((s) => s.reset_requested_at),
    [activeStudents],
  );

  const [issuedClaimUrl, setIssuedClaimUrl] = useState<string | null>(null);

  async function handleSendResetLink(studentId: number) {
    try {
      const response = await resetUserClaim(studentId);
      if (!response.ok) {
        toast.error('Failed to create link');
        return;
      }
      const invite: InviteResponse = await response.json();
      setIssuedClaimUrl(`${window.location.origin}${invite.claim_path}`);
      setStudents((prev) =>
        prev
          ? prev.map((s) =>
              s.id === studentId
                ? { ...s, reset_requested_at: null, claimed_at: null }
                : s,
            )
          : prev,
      );
    } catch (err) {
      console.error(err);
      toast.error('Failed to create link');
    }
  }

  async function handleApprove(studentId: number) {
    try {
      const response = await approveUser(studentId);
      if (!response.ok) {
        toast.error('Failed to approve');
        return;
      }
      setStudents((prev) =>
        prev
          ? prev.map((s) =>
              s.id === studentId
                ? { ...s, approved_at: new Date().toISOString() }
                : s,
            )
          : prev,
      );
      toast.success('Approved');
    } catch (err) {
      console.error(err);
      toast.error('Failed to approve');
    }
  }

  const staleStudents = useMemo(() => {
    const cutoff = Date.now() - STALE_THRESHOLD_DAYS * 86400 * 1000;
    return activeStudents.filter((s) => {
      if ((s.total_techniques ?? 0) === 0) return false;
      const last = s.last_coach_update_at ?? s.last_update;
      if (!last) return true;
      const ts = new Date(last).getTime();
      return !isNaN(ts) && ts < cutoff;
    });
  }, [activeStudents]);

  const recentStudents = useMemo(
    () => activeStudents.slice(0, RECENT_LIMIT),
    [activeStudents],
  );

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
        <PageHeader title="Dashboard" />
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
        <PageHeader title="Dashboard" />
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
        <PageHeader title="Dashboard" />
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

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
      <PageHeader title="Dashboard" />

      <DashboardTotals
        className="-mt-4 mb-6"
        students={activeStudents.length}
        techniques={totalTechniques}
        assignments={totalAssignments}
      />

      <StatusDonut counts={statusCounts} className="mb-8" />

      {videosEnabled && <VideoOverviewCard className="mb-6" />}

      <div className="space-y-6">
        {resetRequests.length > 0 && (
          <section className="overflow-hidden rounded-lg border border-status-amber/30 bg-card">
            <header className="flex items-center gap-2.5 border-b border-status-amber/30 bg-status-amber-bg px-4 py-3">
              <KeyRound className="h-4 w-4 text-status-amber" aria-hidden />
              <div>
                <h2 className="text-sm font-semibold">Password reset requests</h2>
                <p className="text-xs text-muted-foreground">
                  Students asking for a fresh sign-in link.
                </p>
              </div>
            </header>
            <ul className="divide-y divide-border">
              {resetRequests.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {s.display_name || s.username}
                    </p>
                    {s.username && s.display_name && (
                      <p className="truncate text-xs text-muted-foreground">
                        {s.username}
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleSendResetLink(s.id)}
                    className="gap-2"
                  >
                    <Copy className="h-4 w-4" aria-hidden />
                    Send link
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {pendingApprovals.length > 0 && (
          <section className="overflow-hidden rounded-lg border border-status-amber/30 bg-card">
            <header className="flex items-center gap-2.5 border-b border-status-amber/30 bg-status-amber-bg px-4 py-3">
              <UserPlus className="h-4 w-4 text-status-amber" aria-hidden />
              <div>
                <h2 className="text-sm font-semibold">Pending approvals</h2>
                <p className="text-xs text-muted-foreground">
                  Students who signed up themselves. Approve to start preparing
                  their card.
                </p>
              </div>
            </header>
            <ul className="divide-y divide-border">
              {pendingApprovals.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {s.display_name || s.username}
                    </p>
                    {s.username && s.display_name && (
                      <p className="truncate text-xs text-muted-foreground">
                        {s.username}
                      </p>
                    )}
                  </div>
                  <Button size="sm" onClick={() => handleApprove(s.id)}>
                    Approve
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {needsAttention.length > 0 && (
          <StudentSection
            title="Taking initiative"
            icon={Bell}
            variant="attention"
            description="Students who've been active in the past week."
            students={needsAttention}
          />
        )}

        <StudentSection
          title="Recently updated"
          icon={Clock}
          students={recentStudents}
          footer={
            <Button asChild variant="ghost" size="sm" className="h-8 px-2">
              <Link to="/students" className="flex items-center gap-1">
                View all students
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </Button>
          }
        />

        {staleStudents.length > 0 && (
          <StudentSection
            title="Quiet for a while"
            icon={History}
            description={`No coach update in the last ${STALE_THRESHOLD_DAYS} days.`}
            students={staleStudents.slice(0, RECENT_LIMIT)}
          />
        )}
      </div>

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

function StudentDashboard({ user }: { user: User }) {
  const [techniques, setTechniques] = useState<Technique[] | null>(null);
  const [recentAttempts, setRecentAttempts] = useState<RecentAttemptItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        const [techResult, recentResult] = await Promise.all([
          getStudentTechniques(user.id),
          getRecentAttemptsForStudent(user.id, 5).catch(() => []),
        ]);
        if (cancelled) return;
        setTechniques(techResult.techniques);
        setRecentAttempts(recentResult);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        setError('Failed to load your techniques.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [user.id]);

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

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
      <PageHeader title="Dashboard" />

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
          <StatusDonut counts={counts} className="mb-8" />

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
