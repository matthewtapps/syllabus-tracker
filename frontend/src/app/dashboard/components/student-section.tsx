import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { StudentRow } from "@/components/student-row";
import type { User } from "@/lib/api";
import { cn } from "@/lib/utils";

interface StudentSectionProps {
  title: string;
  icon: LucideIcon;
  description?: string;
  students: User[];
  emptyMessage?: string;
  footer?: ReactNode;
  variant?: "default" | "attention";
  className?: string;
}

export function StudentSection({
  title,
  icon: Icon,
  description,
  students,
  emptyMessage,
  footer,
  variant = "default",
  className,
}: StudentSectionProps) {
  if (students.length === 0 && !emptyMessage) return null;

  return (
    <section
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-card",
        variant === "attention" && "border-status-amber/40",
        className,
      )}
    >
      <header
        className={cn(
          "flex items-center justify-between gap-4 border-b border-border px-4 py-3",
          variant === "attention" && "border-status-amber/40 bg-status-amber-bg",
        )}
      >
        <div className="flex items-center gap-2.5">
          <Icon
            className={cn(
              "h-4 w-4",
              variant === "attention" ? "text-status-amber" : "text-muted-foreground",
            )}
            aria-hidden
          />
          <div>
            <h2 className="text-sm font-semibold">{title}</h2>
            {description && (
              <p className="text-xs text-muted-foreground">{description}</p>
            )}
          </div>
        </div>
      </header>

      {students.length > 0 ? (
        <div className="divide-y divide-border">
          {students.map((student) => (
            <StudentRow key={student.id} student={student} />
          ))}
        </div>
      ) : (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          {emptyMessage}
        </p>
      )}

      {footer && <div className="border-t border-border px-4 py-3">{footer}</div>}
    </section>
  );
}
