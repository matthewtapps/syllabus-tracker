import { describe, it, expect } from "vitest";
import { activityCaption } from "./activity-caption";
import type { ActivityRow } from "./activity-line";

function row(overrides: Partial<ActivityRow> & { verb: string }): ActivityRow {
  return {
    id: 1,
    occurred_at: "2026-06-18T12:00:00.000Z",
    actor_user_id: 1,
    actor_name: "Coach",
    target_student_id: 2,
    target_student_name: "Sam",
    technique_id: 5,
    technique_name: "Armbar",
    syllabus_id: 4,
    syllabus_name: "Blue Belt",
    sst_id: 42,
    video_id: null,
    video_title: null,
    payload_json: null,
    unread: false,
    context_kind: "syllabus",
    thread_id: null,
    camp_id: null,
    competition_id: null,
    match_id: null,
    camp_name: null,
    competition_name: null,
    comment_count: 0,
    ...overrides,
  };
}

describe("activityCaption", () => {
  it("renders a status change as 'Set to' + label + colour, no technique name", () => {
    const cap = activityCaption(
      row({ verb: "sst_status_changed", payload_json: JSON.stringify({ from: "red", to: "amber" }) }),
    );
    expect(cap).toEqual({ text: "Set to", statusLabel: "Doing", statusColor: "amber" });
  });

  it("gives minimal captions for the common verbs", () => {
    expect(activityCaption(row({ verb: "attempt_logged" })).text).toBe("Logged an attempt");
    expect(
      activityCaption(row({ verb: "video_watched", video_title: "Drill" })).text,
    ).toBe("Watched Drill");
    expect(activityCaption(row({ verb: "video_watched", video_title: null })).text).toBe(
      "Watched a video",
    );
    expect(
      activityCaption(row({ verb: "video_added", video_title: "Setup" })).text,
    ).toBe("Added Setup");
    expect(activityCaption(row({ verb: "technique_pinned" })).text).toBe("Pinned");
    expect(activityCaption(row({ verb: "sst_unhidden" })).text).toBe("Made visible");
    expect(activityCaption(row({ verb: "thread_comment_posted" })).text).toBe("Commented");
  });

  it("falls back to the narrative verb for untailored verbs", () => {
    const cap = activityCaption(
      row({ verb: "syllabus_graduated", technique_id: null, sst_id: null }),
    );
    expect(cap.text.length).toBeGreaterThan(0);
    expect(cap.statusLabel).toBeUndefined();
  });
});
