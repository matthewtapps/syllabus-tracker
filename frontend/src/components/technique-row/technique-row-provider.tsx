import { useMemo } from "react";
import type { LibraryTechniqueRow } from "@/lib/api";
import { useUser } from "@/lib/current-user-context";
import { TechniqueRowContext, type RowContext } from "./technique-row-context";

// Private to this folder. Every row wrapper (TechniqueRow, TechniqueRowTeaser,
// TechniqueRowDetail) mounts this, so the `viewerIsOwner` derivation and the
// useUser() subscription have exactly one definition. Blocks then read the
// whole compound state via useTechniqueRow(), and a hot list of rows does not
// re-subscribe to useUser() per block.
export function TechniqueRowProvider({
  technique,
  context,
  children,
}: {
  technique: LibraryTechniqueRow;
  context: RowContext;
  children: React.ReactNode;
}) {
  const user = useUser();

  const viewerIsOwner = useMemo(() => {
    switch (context.kind) {
      case "global-library":
        return user.role === "student";
      case "student-pinned":
      case "student-syllabus":
        return user.id === context.studentId;
      case "syllabus-management":
        // Coach surface; no "owning student" concept applies.
        return false;
      case "camp":
        return user.id === context.studentId;
    }
  }, [context, user.id, user.role]);

  const value = useMemo(
    () => ({ context, technique, role: user.role, viewerIsOwner }),
    [context, technique, user.role, viewerIsOwner],
  );

  return (
    <TechniqueRowContext.Provider value={value}>
      {children}
    </TechniqueRowContext.Provider>
  );
}
