import { useCallback, useRef, useState } from "react";

/**
 * Pure decision for a drag-to-dismiss gesture: dismiss when the pointer has
 * been dragged down past a fraction of the viewport, or released in a fast
 * downward flick. Upward or sideways drags never dismiss.
 *
 * @param deltaY     downward drag distance in px (negative = upward)
 * @param velocityY  release velocity in px/ms (positive = downward)
 * @param viewportH  viewport height in px
 */
export function shouldDismiss(deltaY: number, velocityY: number, viewportH: number): boolean {
  if (deltaY <= 0) return false;
  const draggedFarEnough = deltaY > viewportH * 0.25;
  const flickedDown = velocityY > 0.5;
  return draggedFarEnough || flickedDown;
}

export interface SwipeDownDismiss {
  /** Live downward offset to apply as translateY while dragging (0 at rest). */
  translateY: number;
  /** True between pointer down and release; use to disable the spring-back transition. */
  dragging: boolean;
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
  };
}

/**
 * Touch/pointer drag-to-dismiss. Attach `handlers` to the drag region (header /
 * player, never the scrollable feed) and apply `translateY` as a transform for
 * follow-the-finger feedback. Releases either call `onDismiss` or spring back.
 */
export function useSwipeDownDismiss(onDismiss: () => void): SwipeDownDismiss {
  const [translateY, setTranslateY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ y: number; t: number } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!e.isPrimary) return;
    start.current = { y: e.clientY, t: performance.now() };
    setDragging(true);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!start.current) return;
    const dy = e.clientY - start.current.y;
    setTranslateY(dy > 0 ? dy : 0);
  }, []);

  const end = useCallback(
    (e: React.PointerEvent) => {
      if (!start.current) return;
      const dy = e.clientY - start.current.y;
      const dt = performance.now() - start.current.t;
      const velocity = dt > 0 ? dy / dt : 0;
      start.current = null;
      setDragging(false);
      if (shouldDismiss(dy, velocity, window.innerHeight)) {
        onDismiss();
      } else {
        setTranslateY(0);
      }
    },
    [onDismiss],
  );

  return {
    translateY,
    dragging,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: end,
      onPointerCancel: end,
    },
  };
}
