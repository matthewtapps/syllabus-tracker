import { describe, it, expect } from "vitest";
import { shouldDismiss } from "./use-swipe-down-dismiss";

const VH = 800;

describe("shouldDismiss", () => {
  it("never dismisses on an upward drag", () => {
    expect(shouldDismiss(-300, -2, VH)).toBe(false);
  });

  it("does not dismiss a small, slow downward drag", () => {
    expect(shouldDismiss(80, 0.1, VH)).toBe(false);
  });

  it("dismisses when dragged past a quarter of the viewport", () => {
    expect(shouldDismiss(VH * 0.25 + 1, 0, VH)).toBe(true);
  });

  it("dismisses a short but fast downward flick", () => {
    expect(shouldDismiss(40, 0.8, VH)).toBe(true);
  });

  it("does not dismiss a zero-distance release", () => {
    expect(shouldDismiss(0, 0, VH)).toBe(false);
  });
});
