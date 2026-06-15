import { describe, it, expect } from "vitest";
import { effectiveTheater, resolvePinFocus } from "./review-logic";

describe("effectiveTheater", () => {
  it("is on when there is room and the pref is auto (null)", () => {
    expect(effectiveTheater(true, null)).toBe(true);
  });
  it("is off when there is no room, regardless of pref", () => {
    expect(effectiveTheater(false, null)).toBe(false);
    expect(effectiveTheater(false, true)).toBe(false);
  });
  it("an explicit pref overrides auto when there is room", () => {
    expect(effectiveTheater(true, false)).toBe(false);
    expect(effectiveTheater(true, true)).toBe(true);
  });
});

describe("resolvePinFocus", () => {
  it("in fullscreen, exit and force theater", () => {
    expect(resolvePinFocus(true)).toEqual({ exitFullscreen: true, forceTheater: true });
  });
  it("not in fullscreen, do neither", () => {
    expect(resolvePinFocus(false)).toEqual({ exitFullscreen: false, forceTheater: false });
  });
});
