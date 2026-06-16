import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { studentColor } from "@/lib/student-color";
import { cn } from "@/lib/utils";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface StudentAvatarProps {
  id: number;
  name: string;
  size?: "default" | "sm" | "lg";
  className?: string;
}

/** Avatar tinted by deterministic student identity color. */
export function StudentAvatar({ id, name, size = "default", className }: StudentAvatarProps) {
  const color = studentColor(id);
  return (
    <Avatar size={size} className={cn("shrink-0", className)}>
      <AvatarFallback
        className="font-semibold"
        style={{ backgroundColor: color.bg, color: color.fg }}
      >
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
