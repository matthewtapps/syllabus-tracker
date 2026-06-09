import { useCallback, useEffect, useState } from "react";

const DISMISS_KEY = "pwa-install-dismissed-at";
const DISMISS_WINDOW_MS = 1000 * 60 * 60 * 24 * 14;

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
  prompt(): Promise<void>;
}

export type IosBrowser =
  | "safari"
  | "chrome"
  | "firefox"
  | "edge"
  | "opera"
  | "duckduckgo"
  | "facebook"
  | "instagram"
  | "tiktok"
  | "twitter"
  | "linkedin"
  | "pinterest"
  | "snapchat"
  | "line"
  | "wechat"
  | "google-app"
  | "other";

export type InstallContext =
  | { kind: "native"; install: () => Promise<void> }
  | { kind: "ios-safari" }
  | { kind: "ios-other"; browser: IosBrowser }
  | { kind: "installed" }
  | { kind: "none" };

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIos(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ reports as Mac; distinguish via touch support.
  return ua.includes("Mac") && "ontouchend" in document;
}

// Order matters: in-app browser tokens and explicit browser tokens (CriOS, FxiOS)
// must be checked before falling through to "safari", since all of these UAs
// also include the word "Safari".
function detectIosBrowser(ua: string): IosBrowser {
  if (/FBAN|FBAV|FB_IAB/.test(ua)) return "facebook";
  if (/Instagram/.test(ua)) return "instagram";
  if (/TikTok|musical_ly|BytedanceWebview/.test(ua)) return "tiktok";
  if (/Twitter/.test(ua)) return "twitter";
  if (/LinkedInApp/.test(ua)) return "linkedin";
  if (/Pinterest/.test(ua)) return "pinterest";
  if (/Snapchat/.test(ua)) return "snapchat";
  if (/Line\//.test(ua)) return "line";
  if (/MicroMessenger/.test(ua)) return "wechat";
  if (/GSA\//.test(ua)) return "google-app";
  if (/CriOS\//.test(ua)) return "chrome";
  if (/FxiOS\//.test(ua)) return "firefox";
  if (/EdgiOS\//.test(ua)) return "edge";
  if (/OPiOS\//.test(ua)) return "opera";
  if (/DuckDuckGo/.test(ua)) return "duckduckgo";
  return "safari";
}

function readDismissedAt(): number | null {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return null;
    const ts = Number(raw);
    return Number.isFinite(ts) ? ts : null;
  } catch {
    return null;
  }
}

// Module-level store so every consumer (prompt component, navbar menu items)
// sees the same `beforeinstallprompt` event and dismiss state. Without this
// each useState instance would race the event and a late mount would miss it.
let deferredEvent: BeforeInstallPromptEvent | null = null;
let installedFlag = isStandalone();
let dismissedAt: number | null = readDismissedAt();
let forceShowCount = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredEvent = event as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferredEvent = null;
    installedFlag = true;
    emit();
  });
  const mql = window.matchMedia?.("(display-mode: standalone)");
  mql?.addEventListener?.("change", (ev) => {
    if (ev.matches) {
      installedFlag = true;
      emit();
    }
  });
}

async function runNativeInstall(): Promise<void> {
  const evt = deferredEvent;
  if (!evt) return;
  // Null the event first so a double-click can't trigger prompt() twice.
  deferredEvent = null;
  emit();
  await evt.prompt();
  const choice = await evt.userChoice;
  if (choice.outcome === "accepted") {
    installedFlag = true;
    emit();
  }
}

function computeContext(): InstallContext {
  if (installedFlag) return { kind: "installed" };
  if (deferredEvent) return { kind: "native", install: runNativeInstall };
  if (typeof window === "undefined" || !isIos()) return { kind: "none" };
  const browser = detectIosBrowser(window.navigator.userAgent);
  if (browser === "safari") return { kind: "ios-safari" };
  return { kind: "ios-other", browser };
}

function computeVisible(context: InstallContext): boolean {
  if (context.kind === "installed" || context.kind === "none") return false;
  if (forceShowCount > 0) return true;
  if (dismissedAt !== null && Date.now() - dismissedAt < DISMISS_WINDOW_MS) {
    return false;
  }
  return true;
}

function useStoreVersion(): void {
  const [, setV] = useState(0);
  useEffect(() => {
    const cb = () => setV((n) => n + 1);
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  }, []);
}

export function useInstall(): {
  context: InstallContext;
  visible: boolean;
  dismiss: () => void;
} {
  useStoreVersion();
  const context = computeContext();
  const visible = computeVisible(context);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Storage disabled (private mode); fall through to in-memory dismiss.
    }
    dismissedAt = Date.now();
    forceShowCount = 0;
    emit();
  }, []);

  return { context, visible, dismiss };
}

// Imperative trigger for menu items in NavBar / BottomNav. For native contexts
// this fires the install prompt directly; otherwise it surfaces the
// instructional overlay (clearing the recent-dismiss so it sticks around).
export function useInstallTrigger(): { available: boolean; trigger: () => void } {
  useStoreVersion();
  const context = computeContext();
  if (context.kind === "installed" || context.kind === "none") {
    return { available: false, trigger: () => {} };
  }
  return {
    available: true,
    trigger: () => {
      if (context.kind === "native") {
        void context.install();
        return;
      }
      try {
        localStorage.removeItem(DISMISS_KEY);
      } catch {
        // Ignore.
      }
      dismissedAt = null;
      forceShowCount += 1;
      emit();
    },
  };
}
