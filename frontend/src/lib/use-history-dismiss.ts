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
 */
export function useHistoryDismiss(open: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    window.history.pushState({ overlayDismiss: true }, "");
    const onPop = () => onCloseRef.current();
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // Closed via the UI (not Back): our entry is still on top, so pop it.
      // Closed via Back: the entry is already gone, so skip the extra back.
      if ((window.history.state as { overlayDismiss?: boolean } | null)?.overlayDismiss) {
        window.history.back();
      }
    };
  }, [open]);
}
