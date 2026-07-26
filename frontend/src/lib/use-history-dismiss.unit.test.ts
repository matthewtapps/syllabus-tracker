import { describe, it, expect, afterEach, vi } from "vitest";
import {
  pushDismissable,
  removeDismissable,
  dismissTop,
  dismissStackSize,
} from "./use-history-dismiss";

afterEach(() => {
  while (dismissStackSize() > 0) dismissTop();
});

describe("the dismissable overlay stack", () => {
  it("closes only the topmost overlay per Back press", () => {
    const lower = vi.fn();
    const upper = vi.fn();
    pushDismissable(lower);
    pushDismissable(upper);

    dismissTop();

    expect(upper).toHaveBeenCalledTimes(1);
    expect(lower).not.toHaveBeenCalled();

    dismissTop();

    expect(lower).toHaveBeenCalledTimes(1);
    expect(upper).toHaveBeenCalledTimes(1);
  });

  it("does nothing when no overlay is open", () => {
    expect(() => dismissTop()).not.toThrow();
    expect(dismissStackSize()).toBe(0);
  });

  it("reports an entry closed through the UI as still on the stack", () => {
    const entry = pushDismissable(vi.fn());
    expect(removeDismissable(entry)).toBe(true);
    expect(dismissStackSize()).toBe(0);
  });

  it("reports an entry already closed by Back as gone", () => {
    const entry = pushDismissable(vi.fn());
    dismissTop();
    expect(removeDismissable(entry)).toBe(false);
  });

  it("leaves the overlay above untouched when a lower one unmounts", () => {
    const lowerClose = vi.fn();
    const upperClose = vi.fn();
    const lower = pushDismissable(lowerClose);
    pushDismissable(upperClose);

    removeDismissable(lower);
    dismissTop();

    expect(upperClose).toHaveBeenCalledTimes(1);
    expect(lowerClose).not.toHaveBeenCalled();
  });
});
