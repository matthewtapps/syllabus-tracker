import { Search, X as XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface TechniqueFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  availableTags: string[];
  activeTags: string[];
  onToggleTag: (tag: string) => void;
  onClearTags: () => void;
}

/** Shared search box + tag filter row for the technique list pages. */
export function TechniqueFilters({
  search,
  onSearchChange,
  searchPlaceholder = "Search techniques",
  availableTags,
  activeTags,
  onToggleTag,
  onClearTags,
}: TechniqueFiltersProps) {
  return (
    <>
      <div className="relative mb-4">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9"
        />
      </div>

      {availableTags.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {availableTags.map((tag) => (
            <Badge
              key={tag}
              variant={activeTags.includes(tag) ? "default" : "outline"}
              className="cursor-pointer select-none"
              onClick={() => onToggleTag(tag)}
            >
              {tag}
            </Badge>
          ))}
          {activeTags.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={onClearTags}
            >
              <XIcon className="mr-1 h-3 w-3" aria-hidden />
              Clear
            </Button>
          )}
        </div>
      )}
    </>
  );
}
