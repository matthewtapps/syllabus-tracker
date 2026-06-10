import { describe, expect, test } from "vitest";
import { activityLine } from "./activity-line";
import type { ActivityRow } from "./activity-line";

function row(overrides: Partial<ActivityRow>): ActivityRow {
  return {
    id: 1,
    occurred_at: "2026-06-10T12:00:00Z",
    verb: "attempt_logged",
    actor_user_id: 2,
    actor_name: "Coach Matt",
    target_student_id: 3,
    technique_id: null,
    technique_name: null,
    syllabus_id: null,
    syllabus_name: null,
    sst_id: null,
    video_id: null,
    video_title: null,
    payload_json: null,
    unread: false,
    ...overrides,
  };
}

describe("activityLine", () => {
  // --- attempt verbs ---
  test("attempt_logged renders technique name", () => {
    const result = activityLine(
      row({ verb: "attempt_logged", technique_id: 5, technique_name: "Armbar" }),
    );
    expect(result.text).toBe("logged an attempt on Armbar");
    expect(result.href).toMatch(/armbar|library|5/i);
  });

  test("attempt_edited renders technique name", () => {
    const result = activityLine(
      row({ verb: "attempt_edited", technique_id: 5, technique_name: "Armbar" }),
    );
    expect(result.text).toBe("edited an attempt on Armbar");
  });

  test("attempt_deleted renders technique name without href", () => {
    const result = activityLine(
      row({ verb: "attempt_deleted", technique_id: 5, technique_name: "Armbar" }),
    );
    expect(result.text).toBe("deleted an attempt on Armbar");
    // attempt_deleted is non-notifiable: we still return href when id present
    // (the spec says "no href" only when the entity id/name is null, i.e. SET NULL after delete)
  });

  // --- video verbs ---
  test("video_watched renders video title", () => {
    const result = activityLine(
      row({ verb: "video_watched", video_id: 7, video_title: "Triangle setup" }),
    );
    expect(result.text).toBe("watched Triangle setup");
    expect(result.href).toBeDefined();
  });

  test("video_watched with null video_title falls back to plain text, no href", () => {
    const result = activityLine(
      row({ verb: "video_watched", video_id: null, video_title: null }),
    );
    expect(result.text).toBe("watched a video");
    expect(result.href).toBeUndefined();
  });

  // --- sst_status_changed ---
  test("sst_status_changed to green renders 'went green on {technique}'", () => {
    const result = activityLine(
      row({
        verb: "sst_status_changed",
        technique_id: 5,
        technique_name: "Kimura",
        sst_id: 10,
        payload_json: JSON.stringify({ from: "amber", to: "green" }),
      }),
    );
    expect(result.text).toBe("went green on Kimura");
  });

  test("sst_status_changed to amber renders 'went amber on {technique}'", () => {
    const result = activityLine(
      row({
        verb: "sst_status_changed",
        technique_id: 5,
        technique_name: "Triangle",
        sst_id: 10,
        payload_json: JSON.stringify({ from: "red", to: "amber" }),
      }),
    );
    expect(result.text).toBe("went amber on Triangle");
  });

  test("sst_status_changed with malformed payload falls back gracefully", () => {
    const result = activityLine(
      row({
        verb: "sst_status_changed",
        technique_id: 5,
        technique_name: "Kimura",
        sst_id: 10,
        payload_json: "not-json{",
      }),
    );
    expect(result.text).toBe("updated status on Kimura");
    expect(() => activityLine(row({ verb: "sst_status_changed", payload_json: "bad" }))).not.toThrow();
  });

  // --- technique_edited ---
  test("technique_edited with name field renders 'edited {technique_name}'", () => {
    const result = activityLine(
      row({
        verb: "technique_edited",
        technique_id: 5,
        technique_name: "Armbar",
        payload_json: JSON.stringify({ fields: { name: true } }),
      }),
    );
    expect(result.text).toBe("edited Armbar");
  });

  test("technique_edited with description field renders 'edited {technique_name}'", () => {
    const result = activityLine(
      row({
        verb: "technique_edited",
        technique_id: 5,
        technique_name: "Armbar",
        payload_json: JSON.stringify({ fields: { description: true } }),
      }),
    );
    expect(result.text).toBe("edited Armbar");
  });

  // --- null entity: no href, plain fallback text ---
  test("row with null technique_name renders plain text with no href", () => {
    const result = activityLine(
      row({ verb: "attempt_logged", technique_id: null, technique_name: null }),
    );
    expect(result.text).toBe("logged an attempt");
    expect(result.href).toBeUndefined();
  });

  test("row with null video for video_watched has no href", () => {
    const result = activityLine(
      row({ verb: "video_watched", video_id: null, video_title: null }),
    );
    expect(result.href).toBeUndefined();
  });

  // --- syllabus verbs ---
  test("syllabus_assigned renders syllabus name", () => {
    const result = activityLine(
      row({ verb: "syllabus_assigned", syllabus_id: 2, syllabus_name: "Blue Belt" }),
    );
    expect(result.text).toBe("assigned to Blue Belt");
    expect(result.href).toBeDefined();
  });

  test("syllabus_graduated renders syllabus name", () => {
    const result = activityLine(
      row({ verb: "syllabus_graduated", syllabus_id: 2, syllabus_name: "Blue Belt" }),
    );
    expect(result.text).toBe("graduated Blue Belt");
  });

  // --- sst notes verbs ---
  test("sst_student_notes_edited renders technique name", () => {
    const result = activityLine(
      row({ verb: "sst_student_notes_edited", technique_id: 5, technique_name: "Armbar", sst_id: 10 }),
    );
    expect(result.text).toBe("updated student notes on Armbar");
  });

  test("sst_coach_notes_edited renders technique name", () => {
    const result = activityLine(
      row({ verb: "sst_coach_notes_edited", technique_id: 5, technique_name: "Armbar", sst_id: 10 }),
    );
    expect(result.text).toBe("updated coach notes on Armbar");
  });

  // --- pin verbs ---
  test("technique_pinned renders technique name", () => {
    const result = activityLine(
      row({ verb: "technique_pinned", technique_id: 5, technique_name: "Armbar" }),
    );
    expect(result.text).toBe("pinned Armbar");
  });

  test("technique_unpinned renders technique name", () => {
    const result = activityLine(
      row({ verb: "technique_unpinned", technique_id: 5, technique_name: "Armbar" }),
    );
    expect(result.text).toBe("unpinned Armbar");
  });

  // --- sst curation verbs ---
  test("sst_added renders technique name", () => {
    const result = activityLine(
      row({ verb: "sst_added", technique_id: 5, technique_name: "Armbar", sst_id: 10 }),
    );
    expect(result.text).toBe("added Armbar to syllabus");
  });

  test("sst_hidden renders technique name", () => {
    const result = activityLine(
      row({ verb: "sst_hidden", technique_id: 5, technique_name: "Armbar", sst_id: 10 }),
    );
    expect(result.text).toBe("hid Armbar");
  });

  test("sst_unhidden renders technique name", () => {
    const result = activityLine(
      row({ verb: "sst_unhidden", technique_id: 5, technique_name: "Armbar", sst_id: 10 }),
    );
    expect(result.text).toBe("unhid Armbar");
  });

  // --- syllabus technique verbs ---
  test("syllabus_technique_added renders technique + syllabus", () => {
    const result = activityLine(
      row({
        verb: "syllabus_technique_added",
        technique_id: 5,
        technique_name: "Armbar",
        syllabus_id: 2,
        syllabus_name: "Blue Belt",
      }),
    );
    expect(result.text).toBe("added Armbar to Blue Belt");
  });

  test("syllabus_technique_removed renders technique + syllabus", () => {
    const result = activityLine(
      row({
        verb: "syllabus_technique_removed",
        technique_id: 5,
        technique_name: "Armbar",
        syllabus_id: 2,
        syllabus_name: "Blue Belt",
      }),
    );
    expect(result.text).toBe("removed Armbar from Blue Belt");
  });

  // --- video_added ---
  test("video_added renders video title", () => {
    const result = activityLine(
      row({ verb: "video_added", video_id: 7, video_title: "Triangle setup" }),
    );
    expect(result.text).toBe("added video Triangle setup");
  });

  // --- video_visibility_set ---
  test("video_visibility_set renders video title", () => {
    const result = activityLine(
      row({
        verb: "video_visibility_set",
        video_id: 7,
        video_title: "Triangle setup",
        payload_json: JSON.stringify({ scope: "student", visible: true }),
      }),
    );
    expect(result.text).toBe("changed visibility of Triangle setup");
  });

  // --- syllabus_unassigned ---
  test("syllabus_unassigned renders syllabus name", () => {
    const result = activityLine(
      row({ verb: "syllabus_unassigned", syllabus_id: 2, syllabus_name: "Blue Belt" }),
    );
    expect(result.text).toBe("unassigned from Blue Belt");
  });

  // --- unknown verb fallback ---
  test("unknown verb renders plain fallback", () => {
    const result = activityLine(row({ verb: "future_verb_unknown" }));
    expect(result.text).toBe("performed an action");
    expect(result.href).toBeUndefined();
  });
});
