import { useState } from "react";
import { Check, Plus } from "lucide-react";
import {
  addTagToTechnique,
  createTag,
  getAllTags,
  type Tag,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface TagsEditorProps {
  techniqueId: number;
  assignedTags: Tag[];
  allTags: Tag[];
  onTagAdded: (tag: Tag, allTagsAfter: Tag[]) => void;
}

export function TagsEditor({
  techniqueId,
  assignedTags,
  allTags,
  onTagAdded,
}: TagsEditorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);

  const assignedIds = new Set(assignedTags.map((t) => t.id));
  const availableTags = allTags.filter((t) => !assignedIds.has(t.id));

  const trimmed = search.trim();
  const lowerTrimmed = trimmed.toLowerCase();
  const exactMatch = allTags.find(
    (t) => t.name.toLowerCase() === lowerTrimmed,
  );
  const canCreate = !!trimmed && !exactMatch;

  async function handleSelectExisting(tag: Tag) {
    setBusy(true);
    try {
      const response = await addTagToTechnique(techniqueId, tag.id);
      if (!response.ok) return;
      onTagAdded(tag, allTags);
      setSearch("");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate() {
    if (!trimmed) return;
    setBusy(true);
    try {
      const createResponse = await createTag(trimmed);
      if (!createResponse.ok) return;
      const refreshed = await getAllTags();
      const newTag = refreshed.find(
        (t) => t.name.toLowerCase() === lowerTrimmed,
      );
      if (!newTag) return;
      const addResponse = await addTagToTechnique(techniqueId, newTag.id);
      if (!addResponse.ok) return;
      onTagAdded(newTag, refreshed);
      setSearch("");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            "h-7 gap-1 px-2 text-xs",
            "border-dashed border-border text-muted-foreground hover:text-foreground",
          )}
          onClick={(e) => e.stopPropagation()}
          disabled={busy}
        >
          <Plus className="h-3 w-3" aria-hidden />
          Add tag
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-64 p-0"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Find or create a tag..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {availableTags.length === 0 && !canCreate && (
              <CommandEmpty>No matching tags.</CommandEmpty>
            )}
            {availableTags.length > 0 && (
              <CommandGroup heading="Existing tags">
                {availableTags
                  .filter((t) =>
                    !lowerTrimmed || t.name.toLowerCase().includes(lowerTrimmed),
                  )
                  .slice(0, 20)
                  .map((tag) => (
                    <CommandItem
                      key={tag.id}
                      value={tag.name}
                      onSelect={() => handleSelectExisting(tag)}
                    >
                      <Check className="mr-2 h-3.5 w-3.5 opacity-0" aria-hidden />
                      {tag.name}
                    </CommandItem>
                  ))}
              </CommandGroup>
            )}
            {canCreate && (
              <CommandGroup heading="Create">
                <CommandItem
                  value={`__create_${trimmed}`}
                  onSelect={handleCreate}
                >
                  <Plus className="mr-2 h-3.5 w-3.5" aria-hidden />
                  Create "{trimmed}"
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
