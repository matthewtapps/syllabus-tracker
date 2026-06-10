import { useEffect, useState } from "react";
import { X as XIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TagsEditor } from "@/components/tags-editor";
import { useAllTags } from "@/lib/queries";
import { useRemoveTagFromTechnique } from "@/lib/mutations";
import type { Tag } from "@/lib/api";
import { useTechniqueRow } from "./technique-row-context";

interface TagsBlockProps {
  editable: boolean;
}

// Inline chip strip. Sits flush with the description block above and the
// next section below; no heading row, so the expanded panel reads as a
// single flowing card rather than a stack of nested sections.
export function TagsBlock({ editable }: TagsBlockProps) {
  const { technique } = useTechniqueRow();
  const removeTagMutation = useRemoveTagFromTechnique();
  const allTagsQuery = useAllTags();
  const allTags = allTagsQuery.data ?? [];

  // Local copy so add/remove feels instant. Re-seeded whenever the
  // technique itself changes (different row expansion).
  const [localTags, setLocalTags] = useState<Tag[]>(technique.tags);
  useEffect(() => {
    setLocalTags(technique.tags);
  }, [technique.tags]);

  async function handleRemoveTag(tag: Tag) {
    setLocalTags((prev) => prev.filter((t) => t.id !== tag.id));
    try {
      await removeTagMutation.mutateAsync({
        techniqueId: technique.id,
        tagId: tag.id,
      });
    } catch (err) {
      console.error(err);
      toast.error("Failed to remove tag");
      setLocalTags((prev) =>
        [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)),
      );
    }
  }

  function handleTagAdded(tag: Tag) {
    setLocalTags((prev) =>
      [...prev.filter((t) => t.id !== tag.id), tag].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    );
  }

  if (!editable && localTags.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {localTags.map((tag) =>
        editable ? (
          <Badge
            key={tag.id}
            variant="secondary"
            className="gap-1 pr-1 text-xs"
          >
            {tag.name}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-4 w-4 rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
              onClick={() => handleRemoveTag(tag)}
            >
              <XIcon className="h-3 w-3" aria-hidden />
              <span className="sr-only">Remove {tag.name}</span>
            </Button>
          </Badge>
        ) : (
          <Badge key={tag.id} variant="secondary" className="text-xs">
            {tag.name}
          </Badge>
        ),
      )}
      {editable && (
        <TagsEditor
          techniqueId={technique.id}
          assignedTags={localTags}
          allTags={allTags}
          onTagAdded={handleTagAdded}
        />
      )}
    </div>
  );
}
