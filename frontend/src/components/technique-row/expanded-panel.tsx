import { useTechniqueRow } from "./technique-row-context";
import { blocksFor, type BlockId } from "./block-visibility";
import { DescriptionBlock } from "./description-block";
import { TagsBlock } from "./tags-block";
import { LibraryStatsBlock } from "./library-stats-block";
import { VideosBlock } from "./videos-block";
import {
  AttemptsBlock,
  EditDefinitionBlock,
  HiddenToggleBlock,
  NotesCoachBlock,
  NotesStudentBlock,
  RemoveFromSyllabusBlock,
  VideoVisibilityOverrideBlock,
} from "./stub-blocks";

interface ExpandedPanelProps {
  scrollToVideoId?: number | null;
  onVideoScrolled?: () => void;
}

// Orchestrates the per-block render order based on BLOCK_VISIBILITY for
// (context.kind, role). Lives flush inside the AccordionContent so the
// expansion flows directly out of the header instead of stacking a
// second card. Block iteration order is the render order.
export function ExpandedPanel({
  scrollToVideoId,
  onVideoScrolled,
}: ExpandedPanelProps) {
  const { context, role } = useTechniqueRow();
  const blocks = blocksFor(context.kind, role);

  return (
    <div className="space-y-4">
      {blocks.map((id) => (
        <BlockRenderer
          key={id}
          id={id}
          scrollToVideoId={scrollToVideoId}
          onVideoScrolled={onVideoScrolled}
        />
      ))}
    </div>
  );
}

function BlockRenderer({
  id,
  scrollToVideoId,
  onVideoScrolled,
}: {
  id: BlockId;
  scrollToVideoId?: number | null;
  onVideoScrolled?: () => void;
}) {
  const { context, role } = useTechniqueRow();
  const isCoach = role === "coach" || role === "admin";
  const canManageVideos = context.kind === "global-library" && isCoach;

  switch (id) {
    case "description":
      return <DescriptionBlock editable={isCoach} />;
    case "tags":
      return <TagsBlock editable={isCoach} />;
    case "library-stats":
      return <LibraryStatsBlock />;
    case "videos":
      return (
        <VideosBlock
          canManage={canManageVideos}
          scrollToVideoId={scrollToVideoId}
          onVideoScrolled={onVideoScrolled}
        />
      );
    case "edit-definition":
      return <EditDefinitionBlock />;
    case "notes-student":
      return <NotesStudentBlock />;
    case "notes-coach":
      return <NotesCoachBlock />;
    case "attempts":
      return <AttemptsBlock />;
    case "remove-from-syllabus":
      return <RemoveFromSyllabusBlock />;
    case "hidden-toggle":
      return <HiddenToggleBlock />;
    case "video-visibility-override":
      return <VideoVisibilityOverrideBlock />;
  }
}
