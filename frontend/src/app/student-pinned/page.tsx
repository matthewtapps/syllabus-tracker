import { useMemo, useState } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { Pin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { TechniqueRow } from '@/components/technique-row';
import { useStudentPinnedTechniques } from '@/lib/queries';
import { useUser } from '@/lib/current-user-context';
import { isCoachOrAdmin } from '@/lib/api';

export default function StudentPinnedPage() {
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

  return <PinnedListing studentId={studentId} isOwnView={isOwner} />;
}

function PinnedListing({
  studentId,
  isOwnView,
}: {
  studentId: number;
  isOwnView: boolean;
}) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const query = useStudentPinnedTechniques(studentId);
  const techniques = useMemo(() => query.data ?? [], [query.data]);
  const loading = query.isLoading;
  const error = query.error ? 'Failed to load pinned techniques.' : null;

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
      <div className="mb-4 flex items-end justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-base font-semibold">
            <Pin className="h-4 w-4" aria-hidden />
            {isOwnView ? 'My pinned techniques' : 'Pinned techniques'}
          </h1>
          <p className="text-xs text-muted-foreground">
            {isOwnView
              ? 'Quick access to techniques you have pinned from the library.'
              : 'Techniques this student has pinned from the library.'}
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {loading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="px-4 py-4">
                <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
                <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Try again
            </Button>
          </div>
        ) : techniques.length === 0 ? (
          <EmptyState
            icon={Pin}
            title="No pins yet"
            description={
              isOwnView
                ? 'Pin techniques from the library to keep them within reach.'
                : 'This student has not pinned anything from the library yet.'
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {techniques.map((t) => {
              const expanded = expandedId === t.id;
              return (
                <li key={t.id}>
                  <TechniqueRow
                    technique={t}
                    context={{ kind: 'student-pinned', studentId }}
                    expanded={expanded}
                    onToggle={() =>
                      setExpandedId((prev) => (prev === t.id ? null : t.id))
                    }
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
