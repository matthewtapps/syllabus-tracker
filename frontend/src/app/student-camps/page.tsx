import { useState } from 'react';
import { Navigate, useParams, Link, useNavigate } from 'react-router-dom';
import { Dumbbell, ChevronRight, Plus } from 'lucide-react';
import { useUser } from '@/lib/current-user-context';
import { isCoachOrAdmin } from '@/lib/api';
import { useAllUsers, useCampsForStudent } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Dialog, DialogTrigger } from '@/components/ui/dialog';
import { CreateCampDialog } from '@/components/camps/create-camp-dialog';
import type { Camp } from '@/lib/api';

export default function StudentCampsPage() {
  const params = useParams<{ id: string }>();
  const studentId = params.id ? parseInt(params.id, 10) : NaN;
  const user = useUser();

  if (!Number.isFinite(studentId)) {
    return <Navigate to="/dashboard" replace />;
  }

  const isOwner = user.id === studentId;
  const isCoach = isCoachOrAdmin(user);
  if (!isOwner && !isCoach) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <CampsListing studentId={studentId} isOwnView={isOwner} isCoach={isCoach} />
  );
}

function CampsListing({
  studentId,
  isOwnView,
  isCoach,
}: {
  studentId: number;
  isOwnView: boolean;
  isCoach: boolean;
}) {
  const navigate = useNavigate();
  const campsQuery = useCampsForStudent(studentId);
  const camps = campsQuery.data ?? [];
  const active = camps.filter((c) => !c.archived_at);
  const archived = camps.filter((c) => !!c.archived_at);

  // Coaches view any student's camps, so personalise the heading the same way
  // the sibling pinned/syllabi pages do. Falls back to "Camps" until the name
  // resolves. Skipped for the owner's own view.
  const usersQuery = useAllUsers();
  const student = isOwnView
    ? undefined
    : (usersQuery.data ?? []).find((u) => u.id === studentId);
  const studentName = student?.display_name || student?.username;

  // Coaches create camps for a student; students don't create their own.
  const canCreateCamp = isCoach && !isOwnView;
  const [createCampOpen, setCreateCampOpen] = useState(false);

  return (
    <div className="container mx-auto space-y-6 px-4 py-6 sm:px-6 md:py-8">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-base font-semibold">
          {isOwnView
            ? 'My camps'
            : studentName
              ? `${studentName}'s camps`
              : 'Camps'}
        </h1>
        {canCreateCamp && (
          <Dialog open={createCampOpen} onOpenChange={setCreateCampOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1.5">
                <Plus className="h-4 w-4" aria-hidden />
                <span>Add camp</span>
              </Button>
            </DialogTrigger>
            <CreateCampDialog
              studentId={studentId}
              studentName={studentName ?? 'this student'}
              onCreated={(id) => {
                setCreateCampOpen(false);
                navigate(`/camps/${id}`);
              }}
            />
          </Dialog>
        )}
      </div>

      <CampsSection
        title="Active"
        camps={active}
        loading={campsQuery.isLoading}
        empty="No active camps."
      />
      {archived.length > 0 && (
        <CampsSection
          title="Archived"
          camps={archived}
          loading={false}
          empty=""
        />
      )}
    </div>
  );
}

function CampsSection({
  title,
  camps,
  loading,
  empty,
}: {
  title: string;
  camps: Pick<Camp, 'id' | 'name' | 'description'>[];
  loading: boolean;
  empty: string;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {loading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="px-4 py-3">
                <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : camps.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">{empty}</p>
        ) : (
          camps.map((c, i) => (
            <Link
              key={c.id}
              to={`/camps/${c.id}`}
              className={[
                'flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40',
                i < camps.length - 1 ? 'border-b border-border' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <Dumbbell
                className="h-4 w-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{c.name}</p>
                {c.description && (
                  <p className="truncate text-xs text-muted-foreground">
                    {c.description}
                  </p>
                )}
              </div>
              <ChevronRight
                className="h-4 w-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
            </Link>
          ))
        )}
      </div>
    </section>
  );
}
