import { describe, expect, test } from "vitest";
import { refToken, parseFocusToken } from "./entity-ref";

describe("refToken", () => {
  test("serializes type and id", () => {
    expect(refToken({ type: "sst", id: 42 })).toBe("sst:42");
    expect(refToken({ type: "technique", id: 9 })).toBe("technique:9");
  });
});

describe("parseFocusToken", () => {
  test("parses a valid token", () => {
    expect(parseFocusToken("sst:42")).toEqual({ type: "sst", id: 42 });
    expect(parseFocusToken("technique:9")).toEqual({ type: "technique", id: 9 });
  });
  test("rejects unknown type", () => {
    expect(parseFocusToken("widget:1")).toBeNull();
  });
  test("rejects malformed input", () => {
    expect(parseFocusToken(null)).toBeNull();
    expect(parseFocusToken(undefined)).toBeNull();
    expect(parseFocusToken("")).toBeNull();
    expect(parseFocusToken("sst:")).toBeNull();
    expect(parseFocusToken("sst:abc")).toBeNull();
    expect(parseFocusToken("sst")).toBeNull();
    expect(parseFocusToken("sst:1:2")).toBeNull();
  });
  test("round-trips with refToken", () => {
    const ref = { type: "video", id: 7 } as const;
    expect(parseFocusToken(refToken(ref))).toEqual(ref);
  });
});
