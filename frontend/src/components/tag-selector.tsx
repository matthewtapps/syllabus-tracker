import { useState, useEffect, useRef } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { getAllTags, createTag, type Tag } from "@/lib/api";
import { toast } from "sonner";

interface TagSelectorProps {
  onTagSelect: (tag: Tag) => void;
  existingTags: Tag[];
  className?: string;
}

export function TagSelector({
  onTagSelect,
  existingTags,
  className,
}: TagSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [filteredTags, setFilteredTags] = useState<Tag[]>([]);
  const [filterText, setFilterText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load all available tags
  useEffect(() => {
    const loadTags = async () => {
      try {
        setIsLoading(true);
        const tags = await getAllTags();
        setAllTags(tags);
      } catch (err) {
        console.error("Failed to load tags", err);
        toast.error("Failed to load tags");
      } finally {
        setIsLoading(false);
      }
    };

    if (isOpen) {
      loadTags();
    }
  }, [isOpen]);

  // Filter tags based on input
  useEffect(() => {
    if (!filterText) {
      setFilteredTags(allTags);
      return;
    }

    const filtered = allTags.filter(tag =>
      tag.name.toLowerCase().includes(filterText.toLowerCase())
    );
    setFilteredTags(filtered);
  }, [allTags, filterText]);

  // Focus input when popover opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  const handleCreateTag = async () => {
    // Don't create empty tags
    if (!filterText.trim()) return;

    // Check if tag already exists
    if (allTags.some(tag => tag.name.toLowerCase() === filterText.toLowerCase())) {
      const existingTag = allTags.find(tag =>
        tag.name.toLowerCase() === filterText.toLowerCase()
      );
      if (existingTag) onTagSelect(existingTag);
      setIsOpen(false);
      setFilterText("");
      return;
    }

    try {
      setIsCreating(true);
      await createTag(filterText);

      // Reload tags to get the new one with its ID
      const updatedTags = await getAllTags();
      setAllTags(updatedTags);

      // Find and select the newly created tag
      const newTag = updatedTags.find(tag =>
        tag.name.toLowerCase() === filterText.toLowerCase()
      );

      if (newTag) {
        onTagSelect(newTag);
        toast.success(`Tag "${newTag.name}" created`);
      }

      setIsOpen(false);
      setFilterText("");
    } catch (err) {
      console.error("Failed to create tag", err);
      toast.error("Failed to create tag");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("gap-1.5", className)}
        >
          <Plus className="h-3.5 w-3.5" />
          Add Tag
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2">
        <div className="space-y-2">
          <div className="relative">
            <Input
              ref={inputRef}
              placeholder="Search or create tag..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="pr-8"
            />
            {filterText && (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 absolute right-1 top-1"
                onClick={() => setFilterText("")}
              >
                <X className="h-3 w-3" />
                <span className="sr-only">Clear</span>
              </Button>
            )}
          </div>

          <div className="max-h-40 overflow-y-auto space-y-1 py-1">
            {isLoading ? (
              <div className="text-center py-2 text-sm text-muted-foreground">
                Loading tags...
              </div>
            ) : filteredTags.length > 0 ? (
              filteredTags.map(tag => {
                const isExisting = existingTags.some(t => t.id === tag.id);
                return (
                  <Button
                    key={tag.id}
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      isExisting && "opacity-50 pointer-events-none"
                    )}
                    disabled={isExisting}
                    onClick={() => {
                      onTagSelect(tag);
                      setIsOpen(false);
                      setFilterText("");
                    }}
                  >
                    {tag.name}
                    {isExisting && <span className="ml-auto text-xs text-muted-foreground">(Already added)</span>}
                  </Button>
                );
              })
            ) : filterText ? (
              <div className="space-y-2 p-2">
                <p className="text-sm text-muted-foreground">
                  No matching tags found.
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full"
                  onClick={handleCreateTag}
                  disabled={isCreating}
                >
                  {isCreating ? "Creating..." : `Create "${filterText}"`}
                </Button>
              </div>
            ) : (
              <div className="text-center py-2 text-sm text-muted-foreground">
                No tags available
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
