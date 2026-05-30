import { useEffect, useState } from "react";
import { Share, Plus, X, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
  prompt(): Promise<void>;
}

const DISMISS_KEY = "pwa-install-dismissed-at";
const DISMISS_WINDOW_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  // iOS exposes a non-standard `standalone` property on navigator.
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

function isIosSafari(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS reports as Mac, so also check for touch points.
    (ua.includes("Mac") && "ontouchend" in document);
  if (!isIos) return false;
  // Filter out in-app browsers (FB, Instagram, etc.) where install doesn't work.
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return isSafari;
}

function wasRecentlyDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < DISMISS_WINDOW_MS;
  } catch {
    return false;
  }
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIos, setShowIos] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (isStandalone() || wasRecentlyDismissed()) return;

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
      setHidden(false);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    const onInstalled = () => {
      setDeferred(null);
      setShowIos(false);
      setHidden(true);
    };
    window.addEventListener("appinstalled", onInstalled);

    if (isIosSafari()) {
      setShowIos(true);
      setHidden(false);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Ignore storage failures (private mode, etc.).
    }
    setHidden(true);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const result = await deferred.userChoice;
    if (result.outcome === "accepted") {
      setHidden(true);
    }
    setDeferred(null);
  };

  if (hidden) return null;
  if (!deferred && !showIos) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      role="region"
      aria-label="Install app"
    >
      <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-lg border border-border bg-card/95 p-3 shadow-lg backdrop-blur-sm">
        <img
          src="/icons/pwa-192x192.png"
          alt=""
          aria-hidden
          className="h-10 w-10 shrink-0 rounded-md"
        />
        <div className="min-w-0 flex-1 text-sm">
          {deferred ? (
            <>
              <div className="font-medium">Install Silly Bus</div>
              <div className="text-muted-foreground">
                Add it to your home screen for quick access.
              </div>
            </>
          ) : (
            <>
              <div className="font-medium">Add to Home Screen</div>
              <div className="flex flex-wrap items-center gap-1 text-muted-foreground">
                <span>Tap</span>
                <Share className="inline h-4 w-4" aria-label="Share" />
                <span>then</span>
                <span className="inline-flex items-center gap-0.5 font-medium">
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  Add to Home Screen
                </span>
              </div>
            </>
          )}
        </div>
        {deferred && (
          <Button size="sm" onClick={install} className="shrink-0">
            <Download className="mr-1 h-4 w-4" aria-hidden />
            Install
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
