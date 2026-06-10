import type { LibraryTechniqueRow } from "@/lib/api";

export function buildTechnique(
  overrides: Partial<LibraryTechniqueRow> = {},
): LibraryTechniqueRow {
  return {
    id: 101,
    name: "Armbar",
    description: "A simple armbar from guard.",
    tags: [],
    collection_ids: [],
    collection_count: 0,
    student_count: 0,
    video_count: 0,
    last_activity_at: null,
    is_pinned: false,
    ...overrides,
  };
}
