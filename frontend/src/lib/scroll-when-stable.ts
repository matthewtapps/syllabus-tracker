/**
 * Smooth-scroll an element to the top of the viewport once its size has settled.
 *
 * Used after expanding a deep-linked row: an expanding row near the bottom of a
 * short list cannot reach the top until its newly revealed content has grown the
 * page's scroll height. Scrolling immediately (before the expand animation
 * finishes) clamps at the old max scroll and leaves the row too high. This
 * observes the element and (re)scrolls a short debounce after its last size
 * change, so it lands correctly regardless of animation duration.
 */
export function scrollToTopWhenStable(
  el: HTMLElement,
  { settleMs = 120, timeoutMs = 1000 }: { settleMs?: number; timeoutMs?: number } = {},
): void {
  let timer: number | undefined;
  // ResizeObserver fires once on observe and again on every size change while
  // the row animates open; the debounce collapses those into a single scroll
  // after the height stops changing.
  const ro = new ResizeObserver(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(
      () => el.scrollIntoView({ behavior: "smooth", block: "start" }),
      settleMs,
    );
  });
  ro.observe(el);
  window.setTimeout(() => ro.disconnect(), timeoutMs);
}
