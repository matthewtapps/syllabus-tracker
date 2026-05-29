import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Bell,
  CheckCircle2,
  ChevronRight,
  Clock,
  GraduationCap,
  History,
  type LucideIcon,
  PlayCircle,
  Sparkles,
  Users,
} from 'lucide-react';
import type { User } from '@/lib/api';
import {
  getLibraryStats,
  getStudentTechniques,
  getStudents,
  markDashboardSeen,
} from '@/lib/api';
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
import { DashboardTotals } from './components/dashboard-totals';
import { StudentSection } from './components/student-section';

const STALE_THRESHOLD_DAYS = 14;
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
    () => (students ?? []).filter((s) => !s.archived),
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

  const needsAttention = useMemo(
    () => activeStudents.filter((s) => s.has_new_student_activity),
    [activeStudents],
  );

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

      <div className="space-y-6">
        {needsAttention.length > 0 && (
          <StudentSection
            title="Taking initiative"
            icon={Bell}
            variant="attention"
            description="Students who've updated their notes since you last looked."
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
    </div>
  );
}

function StudentDashboard({ user }: { user: User }) {
  const [techniques, setTechniques] = useState<Technique[] | null>(null);
  const [previousSeenAt, setPreviousSeenAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        const [techResult, seenResult] = await Promise.all([
          getStudentTechniques(user.id),
          markDashboardSeen(),
        ]);
        if (cancelled) return;
        setTechniques(techResult.techniques);
        setPreviousSeenAt(seenResult?.previous_last_seen_at ?? null);
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
    if (!previousSeenAt) return [];
    return (techniques ?? [])
      .filter((t) => {
        if (!t.last_coach_update_at) return false;
        return t.last_coach_update_at > previousSeenAt;
      })
      .sort(
        (a, b) =>
          Date.parse(b.last_coach_update_at ?? '0') -
          Date.parse(a.last_coach_update_at ?? '0'),
      )
      .slice(0, 5);
  }, [techniques, previousSeenAt]);

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
                to={`/student/${studentId}`}
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
