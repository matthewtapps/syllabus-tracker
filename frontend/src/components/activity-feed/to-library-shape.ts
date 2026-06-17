import type { LibraryTechniqueRow, SstRow } from "@/lib/api";

/** Adapt an SstRow to the LibraryTechniqueRow shape the technique-row blocks
 *  expect. The SST carries the technique fields under different keys, so we
 *  adapt at the surface boundary. Shared by the student-syllabus page and the
 *  activity feed tiles so both surfaces agree on the mapping. */
export function toLibraryShape(sst: SstRow): LibraryTechniqueRow {
  return {
    id: sst.technique_id,
    name: sst.technique_name,
    description: sst.technique_description,
    tags: sst.tags,
    collection_ids: [],
    collection_count: 0,
    student_count: 0,
    video_count: sst.video_count,
    last_activity_at: sst.last_attempt_at,
    is_pinned: false,
  };
}
