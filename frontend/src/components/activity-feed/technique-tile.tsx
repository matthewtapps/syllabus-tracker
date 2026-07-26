import type { LibraryTechniqueRow } from "@/lib/api";
import { TechniqueRowTeaser } from "@/components/technique-row";
import { useUser } from "@/lib/current-user-context";
import { isCoachOrAdmin } from "@/lib/api";
import {
  useLibraryTechniques,
  useStudentLibrary,
  useStudentSyllabusTechniques,
  useThreadsForAnchor,
} from "@/lib/queries";
import { feedTileHref, rowToViewContext } from "@/lib/view-context";
import type { ActivityRow } from "@/lib/activity-line";
import type { FocusThread } from "@/lib/feed-item";
import { TeaserLine, TeaserRegion, ViewAllLine } from "./teaser-line";
import { TileShell, TileSkeleton } from "./tile-shell";
import { toLibraryShape } from "./to-library-shape";
import type { RowContext } from "@/components/technique-row/technique-row-context";

/**
 * The technique teaser tile for a feed entry. Hydrates from the same cached
 * list queries the native surfaces use, so TanStack Query dedups across the
 * feed (a feed referencing three syllabi fires three fetches, not one per row)
 * and a tile never drifts from its real surface. Returns null while no entity
 * resolves, so the entry falls back to a header-only line.
 *
 * Both tap targets navigate to the technique in its surface, the same
 * destination the row's breadcrumb links to. The row never expands here.
 */
export function TechniqueTile({
  row,
  focusThread,
}: {
  row: ActivityRow;
  /** The thread the feed event is about, when it is a comment. Adds a comment
   *  teaser that lands on that thread. */
  focusThread: FocusThread | null;
}) {
  const ctx = rowToViewContext(row);
  const href = feedTileHref(ctx, row.technique_id);
  // Nothing addressable to send the viewer to: fall back to the header line
  // rather than render a tile that goes nowhere.
  if (href == null) return null;
  // Only a per-student syllabus context (with an sst row) renders the student's
  // technique row. Gym-template edits carry a syllabus context without a
  // student/sst, so they fall through to the library row below.
  if (ctx?.kind === "syllabus" && ctx.student && ctx.sst) {
    return (
      <SyllabusTile
        studentId={ctx.student.id}
        syllabusId={ctx.syllabus.id}
        sstId={ctx.sst.id}
        href={href}
        focusThread={focusThread}
      />
    );
  }
  // A camp_technique feed row: the technique belongs to this camp, so the row
  // must carry camp context or its discussion would open the global-library
  // conversation instead of the camp-scoped one.
  if (ctx?.kind === "camp" && row.technique_id != null && row.target_student_id != null) {
    return (
      <CampTechniqueTile
        techniqueId={row.technique_id}
        campId={ctx.camp.id}
        studentId={row.target_student_id}
        href={href}
        focusThread={focusThread}
      />
    );
  }
  // A library context, and equally the fallback for technique-anchored verbs the
  // deep-link resolver models no surface for (pins, technique edits, syllabus
  // add/remove, visibility, a camp technique-add): honor the technique tile with
  // the library row.
  if (row.technique_id != null) {
    return (
      <LibraryTile techniqueId={row.technique_id} href={href} focusThread={focusThread} />
    );
  }
  return null;
}

function SyllabusTile({
  studentId,
  syllabusId,
  sstId,
  href,
  focusThread,
}: {
  studentId: number;
  syllabusId: number;
  sstId: number;
  href: string;
  focusThread: FocusThread | null;
}) {
  const query = useStudentSyllabusTechniques(studentId, syllabusId);
  if (query.isLoading) return <TileSkeleton />;
  const assignment = query.data?.assignment;
  const sst = query.data?.techniques.find((s) => s.id === sstId);
  if (!sst || !assignment) return null;
  return (
    <TeaserTile
      technique={toLibraryShape(sst)}
      context={{
        kind: "student-syllabus",
        studentId,
        syllabusId,
        syllabusName: assignment.syllabus_name,
        assignmentId: assignment.id,
        sst,
        graduatedAt: assignment.graduated_at,
      }}
      href={href}
      focusThread={focusThread}
    />
  );
}

function LibraryTile({
  techniqueId,
  href,
  focusThread,
}: {
  techniqueId: number;
  href: string;
  focusThread: FocusThread | null;
}) {
  const user = useUser();
  const coach = isCoachOrAdmin(user);
  // A coach reads the full library; a student reads their own (carries the
  // right is_pinned). Only one of the two queries is enabled at a time.
  const coachLib = useLibraryTechniques();
  const studentLib = useStudentLibrary(coach ? undefined : user.id);
  const lib = coach ? coachLib : studentLib;
  if (lib.isLoading) return <TileSkeleton />;
  const technique = (lib.data ?? []).find((t) => t.id === techniqueId);
  if (!technique) return null;
  return (
    <TeaserTile
      technique={technique}
      context={{ kind: "global-library" }}
      href={href}
      focusThread={focusThread}
    />
  );
}

/**
 * A technique card in camp context. Hydrates from the same shared library list
 * query LibraryTile uses, so the two share a cache entry; only the row context
 * differs, which is what scopes the discussion to the camp.
 */
function CampTechniqueTile({
  techniqueId,
  campId,
  studentId,
  href,
  focusThread,
}: {
  techniqueId: number;
  campId: number;
  studentId: number;
  href: string;
  focusThread: FocusThread | null;
}) {
  const user = useUser();
  const coach = isCoachOrAdmin(user);
  const coachLib = useLibraryTechniques();
  const studentLib = useStudentLibrary(coach ? undefined : user.id);
  const lib = coach ? coachLib : studentLib;
  if (lib.isLoading) return <TileSkeleton />;
  const technique = (lib.data ?? []).find((t) => t.id === techniqueId);
  if (!technique) return null;
  return (
    <TeaserTile
      technique={technique}
      context={{ kind: "camp", campId, studentId }}
      href={href}
      focusThread={focusThread}
      campId={campId}
    />
  );
}

function TeaserTile({
  technique,
  context,
  href,
  focusThread,
  campId,
}: {
  technique: LibraryTechniqueRow;
  context: RowContext;
  href: string;
  focusThread: FocusThread | null;
  /** Camp scope for a camp_technique thread, so the teaser reads the
   *  camp-scoped thread list rather than the global-library one. */
  campId?: number;
}) {
  return (
    <TileShell>
      <TechniqueRowTeaser technique={technique} context={context} href={href} />
      {focusThread && (
        <CommentTeaser focusThread={focusThread} href={href} campId={campId} />
      )}
    </TileShell>
  );
}

/** The focus thread previewed under the row. Same destination, landing on it. */
function CommentTeaser({
  focusThread,
  href,
  campId,
}: {
  focusThread: FocusThread;
  href: string;
  campId?: number;
}) {
  const query = useThreadsForAnchor(focusThread.anchorKind, focusThread.anchorId, campId);
  const thread = (query.data ?? []).find((t) => t.id === focusThread.threadId);
  // Still hydrating, or the thread is gone: the row alone reaches the technique,
  // so there is no dead end and no skeleton flashing under a live row.
  if (!thread) return null;
  const total = 1 + thread.comments.length;
  const threadHref = `${href}${href.includes("?") ? "&" : "?"}thread=${focusThread.threadId}`;
  return (
    <TeaserRegion href={threadHref} className="border-t border-border">
      <TeaserLine
        authorId={thread.author_id}
        authorName={thread.author_name}
        createdAt={thread.created_at}
        body={thread.body}
        tsSeconds={thread.video_ts_seconds}
        fallback="video post"
      />
      {total > 1 && <ViewAllLine count={total} noun="comment" />}
    </TeaserRegion>
  );
}
