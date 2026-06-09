import type { ReactNode } from "react";
import { Download, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useInstall,
  type AndroidInApp,
  type IosBrowser,
  type InstallContext,
} from "@/lib/install";

export function InstallPrompt() {
  const { context, visible, dismiss } = useInstall();
  if (!visible) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      role="region"
      aria-label="Install app"
    >
      <div className="pointer-events-auto relative w-full max-w-md rounded-lg border border-border bg-card/95 p-4 shadow-lg backdrop-blur-sm">
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="flex items-start gap-3 pr-6">
          <AppIcon />
          <div className="min-w-0 flex-1 text-sm">
            <Body context={context} />
          </div>
        </div>
      </div>
    </div>
  );
}

function AppIcon() {
  // White inner pad so a dark brand mark stays visible on the dark card; the
  // 192x192 PWA icon is used here rather than apple-touch so the bitmap is
  // already cached for the share-sheet preview iOS shows during install.
  return (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-border">
      <img
        src="/icons/pwa-192x192.png"
        alt=""
        aria-hidden
        className="h-12 w-12 rounded-lg"
      />
    </div>
  );
}

function Body({ context }: { context: InstallContext }) {
  if (context.kind === "native") return <NativeBody onInstall={context.install} />;
  if (context.kind === "ios-safari") return <IosSafariBody />;
  if (context.kind === "ios-other") return <IosOtherBody browser={context.browser} />;
  if (context.kind === "android-firefox") return <AndroidFirefoxBody />;
  if (context.kind === "android-in-app") return <AndroidInAppBody browser={context.browser} />;
  return null;
}

function NativeBody({ onInstall }: { onInstall: () => Promise<void> }) {
  return (
    <>
      <h3 className="text-sm font-semibold">Install Silly Bus</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Quick home-screen access with a full-screen view.
      </p>
      <div className="mt-3">
        <Button size="sm" onClick={() => void onInstall()}>
          <Download className="mr-1.5 h-4 w-4" aria-hidden />
          Install app
        </Button>
      </div>
    </>
  );
}

function IosSafariBody() {
  return (
    <>
      <h3 className="text-sm font-semibold">Install on your iPhone</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Add Silly Bus to your home screen for one-tap access.
      </p>
      <ol className="mt-3 space-y-2 text-xs">
        <Step n={1}>
          Tap{" "}
          <AppleShareIcon className="mx-0.5 inline h-4 w-4 -translate-y-px text-foreground" />{" "}
          in Safari's bottom bar
        </Step>
        <Step n={2}>
          Scroll down, then tap{" "}
          <span className="inline-flex items-center gap-0.5 font-medium text-foreground">
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Add to Home Screen
          </span>
        </Step>
        <Step n={3}>
          Tap <span className="font-medium text-foreground">Add</span> in the top-right
        </Step>
      </ol>
    </>
  );
}

function IosOtherBody({ browser }: { browser: IosBrowser }) {
  const { headline, body, steps } = iosOtherCopy(browser);
  return (
    <>
      <h3 className="text-sm font-semibold">{headline}</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">{body}</p>
      <ol className="mt-3 space-y-2 text-xs">
        {steps.map((step, i) => (
          <Step key={i} n={i + 1}>
            {step}
          </Step>
        ))}
      </ol>
    </>
  );
}

function iosOtherCopy(browser: IosBrowser): {
  headline: string;
  body: string;
  steps: ReactNode[];
} {
  const browserLabel = labelForBrowser(browser);

  if (browser === "chrome" || browser === "edge") {
    return {
      headline: "Open in Safari to install",
      body: `${browserLabel} on iPhone can't install web apps. Switch to Safari first, it takes a second.`,
      steps: [
        <>Tap the <strong className="text-foreground">···</strong> menu</>,
        <>Choose <strong className="text-foreground">Open in Safari</strong></>,
        <>Then tap Install app from this menu again</>,
      ],
    };
  }
  if (browser === "firefox") {
    return {
      headline: "Open in Safari to install",
      body: "Firefox on iPhone can't install web apps. Switch to Safari first.",
      steps: [
        <>Tap the <strong className="text-foreground">≡</strong> menu</>,
        <>Choose <strong className="text-foreground">Open in Safari</strong></>,
        <>Then tap Install app from this menu again</>,
      ],
    };
  }
  if (browser === "opera" || browser === "duckduckgo") {
    return {
      headline: "Open in Safari to install",
      body: `${browserLabel} on iPhone can't install web apps. Switch to Safari first.`,
      steps: [
        <>Open this page's share menu</>,
        <>Choose <strong className="text-foreground">Open in Safari</strong></>,
        <>Then tap Install app from this menu again</>,
      ],
    };
  }

  // In-app browsers (Instagram, Facebook, TikTok, etc.). These can't install
  // web apps and don't always expose "Open in Safari" with the same wording.
  return {
    headline: "Open in Safari to install",
    body: `You're in ${browserLabel}'s in-app browser. Web apps can only install from Safari.`,
    steps: [
      <>Tap the <strong className="text-foreground">···</strong> menu (top-right)</>,
      <>Choose <strong className="text-foreground">Open in Safari</strong> or <strong className="text-foreground">Open in External Browser</strong></>,
      <>Then tap Install app from this menu again</>,
    ],
  };
}

function AndroidFirefoxBody() {
  return (
    <>
      <h3 className="text-sm font-semibold">Install on your phone</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Add Silly Bus to your home screen for one-tap access.
      </p>
      <ol className="mt-3 space-y-2 text-xs">
        <Step n={1}>
          Tap the <strong className="text-foreground">⋮</strong> menu in Firefox's bar
        </Step>
        <Step n={2}>
          Tap <strong className="text-foreground">Install</strong> (or Add to Home Screen on older Firefox)
        </Step>
        <Step n={3}>
          Confirm to add the icon to your home screen
        </Step>
      </ol>
    </>
  );
}

function AndroidInAppBody({ browser }: { browser: AndroidInApp }) {
  const label = labelForAndroidInApp(browser);
  return (
    <>
      <h3 className="text-sm font-semibold">Open in Chrome to install</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        You're in {label}'s in-app browser. Web apps can only install from Chrome (or another full browser).
      </p>
      <ol className="mt-3 space-y-2 text-xs">
        <Step n={1}>
          Tap the <strong className="text-foreground">⋮</strong> menu (usually top-right)
        </Step>
        <Step n={2}>
          Choose <strong className="text-foreground">Open in Chrome</strong> or <strong className="text-foreground">Open in browser</strong>
        </Step>
        <Step n={3}>Once in Chrome, tap Install app from this menu again</Step>
      </ol>
    </>
  );
}

function labelForAndroidInApp(browser: AndroidInApp): string {
  switch (browser) {
    case "facebook": return "Facebook";
    case "instagram": return "Instagram";
    case "tiktok": return "TikTok";
    case "twitter": return "X / Twitter";
    case "linkedin": return "LinkedIn";
    case "pinterest": return "Pinterest";
    case "snapchat": return "Snapchat";
    case "line": return "LINE";
    case "wechat": return "WeChat";
    case "telegram": return "Telegram";
    case "google-app": return "Google";
    default: return "this app";
  }
}

function labelForBrowser(browser: IosBrowser): string {
  switch (browser) {
    case "chrome": return "Chrome";
    case "firefox": return "Firefox";
    case "edge": return "Edge";
    case "opera": return "Opera";
    case "duckduckgo": return "DuckDuckGo";
    case "facebook": return "Facebook";
    case "instagram": return "Instagram";
    case "tiktok": return "TikTok";
    case "twitter": return "X / Twitter";
    case "linkedin": return "LinkedIn";
    case "pinterest": return "Pinterest";
    case "snapchat": return "Snapchat";
    case "line": return "LINE";
    case "wechat": return "WeChat";
    case "google-app": return "Google";
    case "safari": return "Safari";
    default: return "this app";
  }
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-muted-foreground">
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
        {n}
      </span>
      <span className="flex-1 leading-snug">{children}</span>
    </li>
  );
}

function AppleShareIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12 15V3" />
      <path d="M8 7l4-4 4 4" />
      <path d="M6 11H4v10h16V11h-2" />
    </svg>
  );
}
