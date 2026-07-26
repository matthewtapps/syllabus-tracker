import { Link, Navigate, useParams } from "react-router-dom";
import { isCoachOrAdmin } from "@/lib/api";
import { useUser } from "@/lib/current-user-context";
import { useCamp, useCampTechniques } from "@/lib/queries";
import { useListUrlState } from "@/lib/use-list-url-state";
import { TechniqueRowDetail } from "@/components/technique-row";

/**
 * A technique read inside a camp, on its own page.
 *
 * A camp OWNS its content: its page is the feed the content was posted into,
 * not a projection of content living elsewhere. So a camp technique tile can't
 * navigate "to the surface that owns it" the way a dashboard tile does, because
 * that surface is the camp page the reader is already on. It gets a page here
 * instead, and the discussion is scoped to `camp_technique` + this camp, never
 * the global-library conversation about the same technique.
 */
export default function CampTechniquePage() {
  const params = useParams<{ id: string; techniqueId: string }>();
  const campId = params.id ? parseInt(params.id, 10) : NaN;
  const techniqueId = params.techniqueId ? parseInt(params.techniqueId, 10) : NaN;

  if (!Number.isFinite(campId) || !Number.isFinite(techniqueId)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <CampTechniqueDetail campId={campId} techniqueId={techniqueId} />;
}

function CampTechniqueDetail({
  campId,
  techniqueId,
}: {
  campId: number;
  techniqueId: number;
}) {
  const viewer = useUser();
  const coach = isCoachOrAdmin(viewer);
  const campQuery = useCamp(campId);
  // The camp's own technique list, which the feed tiles read too, so arriving
  // here off a tile costs no extra fetch. It carries camp-scoped techniques the
  // library list omits.
  const techniquesQuery = useCampTechniques(campId);

  // `?video=` and `?t=` ride in from a feed tile: scroll to that clip in the
  // technique's video list and resume it where the feed player left off.
  const { videoId, resumeSeconds } = useListUrlState();

  const camp = campQuery.data;

  if (campQuery.isError) return <Navigate to="/dashboard" replace />;
  if (campQuery.isLoading || !camp) return <DetailSkeleton />;

  // Same rule the camp page enforces: the camp's own student, or any coach.
  if (viewer.id !== camp.student_id && !coach) {
    return <Navigate to="/dashboard" replace />;
  }

  if (techniquesQuery.isLoading) return <DetailSkeleton />;

  const technique = (techniquesQuery.data ?? []).find((t) => t.id === techniqueId);
  if (!technique) {
    return (
      <div className="container mx-auto space-y-3 px-4 py-6 sm:px-6 md:py-8">
        <h1 className="text-base font-semibold">Technique unavailable</h1>
        <p className="text-sm text-muted-foreground">
          This technique is not attached to this camp. It may have been removed.
        </p>
        <Link to={`/camps/${campId}`} className="text-sm text-primary underline">
          Back to {camp.name}
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-4 px-4 py-6 sm:px-6 md:py-8">
      <header className="space-y-1">
        <h1 className="text-base font-semibold">{technique.name}</h1>
        <p className="text-xs text-muted-foreground">{`In ${camp.name}`}</p>
      </header>
      <TechniqueRowDetail
        technique={technique}
        context={{ kind: "camp", campId, studentId: camp.student_id }}
        scrollToVideoId={videoId}
        resumeSeconds={resumeSeconds}
      />
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
      <div className="h-6 w-40 animate-pulse rounded bg-muted" />
    </div>
  );
}
