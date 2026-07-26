import { describe, it, expect } from "vitest";
import {
  countThreadComments,
  resolvePinFocus,
  selectTeaserThreads,
  withResumeParam,
} from "./review-logic";
import type { ThreadView } from "@/lib/api";

describe("resolvePinFocus", () => {
  it("in fullscreen, exits fullscreen to reveal the feed", () => {
    expect(resolvePinFocus(true)).toEqual({ exitFullscreen: true });
  });
  it("not in fullscreen, does nothing", () => {
    expect(resolvePinFocus(false)).toEqual({ exitFullscreen: false });
  });
});

function thread(id: number, createdAt: string, replies = 0): ThreadView {
  return {
    id,
    anchor_kind: "video",
    author_id: 1,
    author_name: "Coach Lee",
    visibility: "broadcast",
    scope_student_id: null,
    video_ts_seconds: null,
    body: `thread ${id}`,
    video: null,
    created_at: createdAt,
    deleted_at: null,
    comments: Array.from({ length: replies }, (_, i) => ({
      id: id * 100 + i,
      thread_id: id,
      parent_comment_id: null,
      author_id: 2,
      author_name: "Sam Khan",
      body: "reply",
      video: null,
      video_ts_seconds: null,
      created_at: createdAt,
      deleted_at: null,
    })),
  };
}

const oldest = thread(1, "2026-07-01T00:00:00Z");
const middle = thread(2, "2026-07-10T00:00:00Z");
const newest = thread(3, "2026-07-20T00:00:00Z");

describe("selectTeaserThreads", () => {
  it("puts the focus thread first, then the newest other one", () => {
    expect(selectTeaserThreads([oldest, middle, newest], 1).map((t) => t.id)).toEqual([1, 3]);
  });

  it("previews the two newest threads when there is no focus thread", () => {
    expect(selectTeaserThreads([oldest, middle, newest], null).map((t) => t.id)).toEqual([3, 2]);
  });

  it("falls back to newest-first when the focus thread is not on the video", () => {
    expect(selectTeaserThreads([oldest, newest], 99).map((t) => t.id)).toEqual([3, 1]);
  });

  it("never exceeds the budget", () => {
    expect(selectTeaserThreads([oldest, middle, newest], 3)).toHaveLength(2);
  });

  it("returns nothing for a video with no threads", () => {
    expect(selectTeaserThreads([], null)).toEqual([]);
  });
});

describe("countThreadComments", () => {
  it("counts roots plus replies across every thread", () => {
    expect(countThreadComments([thread(1, "2026-07-01T00:00:00Z", 3), thread(2, "x", 0)])).toBe(5);
  });

  it("is zero for no threads", () => {
    expect(countThreadComments([])).toBe(0);
  });
});

describe("withResumeParam", () => {
  const base = "/library?focus=technique:5&video=11";

  it("appends the whole-second playhead", () => {
    expect(withResumeParam(base, 84.7, true)).toBe(`${base}&t=84`);
  });

  it("opens the query string when the href has none", () => {
    expect(withResumeParam("/camps/9", 30, true)).toBe("/camps/9?t=30");
  });

  it("leaves the href alone at the very start", () => {
    expect(withResumeParam(base, 0, true)).toBe(base);
    expect(withResumeParam(base, 0.4, true)).toBe(base);
  });

  it("leaves the href alone for a player that cannot report time (an embed)", () => {
    expect(withResumeParam(base, 84, false)).toBe(base);
  });

  it("stays null when there is nowhere to link", () => {
    expect(withResumeParam(null, 84, true)).toBeNull();
  });
});
