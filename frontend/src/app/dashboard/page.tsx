import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Bell,
  Clock,
  History,
  Users,
} from 'lucide-react';
import type { User } from '@/lib/api';
import {
  getLibraryStats,
  getStudentTechniques,
  getStudents,
} from '@/lib/api';
import type { Technique } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import {
  SkeletonListRow,
  SkeletonStatTile,
} from '@/components/skeleton-row';
import type { Status } from '@/lib/status';
import { StatusTiles } from './components/status-tiles';
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

      <StatusTiles counts={statusCounts} total={totalAssignments} className="mb-8" />

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        const result = await getStudentTechniques(user.id);
        if (cancelled) return;
        setTechniques(result.techniques);
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

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
      <PageHeader title="Dashboard" />

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
            {total} {total === 1 ? 'technique' : 'techniques'} on your card.
          </p>
          <StatusTiles counts={counts} total={total} className="mb-8" />
          <Button asChild>
            <Link to={`/student/${user.id}`} className="flex items-center gap-2">
              Open my techniques
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        </>
      )}
    </div>
  );
}
