import { useEffect, useState } from "react";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PrivacyAckBannerProps {
  enabled: boolean;
}

interface AckStatusResponse {
  acked: boolean;
}

export function PrivacyAckBanner({ enabled }: PrivacyAckBannerProps) {
  const [acked, setAcked] = useState<boolean | null>(null);
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/videos/privacy-ack", {
          credentials: "include",
        });
        if (!response.ok) return;
        const data = (await response.json()) as AckStatusResponse;
        if (!cancelled) setAcked(data.acked);
      } catch (err) {
        console.warn("privacy ack lookup failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  if (!enabled || acked !== false) return null;

  async function handleAcknowledge() {
    setDismissing(true);
    try {
      await fetch("/api/videos/privacy-ack", {
        method: "POST",
        credentials: "include",
      });
      setAcked(true);
    } catch (err) {
      console.warn("privacy ack failed", err);
      setDismissing(false);
    }
  }

  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
      <p>
        Your coach can see which videos you've watched and your progress through
        them. This helps them know what to cover next.
      </p>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={handleAcknowledge}
        disabled={dismissing}
        aria-label="Got it, dismiss this notice"
      >
        <XIcon className="h-4 w-4" aria-hidden />
      </Button>
    </div>
  );
}
