import { describe, expect, it } from "vitest";
import { resolveFeedItem } from "./feed-item";
import type { ActivityRow } from "./activity-line";

function row(overrides: Partial<ActivityRow>): ActivityRow {
  return {
    id: 1,
    occurred_at: "2026-06-18 00:00:00",
    verb: "attempt_logged",
    actor_user_id: 2,
    actor_name: "Alex",
    target_student_id: 4,
    target_student_name: "Bianca",
    technique_id: 3,
    technique_name: "Armbar",
    syllabus_id: 2,
    syllabus_name: "White Belt Fundamentals",
    sst_id: 5,
    video_id: null,
    video_title: null,
    payload_json: null,
    unread: false,
    context_kind: "syllabus",
    thread_id: null,
    camp_id: null,
    camp_name: null,
    competition_id: null,
    competition_name: null,
    match_id: null,
    comment_count: 0,
    ...overrides,
  };
}

describe("resolveFeedItem subject", () => {
  it("surfaces a video with no focus thread for a watch", () => {
    const item = resolveFeedItem(
      row({ verb: "video_watched", video_id: 11, video_title: "Drill", context_kind: "library", sst_id: null }),
    );
    expect(item.subject).toEqual({
      kind: "video",
      videoId: 11,
      techniqueId: 3,
      context: expect.anything(),
      focusThreadId: null,
    });
  });

  it("surfaces a video with the focus thread for a comment on a video", () => {
    const item = resolveFeedItem(
      row({ verb: "thread_comment_posted", thread_id: 7, video_id: 11, context_kind: "library", sst_id: null }),
    );
    expect(item.subject).toMatchObject({ kind: "video", videoId: 11, focusThreadId: 7 });
  });

  it("surfaces the collapsed technique row (no thread) for an attempt", () => {
    expect(resolveFeedItem(row({})).subject).toEqual({ kind: "technique", thread: null });
  });

  it("surfaces the collapsed technique row (no thread) for a pin", () => {
    expect(resolveFeedItem(row({ verb: "technique_pinned", sst_id: null, context_kind: "library" })).subject).toEqual({
      kind: "technique",
      thread: null,
    });
  });

  it("attaches the focus thread for a sst comment", () => {
    expect(
      resolveFeedItem(row({ verb: "thread_comment_posted", thread_id: 7, context_kind: "syllabus" })).subject,
    ).toEqual({ kind: "technique", thread: { anchorKind: "sst", anchorId: 5, threadId: 7 } });
  });

  it("attaches the focus thread for a library technique comment", () => {
    expect(
      resolveFeedItem(
        row({ verb: "thread_comment_posted", thread_id: 7, context_kind: "library", sst_id: null }),
      ).subject,
    ).toEqual({ kind: "technique", thread: { anchorKind: "technique", anchorId: 3, threadId: 7 } });
  });

  it("routes a camp comment to the camp thread", () => {
    expect(
      resolveFeedItem(
        row({ verb: "thread_comment_posted", thread_id: 7, context_kind: "camp", camp_id: 9, technique_id: null, sst_id: null }),
      ).subject,
    ).toEqual({ kind: "thread", anchorKind: "camp", anchorId: 9, threadId: 7 });
  });

  it("routes a profile comment to the student profile thread", () => {
    expect(
      resolveFeedItem(
        row({ verb: "thread_comment_posted", thread_id: 7, context_kind: null, technique_id: null, sst_id: null, target_student_id: 4 }),
      ).subject,
    ).toEqual({ kind: "thread", anchorKind: "student_profile", anchorId: 4, threadId: 7 });
  });

  it("is header-only for an assignment", () => {
    expect(resolveFeedItem(row({ verb: "syllabus_assigned", technique_id: null, sst_id: null })).subject).toEqual({
      kind: "none",
    });
  });

  it("surfaces the technique row for a technique added to a camp", () => {
    const item = resolveFeedItem(
      row({ verb: "camp_technique_added", context_kind: "camp", camp_id: 9, camp_name: "Winter Prep", sst_id: null }),
    );
    expect(item.subject).toEqual({ kind: "technique", thread: null });
    expect(item.gated).toBe(true);
  });

  it("is header-only and gated for camp_created", () => {
    const item = resolveFeedItem(
      row({ verb: "camp_created", context_kind: "camp", camp_id: 9, technique_id: null, sst_id: null }),
    );
    expect(item.subject).toEqual({ kind: "none" });
    expect(item.gated).toBe(true);
  });
});

describe("resolveFeedItem path", () => {
  it("builds surface → technique for a library video", () => {
    const item = resolveFeedItem(
      row({ verb: "video_watched", video_id: 11, video_title: "Drill", context_kind: "library", sst_id: null }),
    );
    expect(item.path).toEqual([
      { label: "Global Technique Library", href: "/library", surfaceKind: "library" },
      { label: "Armbar", href: "/library?focus=technique:3&video=11" },
    ]);
  });

  it("builds syllabus → technique for a syllabus action", () => {
    const item = resolveFeedItem(row({}));
    expect(item.path[0]).toMatchObject({ label: "White Belt Fundamentals", surfaceKind: "syllabus" });
    expect(item.path[0].href).toBe("/student/4/syllabi/2");
    expect(item.path[1]).toMatchObject({ label: "Armbar" });
  });

  it("has no path for a profile thread", () => {
    const item = resolveFeedItem(
      row({ verb: "thread_comment_posted", thread_id: 7, context_kind: null, technique_id: null, sst_id: null }),
    );
    expect(item.path).toEqual([]);
  });
});
