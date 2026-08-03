import { useEffect, useRef } from "react";

export interface DismissEntry {
  close: () => void;
}

/**
 * Every open history-dismissing overlay, oldest first. Overlays nest (a video
 * dialog over a sheet, a source-picker over a composer), and one Back has to
 * mean one close, so the stack decides who owns the next `popstate` instead of
 * every listener firing its own `onClose`.
 */
const stack: DismissEntry[] = [];

/** Registers an overlay as the new topmost. */
export function pushDismissable(close: () => void): DismissEntry {
  const entry: DismissEntry = { close };
  stack.push(entry);
  return entry;
}

/** Drops an entry wherever it sits. True when it was still on the stack. */
export function removeDismissable(entry: DismissEntry): boolean {
  const index = stack.indexOf(entry);
  if (index === -1) return false;
  stack.splice(index, 1);
  return true;
}

/** One Back press: close the topmost overlay and nothing below it. */
export function dismissTop(): void {
  stack.pop()?.close();
}

export function dismissStackSize(): number {
  return stack.length;
}

// One shared listener for the whole stack. Per-overlay listeners cannot work:
// they all fire on the same event, so the layer below would see itself become
// top mid-dispatch and close too.
function handlePopstate() {
  dismissTop();
}

/**
 * Make a hardware/browser Back press close an overlay (sheet/dialog) instead of
 * navigating the route away. While `open`, we push a same-URL history entry;
 * Back then pops that entry and fires `popstate`, which closes the topmost
 * overlay. Closing via the UI runs the cleanup, which pops our own entry back
 * off so we never leave a dangling history slot.
 *
 * Pushing the *same* URL means React Router sees a popstate to the current
 * location and re-renders in place, so the route never visibly changes.
 *
 * Two guards, for the two ways an overlay closes:
 *
 * - **Back** goes through the stack above, so one press closes the topmost
 *   overlay and nothing under it.
 * - **Closing through the UI** pops our own history entry, but only when that
 *   entry is still the top of the history stack. Each overlay stores a unique
 *   id in its history state to check that. If another overlay has pushed on top
 *   (source-picker → Sillybus navigator), the lower one leaves the entry alone
 *   rather than firing a popstate that would close the overlay just opened.
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
    const entry = pushDismissable(() => onCloseRef.current());
    // addEventListener dedupes an identical (type, fn) pair, so this stays one
    // listener however many overlays are open.
    window.addEventListener("popstate", handlePopstate);
    return () => {
      // False here means Back already closed us: `dismissTop` took us off the
      // stack and the history entry is gone, so there is nothing to pop.
      const closedThroughUi = removeDismissable(entry);
      if (stack.length === 0) {
        window.removeEventListener("popstate", handlePopstate);
      }
      const state = window.history.state as { overlayDismiss?: string } | null;
      if (closedThroughUi && state?.overlayDismiss === idRef.current) {
        window.history.back();
      }
    };
  }, [open]);
}
