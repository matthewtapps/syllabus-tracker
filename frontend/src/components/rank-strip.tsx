import { useState } from 'react';
import { Pencil } from 'lucide-react';
import type { Belt, User } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { RankEditDialog } from '@/components/rank-edit-dialog';
import { formatAbsolute } from '@/lib/dates';

// Mapping kept deliberately limited to the belts the backend validates.
// Tailwind classes are written out explicitly so the JIT compiler keeps
// each colour class in the build output (dynamic class names don't get
// picked up).
const BELT_STYLES: Record<Belt, { swatch: string; label: string }> = {
  white: { swatch: 'bg-white border border-foreground/30', label: 'White' },
  blue: { swatch: 'bg-blue-600', label: 'Blue' },
  purple: { swatch: 'bg-purple-700', label: 'Purple' },
  brown: { swatch: 'bg-amber-900', label: 'Brown' },
  black: { swatch: 'bg-black border border-foreground/20', label: 'Black' },
  coral: { swatch: 'bg-rose-500', label: 'Coral' },
};

interface RankStripProps {
  student: User;
  canEdit: boolean;
}

export function RankStrip({ student, canEdit }: RankStripProps) {
  const [open, setOpen] = useState(false);
  const hasRank = !!student.belt;
  const beltStyle = student.belt ? BELT_STYLES[student.belt] : null;
  const stripes = student.stripes ?? 0;

  // Empty state: students see nothing (avoid clutter on their own view).
  // Coaches see a "Set rank" affordance so the field gets used.
  if (!hasRank) {
    if (!canEdit) return null;
    return (
      <>
        <div className="flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-2 text-sm">
          <span className="text-muted-foreground">No belt set</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setOpen(true)}
            aria-label="Set student rank"
          >
            Set rank
          </Button>
        </div>
        <RankEditDialog open={open} onOpenChange={setOpen} student={student} />
      </>
    );
  }

  return (
    <>
      <div className="flex items-center gap-3 rounded-md border bg-card px-3 py-2">
        <span
          className={`h-6 w-6 shrink-0 rounded-sm ${beltStyle!.swatch}`}
          aria-hidden
        />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
            <span className="font-medium">{beltStyle!.label} belt</span>
            <StripesPips stripes={stripes} belt={student.belt!} />
          </div>
          {student.last_graded_at && (
            <p className="text-xs text-muted-foreground">
              Graded {formatAbsolute(student.last_graded_at)}
            </p>
          )}
        </div>
        {canEdit && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="shrink-0"
            onClick={() => setOpen(true)}
            aria-label="Edit rank"
          >
            <Pencil className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </div>
      <RankEditDialog open={open} onOpenChange={setOpen} student={student} />
    </>
  );
}

interface StripesPipsProps {
  stripes: number;
  belt: Belt;
}

// Up to 4 stripes, rendered as filled / unfilled pips. White stripes on
// dark belts (blue/purple/brown/black), dark stripes on white/coral.
function StripesPips({ stripes, belt }: StripesPipsProps) {
  if (stripes <= 0) return null;
  const lightOnDark = belt === 'blue' || belt === 'purple' || belt === 'brown' || belt === 'black';
  const pipClass = lightOnDark ? 'bg-white' : 'bg-foreground';
  return (
    <span
      className="flex items-center gap-0.5"
      aria-label={`${stripes} stripe${stripes === 1 ? '' : 's'}`}
    >
      {Array.from({ length: stripes }).map((_, i) => (
        <span key={i} className={`h-3 w-1 rounded-sm ${pipClass}`} aria-hidden />
      ))}
    </span>
  );
}
