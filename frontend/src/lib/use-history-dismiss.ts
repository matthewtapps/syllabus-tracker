import { useEffect, useRef } from "react";

/**
 * Make a hardware/browser Back press close an overlay (sheet/dialog) instead of
 * navigating the route away. While `open`, we push a same-URL history entry;
 * Back then pops that entry and fires `popstate`, which we turn into `onClose`.
 * Closing via the UI runs the cleanup, which pops our own entry back off so we
 * never leave a dangling history slot.
 *
 * Pushing the *same* URL means React Router sees a popstate to the current
 * location and re-renders in place, so the route never visibly changes.
 *
 * Each overlay gets a unique ID stored in the history state so the cleanup can
 * tell whether it is still the topmost entry. If another overlay has pushed on
 * top (e.g. navigating source-picker → Sillybus navigator), the source-picker
 * cleanup skips the history.back() call and avoids an inadvertent popstate that
 * would immediately close the newly-opened overlay.
 */
export function useHistoryDismiss(open: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const idRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const id = Math.random().toString(36).slice(2);
    idRef.current = id;
    window.history.pushState({ overlayDismiss: id }, "");
    const onPop = () => onCloseRef.current();
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // Only pop our history entry if it is still the topmost overlay entry.
      // If another overlay has pushed on top, leave that entry alone — the
      // newly-opened overlay is responsible for its own cleanup.
      const state = window.history.state as { overlayDismiss?: string } | null;
      if (state?.overlayDismiss === idRef.current) {
        window.history.back();
      }
    };
  }, [open]);
}
