import type { Role } from "@/lib/api";
import type { RowContext } from "./technique-row-context";

// Stable ids for each block the expanded panel can render. Adding a new
// block means adding an entry here and a case to expanded-panel.tsx. The
// pin button is NOT a body block; it's rendered inline in the row header
// so it's reachable without expanding the row.
export type BlockId =
  | "description"
  | "tags"
  | "library-stats"
  | "videos"
  | "status"
  | "edit-definition"
  | "notes-student"
  | "notes-coach"
  | "attempts"
  | "remove-from-syllabus"
  | "hidden-toggle"
  | "video-visibility-override";

export type RowKind = RowContext["kind"];

// Each cell lists the blocks that should mount for that (surface, role)
// combination. `satisfies` forces every (kind, role) cell to be populated;
// adding a new RowKind or Role will fail to compile until it's covered.
// PR 1 ships global-library and student-pinned fully; PR 3+ wire up the
// student-syllabus blocks that are currently listed but rendered as stubs.
export const BLOCK_VISIBILITY = {
  "global-library": {
    student: ["description", "tags", "videos"],
    coach: ["description", "tags", "library-stats", "videos", "edit-definition"],
    admin: ["description", "tags", "library-stats", "videos", "edit-definition"],
  },
  "student-pinned": {
    student: ["description", "tags", "videos"],
    coach: ["description", "tags", "videos"],
    admin: ["description", "tags", "videos"],
  },
  "student-syllabus": {
    student: [
      "status",
      "description",
      "tags",
      "attempts",
      "notes-student",
      "notes-coach",
      "videos",
    ],
    coach: [
      "status",
      "description",
      "tags",
      "attempts",
      "notes-student",
      "notes-coach",
      "videos",
      "edit-definition",
      "remove-from-syllabus",
      "hidden-toggle",
      "video-visibility-override",
    ],
    admin: [
      "status",
      "description",
      "tags",
      "attempts",
      "notes-student",
      "notes-coach",
      "videos",
      "edit-definition",
      "remove-from-syllabus",
      "hidden-toggle",
      "video-visibility-override",
    ],
  },
} as const satisfies Record<RowKind, Record<Role, readonly BlockId[]>>;

export function blocksFor(kind: RowKind, role: Role): readonly BlockId[] {
  return BLOCK_VISIBILITY[kind][role];
}
