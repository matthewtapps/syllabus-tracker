import { describe, expect, it, test, vi, afterEach } from "vitest";
import { formatRelativeShort, formatTimestamp } from "./dates";

const NOW = new Date("2026-06-11T12:00:00Z").getTime();

function at(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString();
}

describe("formatTimestamp", () => {
  it("formats seconds under a minute", () => {
    expect(formatTimestamp(0)).toBe("0:00");
    expect(formatTimestamp(42)).toBe("0:42");
  });
  it("formats minutes:seconds", () => {
    expect(formatTimestamp(65)).toBe("1:05");
    expect(formatTimestamp(605)).toBe("10:05");
  });
  it("formats hours:minutes:seconds past an hour", () => {
    expect(formatTimestamp(3903)).toBe("1:05:03");
  });
  it("floors fractional seconds and clamps negatives to zero", () => {
    expect(formatTimestamp(42.9)).toBe("0:42");
    expect(formatTimestamp(-5)).toBe("0:00");
  });
});

describe("formatRelativeShort", () => {
  afterEach(() => vi.useRealTimers());

  test("buckets", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(formatRelativeShort(at(-10 * 1000))).toBe("now");
    expect(formatRelativeShort(at(-5 * 60 * 1000))).toBe("5m");
    expect(formatRelativeShort(at(-3 * 3600 * 1000))).toBe("3h");
    expect(formatRelativeShort(at(-2 * 86400 * 1000))).toBe("2d");
  });

  test("older than a week shows a short date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    // 10 days ago -> "Jun 1"
    expect(formatRelativeShort(at(-10 * 86400 * 1000))).toMatch(/Jun 1/);
  });

  test("null input", () => {
    expect(formatRelativeShort(null)).toBe("");
  });

  test("naive server timestamps are read as UTC, not local", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW); // 2026-06-11T12:00:00Z
    // Server sends naive UTC. Without the UTC fix these skew by the local offset.
    expect(formatRelativeShort("2026-06-11 11:55:00")).toBe("5m"); // space form
    expect(formatRelativeShort("2026-06-11T11:55:00")).toBe("5m"); // T form
  });
});
