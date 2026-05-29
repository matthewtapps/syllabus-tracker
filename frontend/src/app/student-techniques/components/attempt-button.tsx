import { useState } from "react";
import { ChevronDownIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { createAttempt, updateTechnique, type CreateAttemptResult } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

interface AttemptButtonProps {
  studentTechniqueId: number;
  techniqueStatus: "red" | "amber" | "green";
  onLogged: (result: CreateAttemptResult) => void;
  onStatusChange: (next: "amber") => void;
  /** Compact = icon + count only (used in collapsed row on small screens). */
  compact?: boolean;
}

export function AttemptButton({
  studentTechniqueId,
  techniqueStatus,
  onLogged,
  onStatusChange,
  compact = false,
}: AttemptButtonProps) {
  const [busy, setBusy] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);

  async function log(opts: { note?: string; attempted_at?: string } = {}) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await createAttempt(studentTechniqueId, {
        note: opts.note ? opts.note : null,
        attempted_at: opts.attempted_at ?? null,
      });
      onLogged(result);
      if (result.status_suggestion === "amber" && techniqueStatus === "red") {
        toast("First attempt logged", {
          description: "Move this technique to amber?",
          duration: 8000,
          action: {
            label: "Yes",
            onClick: async () => {
              const response = await updateTechnique(studentTechniqueId, {
                status: "amber",
              });
              if (response.ok) {
                onStatusChange("amber");
              } else {
                toast.error("Could not update status");
              }
            },
          },
          cancel: {
            label: "Dismiss",
            onClick: () => undefined,
          },
        });
      }
    } catch (err) {
      console.error(err);
      toast.error("Could not log attempt");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="inline-flex items-stretch rounded-md border border-border bg-background shadow-xs"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          void log();
        }}
        className="inline-flex items-center gap-1.5 rounded-l-md px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
        aria-label="Log an attempt"
      >
        <PlusIcon className="h-3.5 w-3.5" aria-hidden />
        {!compact && <span>Attempt</span>}
      </button>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={busy}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center border-l border-border rounded-r-md px-1.5 hover:bg-muted disabled:opacity-50"
            aria-label="Add a note with this attempt"
          >
            <ChevronDownIcon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-72 space-y-3 p-3"
          onClick={(e) => e.stopPropagation()}
        >
          <AttemptNoteForm
            onCancel={() => setPopoverOpen(false)}
            onSubmit={async (values) => {
              setPopoverOpen(false);
              await log(values);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

interface AttemptNoteFormProps {
  onCancel: () => void;
  onSubmit: (values: { note?: string; attempted_at?: string }) => Promise<void>;
}

function AttemptNoteForm({ onCancel, onSubmit }: AttemptNoteFormProps) {
  const [note, setNote] = useState("");
  const [backdate, setBackdate] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (submitting) return;
        setSubmitting(true);
        try {
          const attempted_at = backdate
            ? new Date(`${date}T12:00:00Z`).toISOString()
            : undefined;
          await onSubmit({
            note: note.trim() ? note.trim() : undefined,
            attempted_at,
          });
        } finally {
          setSubmitting(false);
        }
      }}
      className="space-y-3"
    >
      <div className="space-y-1.5">
        <Label htmlFor="attempt-note" className="text-xs">
          Note (optional)
        </Label>
        <Textarea
          id="attempt-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="text-sm"
          autoFocus
        />
      </div>
      <div className="space-y-1.5">
        <button
          type="button"
          onClick={() => setBackdate((v) => !v)}
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          {backdate ? "Use current time" : "Backdate"}
        </button>
        {backdate && (
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="text-sm"
          />
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? "Logging..." : "Log"}
        </Button>
      </div>
    </form>
  );
}
