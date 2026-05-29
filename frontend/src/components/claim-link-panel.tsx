import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface ClaimLinkPanelProps {
  url: string;
}

/**
 * Renders a claim URL as a scannable QR code plus a copyable text URL.
 * Used in the "claim link issued" / "password reset" dialogs.
 */
export function ClaimLinkPanel({ url }: ClaimLinkPanelProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copied");
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copy failed, select and copy manually");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-center rounded-md border border-border bg-background p-5">
        <QRCodeSVG
          value={url}
          size={168}
          bgColor="transparent"
          fgColor="currentColor"
          className="text-foreground"
        />
      </div>
      <div className="rounded-md border border-border bg-muted/40 p-3">
        <p className="break-all font-mono text-xs">{url}</p>
      </div>
      <Button
        type="button"
        onClick={handleCopy}
        className="w-full gap-2"
        variant="outline"
      >
        {copied ? (
          <Check className="h-4 w-4" aria-hidden />
        ) : (
          <Copy className="h-4 w-4" aria-hidden />
        )}
        {copied ? "Copied" : "Copy link"}
      </Button>
    </div>
  );
}
