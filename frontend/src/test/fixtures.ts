import type { LibraryTechniqueRow, SstRow } from "@/lib/api";

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

export function buildSst(overrides: Partial<SstRow> = {}): SstRow {
  return {
    id: 901,
    assignment_id: 501,
    technique_id: 101,
    technique_name: "Armbar",
    technique_description: "A simple armbar from guard.",
    status: "red",
    student_notes: "",
    coach_notes: "",
    hidden_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_coach_update_at: null,
    last_coach_update_by_id: null,
    last_student_update_at: null,
    last_student_update_by_id: null,
    tags: [],
    attempt_count: 0,
    last_attempt_at: null,
    video_count: 0,
    ...overrides,
  };
}
