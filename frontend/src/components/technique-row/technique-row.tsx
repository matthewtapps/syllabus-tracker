import { useMemo } from "react";
import type { LibraryTechniqueRow } from "@/lib/api";
import { useUser } from "@/lib/current-user-context";
import { ExpandedPanel } from "./expanded-panel";
import { Header } from "./header";
import {
  TechniqueRowContext,
  type RowContext,
} from "./technique-row-context";

interface TechniqueRowProps {
  technique: LibraryTechniqueRow;
  context: RowContext;
  expanded: boolean;
  onToggle: () => void;
  scrollToVideoId?: number | null;
  onVideoScrolled?: () => void;
}

// One row component for every surface (global library, student pinned,
// student syllabus). The internal compound context populates `role`,
// `viewerIsOwner`, and the discriminated row context once at the top so
// hot block lists do not re-subscribe to useUser() per row. The expanded
// panel is only mounted when `expanded` is true, so a long collapsed list
// doesn't kick off K * N data queries on initial mount.
export function TechniqueRow({
  technique,
  context,
  expanded,
  onToggle,
  scrollToVideoId,
  onVideoScrolled,
}: TechniqueRowProps) {
  const user = useUser();

  const viewerIsOwner = useMemo(() => {
    switch (context.kind) {
      case "global-library":
        // The role-based registry already restricts pin-button to students
        // in this surface; whoever is the viewer is the owner by default.
        return user.role === "student";
      case "student-pinned":
      case "student-syllabus":
        return user.id === context.studentId;
    }
  }, [context, user.id, user.role]);

  const value = useMemo(
    () => ({
      context,
      technique,
      role: user.role,
      viewerIsOwner,
    }),
    [context, technique, user.role, viewerIsOwner],
  );

  return (
    <TechniqueRowContext.Provider value={value}>
      <Header expanded={expanded} onToggle={onToggle} />
      {expanded && (
        <ExpandedPanel
          scrollToVideoId={scrollToVideoId}
          onVideoScrolled={onVideoScrolled}
        />
      )}
    </TechniqueRowContext.Provider>
  );
}
