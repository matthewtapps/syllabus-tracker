import { describe, expect, it } from "vitest";
import { coalesceActivity } from "./activity-coalesce";
import type { ActivityRow } from "./activity-line";

function row(p: Partial<ActivityRow>): ActivityRow {
  return {
    id: 0, occurred_at: "2026-06-11T00:00:00Z", verb: "attempt_logged",
    actor_user_id: 1, actor_name: "Alex", target_student_id: 1,
    technique_id: 1, technique_name: "Armbar", syllabus_id: null, syllabus_name: null,
    sst_id: null, video_id: null, video_title: null, payload_json: null, unread: false,
    context_kind: null,
    ...p,
  };
}

describe("coalesceActivity", () => {
  it("collapses consecutive same-verb same-actor rows", () => {
    const r3 = row({ id: 3, technique_name: "Armbar" });
    const r2 = row({ id: 2, technique_name: "Triangle" });
    const r1 = row({ id: 1, verb: "video_watched", technique_name: "Kimura" });
    const out = coalesceActivity([r3, r2, r1]);
    expect(out).toHaveLength(2);
    expect(out[0].count).toBe(2);
    expect(out[0].extraTechniques).toEqual(["Triangle"]);
    expect(out[1].count).toBe(1);
    // members contains all grouped rows, newest first
    expect(out[0].members).toHaveLength(2);
    expect(out[0].members[0]).toBe(r3);
    expect(out[0].members[1]).toBe(r2);
    expect(out[1].members).toHaveLength(1);
    expect(out[1].members[0]).toBe(r1);
  });

  it("does not merge across different actors", () => {
    const out = coalesceActivity([
      row({ id: 2, actor_user_id: 1 }),
      row({ id: 1, actor_user_id: 2 }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].members).toHaveLength(1);
    expect(out[1].members).toHaveLength(1);
  });

  it("members[0] is the representative row", () => {
    const r3 = row({ id: 3 });
    const r2 = row({ id: 2 });
    const r1 = row({ id: 1 });
    const out = coalesceActivity([r3, r2, r1]);
    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(3);
    expect(out[0].members).toHaveLength(3);
    expect(out[0].members[0]).toBe(r3);
    expect(out[0].row).toBe(r3);
  });
});
