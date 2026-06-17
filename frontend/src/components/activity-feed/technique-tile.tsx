import { useState } from "react";
import { Accordion } from "@/components/ui/accordion";
import { TechniqueRow } from "@/components/technique-row";
import { useUser } from "@/lib/current-user-context";
import { isCoachOrAdmin } from "@/lib/api";
import {
  useLibraryTechniques,
  useStudentLibrary,
  useStudentSyllabusTechniques,
} from "@/lib/queries";
import { rowToViewContext } from "@/lib/view-context";
import type { ActivityRow } from "@/lib/activity-line";
import { toLibraryShape } from "./to-library-shape";

/**
 * The embedded technique row for a feed entry. Hydrates from the same cached
 * list queries the native surfaces use, so TanStack Query dedups across the
 * feed (a feed referencing three syllabi fires three fetches, not one per row)
 * and a tile never drifts from its real surface. Returns null while no entity
 * resolves, so the entry falls back to a header-only line.
 */
export function TechniqueTile({ row }: { row: ActivityRow }) {
  const ctx = rowToViewContext(row);
  if (ctx?.kind === "syllabus") {
    return (
      <SyllabusTile
        row={row}
        studentId={ctx.student.id}
        syllabusId={ctx.syllabus.id}
        sstId={ctx.sst.id}
      />
    );
  }
  if (ctx?.kind === "library" && row.technique_id != null) {
    return <LibraryTile techniqueId={row.technique_id} videoId={row.video_id} />;
  }
  return null;
}

function TileShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-3 mb-3 overflow-hidden rounded-md border border-border bg-card">
      {children}
    </div>
  );
}

function SyllabusTile({
  row,
  studentId,
  syllabusId,
  sstId,
}: {
  row: ActivityRow;
  studentId: number;
  syllabusId: number;
  sstId: number;
}) {
  const query = useStudentSyllabusTechniques(studentId, syllabusId);
  const [open, setOpen] = useState<string>("");
  if (query.isLoading) return <TileSkeleton />;
  const assignment = query.data?.assignment;
  const sst = query.data?.techniques.find((s) => s.id === sstId);
  if (!sst || !assignment) return null;
  const value = `sst-${sst.id}`;
  return (
    <TileShell>
      <Accordion type="single" collapsible value={open} onValueChange={setOpen}>
        <TechniqueRow
          embedded
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
          value={value}
          isOpen={open === value}
          scrollToVideoId={open === value ? row.video_id : null}
        />
      </Accordion>
    </TileShell>
  );
}

function LibraryTile({
  techniqueId,
  videoId,
}: {
  techniqueId: number;
  videoId: number | null;
}) {
  const user = useUser();
  const coach = isCoachOrAdmin(user);
  // A coach reads the full library; a student reads their own (carries the
  // right is_pinned). Only one of the two queries is enabled at a time.
  const coachLib = useLibraryTechniques();
  const studentLib = useStudentLibrary(coach ? undefined : user.id);
  const [open, setOpen] = useState<string>("");
  const lib = coach ? coachLib : studentLib;
  if (lib.isLoading) return <TileSkeleton />;
  const technique = (lib.data ?? []).find((t) => t.id === techniqueId);
  if (!technique) return null;
  const value = `tech-${technique.id}`;
  return (
    <TileShell>
      <Accordion type="single" collapsible value={open} onValueChange={setOpen}>
        <TechniqueRow
          embedded
          technique={technique}
          context={{ kind: "global-library" }}
          value={value}
          isOpen={open === value}
          scrollToVideoId={open === value ? videoId : null}
        />
      </Accordion>
    </TileShell>
  );
}

/** Fixed-height placeholder while a tile hydrates, so async hydration never
 *  shifts the feed (CLS = 0). Shared by the comment tile. */
export function TileSkeleton() {
  return (
    <div className="mx-3 mb-3 rounded-md border border-border bg-card px-4 py-3">
      <div className="h-4 w-2/5 animate-pulse rounded bg-muted" />
      <div className="mt-2 h-3 w-1/4 animate-pulse rounded bg-muted" />
    </div>
  );
}
