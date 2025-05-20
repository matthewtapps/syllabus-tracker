import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Tag } from "@/lib/api";

interface TagBadgeProps {
  tag: Tag;
  onRemove?: () => void;
  onClick?: () => void;
  active?: boolean;
  className?: string;
}

export function TagBadge({
  tag,
  onRemove,
  onClick,
  active = false,
  className,
}: TagBadgeProps) {
  return (
    <Badge
      variant={active ? "default" : "outline"}
      className={cn(
        "gap-1 px-2 py-0.5",
        onClick ? "cursor-pointer" : "",
        className
      )}
      onClick={onClick}
    >
      <span className="truncate">{tag.name}</span>
      {onRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-3 w-3 p-0 rounded-full"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <X className="h-2 w-2" />
          <span className="sr-only">Remove {tag.name} tag</span>
        </Button>
      )}
    </Badge>
  );
}
