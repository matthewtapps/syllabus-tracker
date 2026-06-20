import { describe, it, expect } from "vitest";
import {
  suppressHideUnhide,
  HIDE_UNHIDE_UNDO_MS,
  UNHIDE_REHIDE_MS,
} from "./activity-hide-unhide";
import type { ActivityRow } from "./activity-line";

const T0 = Date.parse("2026-06-18T12:00:00.000Z");

function row(overrides: Partial<ActivityRow> & { verb: string }): ActivityRow {
  return {
    id: Math.floor(Math.random() * 1e9),
    occurred_at: new Date(T0).toISOString(),
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
    camp_name: null,
    comment_count: 0,
    ...overrides,
  };
}

function at(offsetMs: number): string {
  return new Date(T0 + offsetMs).toISOString();
}

describe("suppressHideUnhide", () => {
  it("drops every bare sst_hidden row", () => {
    const out = suppressHideUnhide([row({ verb: "sst_hidden" })]);
    expect(out).toHaveLength(0);
  });

  it("keeps a lone sst_unhidden (genuine made-visible)", () => {
    const out = suppressHideUnhide([row({ verb: "sst_unhidden" })]);
    expect(out).toHaveLength(1);
    expect(out[0].verb).toBe("sst_unhidden");
  });

  it("drops an unhide undone by a hide just before it", () => {
    const rows = [
      row({ verb: "sst_unhidden", occurred_at: at(5 * 60 * 1000) }),
      row({ verb: "sst_hidden", occurred_at: at(0) }),
    ];
    expect(suppressHideUnhide(rows)).toHaveLength(0);
  });

  it("drops an unhide that is re-hidden within the wide window", () => {
    const rows = [
      row({ verb: "sst_hidden", occurred_at: at(60 * 60 * 1000) }),
      row({ verb: "sst_unhidden", occurred_at: at(0) }),
    ];
    expect(suppressHideUnhide(rows)).toHaveLength(0);
  });

  it("keeps an unhide re-hidden only after the wide window", () => {
    const rows = [
      row({ verb: "sst_hidden", occurred_at: at(UNHIDE_REHIDE_MS + 60 * 1000) }),
      row({ verb: "sst_unhidden", occurred_at: at(0) }),
    ];
    const out = suppressHideUnhide(rows);
    expect(out).toHaveLength(1);
    expect(out[0].verb).toBe("sst_unhidden");
  });

  it("keeps an unhide whose preceding hide is older than the undo window", () => {
    const rows = [
      row({ verb: "sst_unhidden", occurred_at: at(HIDE_UNHIDE_UNDO_MS + 60 * 1000) }),
      row({ verb: "sst_hidden", occurred_at: at(0) }),
    ];
    // The hide is dropped; the unhide survives (not a quick undo, no re-hide after).
    const out = suppressHideUnhide(rows);
    expect(out).toHaveLength(1);
    expect(out[0].verb).toBe("sst_unhidden");
  });

  it("pairs per sst_id (a hide on a different technique does not suppress)", () => {
    const rows = [
      row({ verb: "sst_unhidden", sst_id: 42, occurred_at: at(60 * 1000) }),
      row({ verb: "sst_hidden", sst_id: 99, occurred_at: at(0) }),
    ];
    const out = suppressHideUnhide(rows);
    expect(out.map((r) => r.verb)).toEqual(["sst_unhidden"]);
  });

  it("leaves unrelated rows untouched and in order", () => {
    const rows = [
      row({ verb: "sst_status_changed", id: 1 }),
      row({ verb: "attempt_logged", id: 2 }),
    ];
    const out = suppressHideUnhide(rows);
    expect(out.map((r) => r.id)).toEqual([1, 2]);
  });
});
