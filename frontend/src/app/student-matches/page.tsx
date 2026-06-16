import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { Trophy } from "lucide-react";
import { useUser } from "@/lib/current-user-context";
import { isCoachOrAdmin } from "@/lib/api";
import { useAllUsers, useMatchVideos, useStudentMatches } from "@/lib/queries";
import { parseFocusToken } from "@/lib/entity-ref";
import type { MatchResult, MatchMethod, StudentMatch, Video } from "@/lib/api";
import { VideoRow } from "@/components/videos/video-row";
import { VideoPlayerDialog } from "@/components/videos/video-player-dialog";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// ResultBadge (replicated from camp detail; extraction kept minimal to avoid
// breaking the camp page during this task -- see task notes).
// ---------------------------------------------------------------------------

function ResultBadge({ result }: { result: MatchResult }) {
  const map: Record<MatchResult, { label: string; cls: string }> = {
    win: {
      label: "W",
      cls: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
    },
    loss: {
      label: "L",
      cls: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    },
    draw: {
      label: "D",
      cls: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
    },
  };
  const { label, cls } = map[result];
  return (
    <span
      className={cn(
        "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
        cls,
      )}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// MatchVideoList: video list for a single match (playback only, no upload).
// ---------------------------------------------------------------------------

function MatchVideoList({
  matchId,
  studentId,
}: {
  matchId: number;
  studentId: number;
}) {
  const videosQuery = useMatchVideos(matchId);
  const videos = videosQuery.data ?? [];
  const [playing, setPlaying] = useState<Video | null>(null);

  if (videosQuery.isLoading) {
    return (
      <div className="h-3 w-1/4 animate-pulse rounded bg-muted" />
    );
  }

  if (videos.length === 0) {
    return null;
  }

  return (
    <>
      <ul className="divide-y divide-white/15 overflow-hidden rounded-md border border-white/20 bg-card shadow-sm">
        {videos.map((v) => (
          <VideoRow
            key={v.id}
            video={v}
            techniqueId={0}
            canManage={false}
            onPlay={() => setPlaying(v)}
            onDeleted={() => {
              videosQuery.refetch();
            }}
          />
        ))}
      </ul>
      <VideoPlayerDialog
        video={playing}
        onClose={() => setPlaying(null)}
        surface={{ kind: "student", studentId }}
        context={{ label: "Match video" }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// MatchCard
// ---------------------------------------------------------------------------

const methodLabel: Record<string, string> = {
  submission: "Sub",
  points: "Points",
  decision: "Decision",
  dq: "DQ",
  other: "Other",
};

function MatchCard({
  match,
  studentId,
  highlighted,
  cardRef,
}: {
  match: StudentMatch;
  studentId: number;
  highlighted: boolean;
  cardRef?: React.Ref<HTMLDivElement>;
}) {
  const method = match.method as MatchMethod | null;

  return (
    <div
      ref={cardRef}
      id={`match-${match.id}`}
      className={cn(
        "rounded-lg border border-border bg-card p-4 space-y-3 transition-colors",
        highlighted && "ring-2 ring-ring/50 bg-muted/60",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <ResultBadge result={match.result} />
          {method && (
            <span className="text-xs text-muted-foreground">
              {methodLabel[method] ?? method}
              {match.method_detail ? ` (${match.method_detail})` : ""}
            </span>
          )}
          {match.occurred_at && (
            <span className="text-xs text-muted-foreground">
              {match.occurred_at}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Trophy className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>{match.competition_name}</span>
        {match.camp_id != null && (
          <>
            <span aria-hidden>·</span>
            <Link
              to={`/camps/${match.camp_id}`}
              className="underline underline-offset-2 hover:text-foreground"
            >
              View camp
            </Link>
          </>
        )}
      </div>

      <MatchVideoList matchId={match.id} studentId={studentId} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// MatchesListing
// ---------------------------------------------------------------------------

function MatchesListing({
  studentId,
  isOwnView,
}: {
  studentId: number;
  isOwnView: boolean;
}) {
  const matchesQuery = useStudentMatches(studentId);
  const matches = matchesQuery.data ?? [];

  // Sort reverse-chronological: matches with occurred_at first by date desc,
  // then those without a date by created_at desc.
  const sorted = [...matches].sort((a, b) => {
    const dateA = a.occurred_at ?? a.created_at;
    const dateB = b.occurred_at ?? b.created_at;
    return dateB.localeCompare(dateA);
  });

  // Coach heading: resolve the student name.
  const usersQuery = useAllUsers();
  const student = isOwnView
    ? undefined
    : (usersQuery.data ?? []).find((u) => u.id === studentId);
  const studentName = student?.display_name || student?.username;

  // ?focus=match:<id> -- scroll to and highlight the target card.
  const [searchParams, setSearchParams] = useSearchParams();
  const focusRef = parseFocusToken(searchParams.get("focus"));
  const targetMatchId =
    focusRef?.type === "match" ? focusRef.id : null;
  const [highlightId, setHighlightId] = useState<number | null>(
    targetMatchId,
  );
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const focusConsumed = useRef(false);

  useEffect(() => {
    if (
      focusConsumed.current ||
      targetMatchId == null ||
      matchesQuery.isLoading
    )
      return;
    const el = cardRefs.current.get(targetMatchId);
    if (!el) return;
    focusConsumed.current = true;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightId(targetMatchId);
    const timer = setTimeout(() => setHighlightId(null), 2200);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("focus");
        return next;
      },
      { replace: true },
    );
    return () => clearTimeout(timer);
  }, [targetMatchId, matchesQuery.isLoading, setSearchParams]);

  return (
    <div className="container mx-auto space-y-6 px-4 py-6 sm:px-6 md:py-8">
      <h1 className="text-base font-semibold">
        {isOwnView
          ? "My matches"
          : studentName
            ? `${studentName}'s matches`
            : "Matches"}
      </h1>

      {matchesQuery.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-lg bg-muted"
            />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">No matches recorded yet.</p>
      ) : (
        <div className="space-y-3">
          {sorted.map((m) => (
            <MatchCard
              key={m.id}
              match={m}
              studentId={studentId}
              highlighted={highlightId === m.id}
              cardRef={(el) => {
                if (el) cardRefs.current.set(m.id, el);
                else cardRefs.current.delete(m.id);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page root
// ---------------------------------------------------------------------------

export default function StudentMatchesPage() {
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

  return <MatchesListing studentId={studentId} isOwnView={isOwner} />;
}
