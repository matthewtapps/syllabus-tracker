import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

interface ThreadComposerProps {
  placeholder: string;
  submitLabel: string;
  pending: boolean;
  onSubmit: (body: string) => Promise<void>;
}

export function ThreadComposer({
  placeholder,
  submitLabel,
  pending,
  onSubmit,
}: ThreadComposerProps) {
  const [body, setBody] = useState("");

  async function handle() {
    const trimmed = body.trim();
    if (!trimmed) return;
    await onSubmit(trimmed);
    setBody("");
  }

  return (
    <div className="flex items-end gap-2">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
        rows={1}
        className="max-h-40 min-h-[38px] flex-1"
        disabled={pending}
      />
      <Button
        type="button"
        onClick={handle}
        disabled={pending || !body.trim()}
      >
        {pending ? "Posting…" : submitLabel}
      </Button>
    </div>
  );
}
