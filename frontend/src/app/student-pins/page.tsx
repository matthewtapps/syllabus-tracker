import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Pin } from 'lucide-react';
import { isCoachOrAdmin, type User } from '@/lib/api';
import {
  useLibraryTechniques,
  useStudentPins,
  useStudentTechniques,
} from '@/lib/queries';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { SkeletonListRow } from '@/components/skeleton-row';
import { LibraryTechniqueRow } from '@/components/library-technique-row';

interface PinsPageProps {
  user: User;
}

export default function PinsPage({ user }: PinsPageProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const studentId = id ? parseInt(id, 10) : user.id;
  const isOwnView = studentId === user.id;
  const canViewOthers = isCoachOrAdmin(user);

  const pinsQuery = useStudentPins(studentId);
  const libraryQuery = useLibraryTechniques();
  // Syllabus assignments give us status + attempts context for pins that
  // also sit on the student's syllabus. Coaches see this for any student;
  // students see their own.
  const studentTechniquesQuery = useStudentTechniques(studentId);

  const [expandedId, setExpandedId] = useState<number | null>(null);

  const pins = pinsQuery.data ?? [];
  const libraryById = useMemo(() => {
    const map = new Map<number, NonNullable<typeof libraryQuery.data>[number]>();
    (libraryQuery.data ?? []).forEach((t) => map.set(t.id, t));
    return map;
  }, [libraryQuery.data]);
  const syllabusByTechnique = useMemo(() => {
    const techniques = studentTechniquesQuery.data?.techniques ?? [];
    const map = new Map<number, (typeof techniques)[number]>();
    techniques.forEach((t) => map.set(t.technique_id, t));
    return map;
  }, [studentTechniquesQuery.data]);

  if (!isOwnView && !canViewOthers) {
    return (
      <div className="container mx-auto px-4 py-6">
        <p className="text-sm text-destructive">Not authorized.</p>
      </div>
    );
  }

  const studentName =
    studentTechniquesQuery.data?.student.display_name ??
    studentTechniquesQuery.data?.student.username ??
    `Student ${studentId}`;

  const loading = pinsQuery.isLoading || libraryQuery.isLoading;
  const error = pinsQuery.error || libraryQuery.error;

  return (
    <div className="container mx-auto max-w-3xl px-4 py-6 sm:px-6 md:py-8">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {isOwnView ? 'My pins' : `${studentName} · pins`}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isOwnView
              ? "Library techniques you've pinned to work on independent of any syllabus."
              : `Library techniques ${studentName} has pinned.`}
          </p>
        </div>
        {!isOwnView && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => navigate(`/student/${studentId}`)}
          >
            Profile
          </Button>
        )}
      </div>

      {loading ? (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonListRow key={i} />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-destructive">
          Failed to load pins.
        </div>
      ) : pins.length === 0 ? (
        <EmptyState
          icon={Pin}
          title={isOwnView ? 'Nothing pinned yet' : `${studentName} hasn't pinned anything yet`}
          description={
            isOwnView
              ? 'Open a technique in the library, then tap Pin to add it here. Pinned techniques carry their notes across the library, your syllabuses, and your pins.'
              : 'When the student pins techniques from the library, they show up here.'
          }
          action={
            isOwnView ? (
              <Button onClick={() => navigate('/library')}>
                <Pin className="mr-2 h-4 w-4" aria-hidden />
                Browse the library
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {pins.map((p) => {
            const libraryRow = libraryById.get(p.technique_id);
            const onSyllabus = syllabusByTechnique.get(p.technique_id);
            if (!libraryRow) {
              return (
                <li key={p.id} className="px-4 py-3">
                  <p className="text-sm font-medium">{p.technique_name}</p>
                </li>
              );
            }
            const badges = onSyllabus ? (
              <span className="inline-flex items-center gap-2 text-[11px] text-muted-foreground">
                <Badge variant="outline" className="px-1.5 py-0">
                  On syllabus
                </Badge>
                <span className="inline-flex items-center gap-1">
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${
                      onSyllabus.status === 'green'
                        ? 'bg-status-green'
                        : onSyllabus.status === 'amber'
                          ? 'bg-status-amber'
                          : 'bg-status-red'
                    }`}
                  />
                  {onSyllabus.status}
                </span>
                {onSyllabus.attempt_count > 0 && (
                  <span>
                    {onSyllabus.attempt_count}{' '}
                    {onSyllabus.attempt_count === 1 ? 'attempt' : 'attempts'}
                  </span>
                )}
                {onSyllabus.syllabus_name && (
                  <Link
                    to={`/student/${studentId}/technique/${onSyllabus.id}`}
                    className="underline-offset-2 hover:underline"
                  >
                    in {onSyllabus.syllabus_name}
                  </Link>
                )}
              </span>
            ) : null;
            return (
              <LibraryTechniqueRow
                key={p.id}
                technique={libraryRow}
                expanded={expandedId === libraryRow.id}
                onToggle={() =>
                  setExpandedId((prev) =>
                    prev === libraryRow.id ? null : libraryRow.id,
                  )
                }
                user={user}
                canEdit={false}
                badges={badges}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}
