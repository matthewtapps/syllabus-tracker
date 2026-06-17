import { useEffect } from "react";

/**
 * Recovers from the Radix "frozen app" bug. When a modal overlay
 * (Dialog/AlertDialog/Sheet/DropdownMenu) is open, Radix sets
 * `pointer-events: none` on <body> and restores it on close. If the overlay is
 * *unmounted* while still open, for example a hardware/browser Back press
 * navigates the route away before the close cleanup runs, that style is left
 * behind and the whole page stops responding to clicks until a refresh.
 *
 * `useHistoryDismiss` prevents this for the overlays that adopt it. This is the
 * app-wide safety net for the rest: on every history navigation, once React has
 * committed, clear the stuck style, but only when no overlay is still open so we
 * never re-enable background interaction behind a live modal.
 */
export function usePointerEventsWatchdog(): void {
  useEffect(() => {
    const clearIfStuck = () => {
      if (document.body.style.pointerEvents !== "none") return;
      // A genuinely-open overlay still needs the lock; leave it alone.
      const overlayOpen = document.querySelector(
        '[data-state="open"][role="dialog"],' +
          '[data-state="open"][role="alertdialog"],' +
          '[data-state="open"][role="menu"]',
      );
      if (!overlayOpen) document.body.style.pointerEvents = "";
    };

    const onPop = () => {
      // Run after the navigation's render/unmount commit so we observe the
      // post-navigation DOM, not the frame where the overlay is mid-teardown.
      setTimeout(clearIfStuck, 0);
    };

    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
}
