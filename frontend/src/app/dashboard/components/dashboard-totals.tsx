import { cn } from "@/lib/utils";

interface DashboardTotalsProps {
  students: number;
  techniques: number | null;
  assignments: number;
  className?: string;
}

function plural(n: number, singular: string, pluralForm?: string) {
  return n === 1 ? singular : pluralForm ?? `${singular}s`;
}

export function DashboardTotals({
  students,
  techniques,
  assignments,
  className,
}: DashboardTotalsProps) {
  const parts: string[] = [
    `${students} ${plural(students, "student")}`,
  ];
  if (techniques !== null) {
    parts.push(`${techniques} ${plural(techniques, "technique")} in syllabus`);
  }
  parts.push(`${assignments} ${plural(assignments, "assignment")}`);

  return (
    <p className={cn("text-sm text-muted-foreground", className)}>
      {parts.join(" · ")}
    </p>
  );
}
