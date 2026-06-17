import { describe, it, expect } from "vitest";
import { activityTileKind } from "./tile-kind";
import type { ActivityRow } from "@/lib/activity-line";

const base: ActivityRow = {
  id: 1,
  occurred_at: "2026-06-17T00:00:00Z",
  verb: "sst_status_changed",
  actor_user_id: 1,
  actor_name: "Coach",
  target_student_id: 2,
  target_student_name: "Sam",
  technique_id: 3,
  technique_name: "Armbar",
  syllabus_id: 4,
  syllabus_name: "Blue Belt",
  sst_id: 5,
  video_id: null,
  video_title: null,
  payload_json: null,
  unread: false,
  context_kind: "syllabus",
  thread_id: null,
  camp_id: null,
  competition_id: null,
  match_id: null,
};

describe("activityTileKind", () => {
  it("maps technique verbs to a technique tile", () => {
    expect(activityTileKind(base)).toEqual({ kind: "technique" });
    expect(
      activityTileKind({ ...base, verb: "video_watched", video_id: 9, video_title: "Drill" }),
    ).toEqual({ kind: "technique" });
    expect(activityTileKind({ ...base, verb: "attempt_logged" })).toEqual({ kind: "technique" });
  });

  it("requires a technique id for a technique tile", () => {
    expect(activityTileKind({ ...base, technique_id: null })).toBeNull();
  });

  it("maps a comment to a comment tile with the right anchor", () => {
    expect(
      activityTileKind({ ...base, verb: "thread_comment_posted", thread_id: 7 }),
    ).toEqual({ kind: "comment", anchorKind: "sst", anchorId: 5, threadId: 7 });

    expect(
      activityTileKind({
        ...base,
        verb: "thread_comment_posted",
        thread_id: 7,
        context_kind: "library",
        sst_id: null,
      }),
    ).toEqual({ kind: "comment", anchorKind: "technique", anchorId: 3, threadId: 7 });

    expect(
      activityTileKind({ ...base, verb: "thread_comment_posted", thread_id: 7, video_id: 11 }),
    ).toEqual({ kind: "comment", anchorKind: "video", anchorId: 11, threadId: 7 });
  });

  it("returns null for a comment with no resolvable anchor or thread", () => {
    expect(
      activityTileKind({ ...base, verb: "thread_comment_posted", thread_id: null }),
    ).toBeNull();
    expect(
      activityTileKind({
        ...base,
        verb: "thread_comment_posted",
        thread_id: 7,
        context_kind: null,
        sst_id: null,
        technique_id: null,
      }),
    ).toBeNull();
  });

  it("returns null for non-noun and gated verbs", () => {
    expect(activityTileKind({ ...base, verb: "syllabus_assigned" })).toBeNull();
    expect(activityTileKind({ ...base, verb: "syllabus_graduated" })).toBeNull();
    expect(
      activityTileKind({ ...base, verb: "camp_created", context_kind: "camp" }),
    ).toBeNull();
  });
});
