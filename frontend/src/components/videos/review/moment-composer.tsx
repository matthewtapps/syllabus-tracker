import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatTimestamp } from "@/lib/dates";

export interface MomentDraft {
  video_ts_seconds: number | null;
  body: string;
}

interface MomentComposerProps {
  /** Live playhead seconds (from PlayerController). */
  currentTime: number;
  /** False for embeds that cannot report a playhead. */
  canStamp: boolean;
  /** Called when the composer expands, so the surface can pause playback. */
  onCaptureStart?: () => void;
  onSubmit: (draft: MomentDraft) => Promise<void>;
  pending?: boolean;
}

export function MomentComposer({
  currentTime,
  canStamp,
  onCaptureStart,
  onSubmit,
  pending = false,
}: MomentComposerProps) {
  const [open, setOpen] = useState(false);
  const [stamp, setStamp] = useState<number | null>(null);
  const [body, setBody] = useState("");

  function expand() {
    setStamp(canStamp ? Math.floor(currentTime) : null);
    setBody("");
    setOpen(true);
    onCaptureStart?.();
  }

  function collapse() {
    setOpen(false);
    setBody("");
  }

  async function post() {
    const trimmed = body.trim();
    if (!trimmed) return;
    try {
      await onSubmit({ video_ts_seconds: stamp, body: trimmed });
      collapse();
    } catch {
      // Keep the composer open so the draft survives; submit() already toasted.
    }
  }

  if (!open) {
    return (
      <div className="border-y border-border p-3">
        <button
          type="button"
          onClick={expand}
          className="flex w-full items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-left text-sm text-muted-foreground hover:bg-muted/60"
        >
          {canStamp ? (
            <>
              <Plus className="h-4 w-4 text-primary" />
              <span>
                Comment at{" "}
                <span className="font-semibold tabular-nums text-primary">
                  {formatTimestamp(currentTime)}
                </span>
              </span>
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" />
              <span>Add a comment</span>
            </>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2 border-y border-border bg-card p-3">
      {stamp !== null && (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-1 text-xs font-semibold tabular-nums text-primary">
            <span aria-hidden="true">&#9654;</span> {formatTimestamp(stamp)}
          </span>
          <div className="flex gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-6 w-6"
              aria-label="nudge back"
              onClick={() => setStamp((s) => Math.max(0, (s ?? 0) - 1))}
            >
              <Minus className="h-3 w-3" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-6 w-6"
              aria-label="nudge forward"
              onClick={() => setStamp((s) => (s ?? 0) + 1)}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
          <button
            type="button"
            className="ml-auto text-xs text-muted-foreground underline underline-offset-2"
            onClick={() => setStamp(null)}
          >
            &#215; whole video
          </button>
        </div>
      )}
      <Textarea
        autoFocus
        rows={2}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={
          stamp !== null
            ? `What did you notice at ${formatTimestamp(stamp)}?`
            : "Comment on the whole video..."
        }
        className="min-h-[46px]"
        disabled={pending}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={collapse} disabled={pending}>
          Cancel
        </Button>
        <Button type="button" onClick={post} disabled={pending || !body.trim()}>
          {pending ? "Posting..." : "Post"}
        </Button>
      </div>
    </div>
  );
}
