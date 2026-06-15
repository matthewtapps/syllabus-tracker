import { describe, it, expect } from "vitest";
import { resolvePinFocus } from "./review-logic";

describe("resolvePinFocus", () => {
  it("in fullscreen, exits fullscreen to reveal the feed", () => {
    expect(resolvePinFocus(true)).toEqual({ exitFullscreen: true });
  });
  it("not in fullscreen, does nothing", () => {
    expect(resolvePinFocus(false)).toEqual({ exitFullscreen: false });
  });
});
