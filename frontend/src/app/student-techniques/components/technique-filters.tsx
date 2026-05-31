import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { STATUS_LABELS, type Status } from "@/lib/status";
import { cn } from "@/lib/utils";

export type FilterTab = "all" | Status | "new_activity";

const FILTER_TABS: { value: FilterTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "red", label: STATUS_LABELS.red },
  { value: "amber", label: STATUS_LABELS.amber },
  { value: "green", label: STATUS_LABELS.green },
  { value: "new_activity", label: "Activity" },
];

interface TechniqueFiltersProps {
  filterText: string;
  onFilterTextChange: (v: string) => void;
  activeTab: FilterTab;
  onActiveTabChange: (v: FilterTab) => void;
  availableTags: string[];
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
  counts: Record<FilterTab, number>;
}

export function TechniqueFilters({
  filterText,
  onFilterTextChange,
  activeTab,
  onActiveTabChange,
  availableTags,
  selectedTags,
  onToggleTag,
  counts,
}: TechniqueFiltersProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-md">
          <Input
            placeholder="Filter by name, description or tag..."
            value={filterText}
            onChange={(e) => onFilterTextChange(e.target.value)}
            aria-label="Filter techniques"
          />
          {filterText && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
              onClick={() => onFilterTextChange("")}
            >
              <X className="h-4 w-4" aria-hidden />
              <span className="sr-only">Clear filter</span>
            </Button>
          )}
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(v) => onActiveTabChange(v as FilterTab)}
        >
          <TabsList className="w-full sm:w-auto">
            {FILTER_TABS.map(({ value, label }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="flex-1 gap-1.5 px-2 sm:flex-initial sm:px-3"
              >
                {label}
                <span
                  className={cn(
                    "hidden rounded-full px-1.5 text-xs tabular-nums sm:inline-flex",
                    activeTab === value
                      ? "bg-background text-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {counts[value] ?? 0}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {availableTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Tags
          </span>
          <div className="flex flex-wrap gap-1.5">
            {availableTags.map((tag) => (
              <Badge
                key={tag}
                variant={selectedTags.includes(tag) ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => onToggleTag(tag)}
              >
                {tag}
              </Badge>
            ))}
            {selectedTags.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => selectedTags.forEach(onToggleTag)}
              >
                Clear tags
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
