import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, ChevronUp } from 'lucide-react';
import type { FeedItem, LibraryTechniqueRow, User } from '@/lib/api';
import { LibraryTechniqueExpandedBody } from '@/components/library-technique-row';
import { formatRelative } from '@/lib/dates';
import { cn } from '@/lib/utils';

const STATUS_LABEL: Record<'red' | 'amber' | 'green', string> = {
  red: 'Needs work',
  amber: 'In progress',
  green: 'Solid',
};

const STATUS_DOT: Record<'red' | 'amber' | 'green', string> = {
  red: 'bg-status-red',
  amber: 'bg-status-amber',
  green: 'bg-status-green',
};

interface TechniqueSlimProps {
  item: Extract<FeedItem, { kind: 'technique' }>;
  studentId: number;
  /** Library data for this technique. When supplied, the card expands
   *  inline to show the full library expanded body (description, tags,
   *  pin, videos). Without it, the slim header is a link to the syllabus. */
  libraryRow?: LibraryTechniqueRow;
  user?: User;
}

export function TechniqueSlim({
  item,
  studentId,
  libraryRow,
  user,
}: TechniqueSlimProps) {
  const [expanded, setExpanded] = useState(false);
  const status = item.status as 'red' | 'amber' | 'green';
  const canExpandInline = !!libraryRow && !!user;
  const target = `/student/${studentId}/syllabus?focus=${item.technique_id}`;
  const snippet = activitySnippet(item, user);

  const header = (
    <div className="flex items-start gap-3">
      <span
        className={cn(
          'mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full',
          STATUS_DOT[status],
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="truncate text-sm font-medium">{item.title}</p>
        {snippet && (
          <p className="truncate text-xs text-foreground/80">{snippet}</p>
        )}
        <p className="truncate text-xs text-muted-foreground">
          {STATUS_LABEL[status]}
          {item.attempt_count > 0 && (
            <>
              {' · '}
              {item.attempt_count}{' '}
              {item.attempt_count === 1 ? 'attempt' : 'attempts'}
            </>
          )}
        </p>
      </div>
      {canExpandInline ? (
        expanded ? (
          <ChevronUp
            className="mt-1 h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
        ) : (
          <ChevronDown
            className="mt-1 h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
        )
      ) : (
        <ChevronRight
          className="mt-1 h-4 w-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
      )}
    </div>
  );

  if (!canExpandInline) {
    // Fallback: library data isn't loaded yet (e.g. user landed on /activity
    // before /library was warmed). Tap navigates to the syllabus, matching
    // the prior behaviour. The library fetch lives on the activity page so
    // a subsequent render lights up inline expansion.
    return (
      <Link
        to={target}
        className="-m-2 block rounded-md p-2 transition-colors hover:bg-muted/40"
      >
        {header}
      </Link>
    );
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="-m-2 w-full rounded-md p-2 text-left transition-colors hover:bg-muted/40"
      >
        {header}
      </button>
      {expanded && libraryRow && user && (
        <div className="-mx-4 border-t border-border/60 bg-muted/10">
          <LibraryTechniqueExpandedBody
            technique={libraryRow}
            canEdit={user.role === 'coach' || user.role === 'admin'}
            isStudentLike={
              user.role === 'student' || user.role === 'footage_submitter_student'
            }
            userId={user.id}
          />
        </div>
      )}
    </div>
  );
}

export function techniqueAccent(status: string): string {
  if (status === 'green') return 'border-l-status-green';
  if (status === 'amber') return 'border-l-status-amber';
  if (status === 'red') return 'border-l-status-red';
  return 'border-l-transparent';
}

/// Looks at the three activity timestamps on a technique feed item
/// (latest_attempt_at, last_coach_update_at, last_student_update_at) and
/// renders a short "what tripped this card" snippet for the viewer. Phrases
/// in the second person when the viewer is the owning student ("You logged
/// an attempt 2 hours ago"); in the third person for a coach viewing a
/// student ("Student logged an attempt 2 hours ago").
function activitySnippet(
  item: Extract<FeedItem, { kind: 'technique' }>,
  user?: User,
): string | null {
  const candidates: Array<{ at: string; label: (viewerIsOwner: boolean) => string }> = [];
  if (item.latest_attempt_at) {
    candidates.push({
      at: item.latest_attempt_at,
      label: (viewerIsOwner) =>
        viewerIsOwner ? 'You logged an attempt' : 'Student logged an attempt',
    });
  }
  if (item.last_coach_update_at) {
    candidates.push({
      at: item.last_coach_update_at,
      label: (viewerIsOwner) =>
        viewerIsOwner ? 'Coach updated this' : 'You updated this',
    });
  }
  if (item.last_student_update_at) {
    candidates.push({
      at: item.last_student_update_at,
      label: (viewerIsOwner) =>
        viewerIsOwner ? 'You updated your notes' : 'Student updated their notes',
    });
  }
  if (candidates.length === 0) return null;
  const latest = candidates.reduce((acc, c) =>
    c.at > acc.at ? c : acc,
  );
  // viewerIsOwner: did the viewer trigger or own this? Best-effort heuristic:
  // if the user is a coach/admin, the viewer is the coach observing a
  // student. Otherwise the viewer is the student themselves. The label
  // text is approximate when the actor (who actually did the action)
  // doesn't match this dichotomy, but for the M5b3 surface it's good enough.
  const viewerIsCoach =
    user?.role === 'coach' || user?.role === 'admin';
  const viewerIsOwner = !viewerIsCoach;
  return `${latest.label(viewerIsOwner)} ${formatRelative(latest.at)}`;
}
