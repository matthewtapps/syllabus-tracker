import { createContext, useContext } from "react";
import type { LibraryTechniqueRow, Role } from "@/lib/api";

// Discriminated context tells each row block which surface it's rendering
// in. Blocks read this via useTechniqueRow() instead of receiving each piece
// as a separate prop. The student-syllabus variant carries the assignment
// id so blocks can read assignment-level state (graduated_at, unassigned_at)
// without re-fetching. PR 1 ships the global-library and student-pinned
// variants; PR 3 fills out student-syllabus.
export type RowContext =
  | { kind: "global-library" }
  | { kind: "student-pinned"; studentId: number }
  | {
      kind: "student-syllabus";
      studentId: number;
      syllabusId: number;
      assignmentId: number;
    };

export interface TechniqueRowState {
  context: RowContext;
  technique: LibraryTechniqueRow;
  role: Role;
  // Precomputed at the top of the row. `viewerIsOwner` lets blocks tell
  // "this is the owning student looking at their own surface" from "a
  // coach previewing a student's surface" without re-reading useUser().
  viewerIsOwner: boolean;
}

export const TechniqueRowContext = createContext<TechniqueRowState | null>(
  null,
);

export function useTechniqueRow(): TechniqueRowState {
  const ctx = useContext(TechniqueRowContext);
  if (!ctx) {
    throw new Error(
      "useTechniqueRow() must be called inside a <TechniqueRow> compound.",
    );
  }
  return ctx;
}
