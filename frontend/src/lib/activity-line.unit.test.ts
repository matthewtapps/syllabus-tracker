import { describe, expect, test } from "vitest";
import { activityLine } from "./activity-line";
import type { ActivityLine, ActivityRow } from "./activity-line";

function lineText(line: ActivityLine): string {
  return line.subject ? `${line.verb} ${line.subject}` : line.verb;
}

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
    context_kind: null,
    thread_id: null,
    ...overrides,
  };
}

describe("activityLine", () => {
  // --- attempt verbs ---
  test("attempt_logged renders technique name", () => {
    const result = activityLine(
      row({ verb: "attempt_logged", technique_id: 5, technique_name: "Armbar" }),
    );
    expect(lineText(result)).toBe("logged an attempt on Armbar");
    // No full routing context (no syllabus_id/sst_id) so href is undefined here;
    // routing tests below cover the deep-link path.
    expect(result.href).toBeUndefined();
  });

  test("attempt_edited renders technique name", () => {
    const result = activityLine(
      row({ verb: "attempt_edited", technique_id: 5, technique_name: "Armbar" }),
    );
    expect(lineText(result)).toBe("edited an attempt on Armbar");
  });

  test("attempt_deleted renders technique name without href", () => {
    const result = activityLine(
      row({ verb: "attempt_deleted", technique_id: 5, technique_name: "Armbar" }),
    );
    expect(lineText(result)).toBe("deleted an attempt on Armbar");
  });

  test("attempt_deleted routes to the syllabus when context present", () => {
    const result = activityLine(
      row({
        verb: "attempt_deleted",
        technique_id: 5,
        technique_name: "Armbar",
        target_student_id: 4,
        syllabus_id: 2,
        sst_id: 42,
      }),
    );
    expect(result.href).toBe("/student/4/syllabi/2?focus=sst:42");
  });

  // --- video verbs ---
  test("video_watched renders video title", () => {
    const result = activityLine(
      row({ verb: "video_watched", video_id: 7, video_title: "Triangle setup" }),
    );
    expect(lineText(result)).toBe("watched Triangle setup");
    // No technique_id and no context_kind means no resolvable context; routing
    // tests below cover the cases that produce a real href.
    expect(result.href).toBeUndefined();
  });

  test("video_watched with null video_title falls back to plain text, no href", () => {
    const result = activityLine(
      row({ verb: "video_watched", video_id: null, video_title: null }),
    );
    expect(lineText(result)).toBe("watched a video");
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
    expect(lineText(result)).toBe("went green on Kimura");
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
    expect(lineText(result)).toBe("went amber on Triangle");
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
    expect(lineText(result)).toBe("updated status on Kimura");
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
    expect(lineText(result)).toBe("edited Armbar");
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
    expect(lineText(result)).toBe("edited Armbar");
  });

  // --- null entity: no href, plain fallback text ---
  test("row with null technique_name renders plain text with no href", () => {
    const result = activityLine(
      row({ verb: "attempt_logged", technique_id: null, technique_name: null }),
    );
    expect(lineText(result)).toBe("logged an attempt");
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
    expect(lineText(result)).toBe("assigned to Blue Belt");
    expect(result.href).toBeDefined();
  });

  test("syllabus_graduated renders syllabus name", () => {
    const result = activityLine(
      row({ verb: "syllabus_graduated", syllabus_id: 2, syllabus_name: "Blue Belt" }),
    );
    expect(lineText(result)).toBe("graduated Blue Belt");
  });

  // --- sst notes verbs ---
  test("sst_student_notes_edited renders technique name", () => {
    const result = activityLine(
      row({ verb: "sst_student_notes_edited", technique_id: 5, technique_name: "Armbar", sst_id: 10 }),
    );
    expect(lineText(result)).toBe("updated student notes on Armbar");
  });

  test("sst_coach_notes_edited renders technique name", () => {
    const result = activityLine(
      row({ verb: "sst_coach_notes_edited", technique_id: 5, technique_name: "Armbar", sst_id: 10 }),
    );
    expect(lineText(result)).toBe("updated coach notes on Armbar");
  });

  // --- pin verbs ---
  test("technique_pinned renders technique name", () => {
    const result = activityLine(
      row({ verb: "technique_pinned", technique_id: 5, technique_name: "Armbar" }),
    );
    expect(lineText(result)).toBe("pinned Armbar");
  });

  test("technique_unpinned renders technique name", () => {
    const result = activityLine(
      row({ verb: "technique_unpinned", technique_id: 5, technique_name: "Armbar" }),
    );
    expect(lineText(result)).toBe("unpinned Armbar");
  });

  // --- sst curation verbs ---
  test("sst_added renders technique name", () => {
    const result = activityLine(
      row({ verb: "sst_added", technique_id: 5, technique_name: "Armbar", sst_id: 10, syllabus_id: 2 }),
    );
    expect(lineText(result)).toBe("added Armbar to syllabus");
    expect(result.href).toBe("/syllabi/2");
  });

  test("sst_hidden renders technique name", () => {
    const result = activityLine(
      row({ verb: "sst_hidden", technique_id: 5, technique_name: "Armbar", sst_id: 10 }),
    );
    expect(lineText(result)).toBe("hid Armbar");
  });

  test("sst_unhidden renders technique name", () => {
    const result = activityLine(
      row({ verb: "sst_unhidden", technique_id: 5, technique_name: "Armbar", sst_id: 10 }),
    );
    expect(lineText(result)).toBe("unhid Armbar");
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
    expect(lineText(result)).toBe("added Armbar to Blue Belt");
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
    expect(lineText(result)).toBe("removed Armbar from Blue Belt");
  });

  // --- video_added ---
  test("video_added renders video title", () => {
    const result = activityLine(
      row({ verb: "video_added", video_id: 7, video_title: "Triangle setup" }),
    );
    expect(lineText(result)).toBe("added video Triangle setup");
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
    expect(lineText(result)).toBe("changed visibility of Triangle setup");
  });

  // --- syllabus_unassigned ---
  test("syllabus_unassigned renders syllabus name", () => {
    const result = activityLine(
      row({ verb: "syllabus_unassigned", syllabus_id: 2, syllabus_name: "Blue Belt" }),
    );
    expect(lineText(result)).toBe("unassigned from Blue Belt");
  });

  // --- thread verbs ---
  test("thread_comment_posted with technique name renders 'commented on {technique}'", () => {
    const result = activityLine(
      row({ verb: "thread_comment_posted", technique_id: 5, technique_name: "X-guard", thread_id: 7 }),
    );
    expect(result.verb).toBe("commented on");
    expect(result.subject).toBe("X-guard");
    expect(lineText(result)).toBe("commented on X-guard");
  });

  test("thread_comment_posted with video title renders 'commented on {video}'", () => {
    const result = activityLine(
      row({ verb: "thread_comment_posted", video_id: 3, video_title: "Triangle setup", thread_id: 8 }),
    );
    expect(result.verb).toBe("commented on");
    expect(result.subject).toBe("Triangle setup");
  });

  test("thread_comment_posted with no entity renders 'commented on' with no subject", () => {
    const result = activityLine(
      row({ verb: "thread_comment_posted", thread_id: 9 }),
    );
    expect(result.verb).toBe("commented on");
    expect(result.subject).toBeUndefined();
    expect(result.href).toBeUndefined();
  });

  // --- unknown verb fallback ---
  test("unknown verb renders plain fallback", () => {
    const result = activityLine(row({ verb: "future_verb_unknown" }));
    expect(lineText(result)).toBe("performed an action");
    expect(result.href).toBeUndefined();
  });

  // --- deep-link routing ---
  test("attempt_logged routes to the student's syllabus with sst focus", () => {
    const result = activityLine(
      row({
        verb: "attempt_logged",
        technique_id: 5,
        technique_name: "Armbar",
        target_student_id: 4,
        syllabus_id: 2,
        sst_id: 42,
      }),
    );
    expect(result.verb).toBe("logged an attempt on");
    expect(result.subject).toBe("Armbar");
    expect(result.href).toBe("/student/4/syllabi/2?focus=sst:42");
  });

  test("sst_student_notes_edited routes to the syllabus", () => {
    const result = activityLine(
      row({
        verb: "sst_student_notes_edited",
        technique_id: 5,
        technique_name: "Armbar",
        target_student_id: 4,
        syllabus_id: 2,
        sst_id: 42,
      }),
    );
    expect(result.href).toBe("/student/4/syllabi/2?focus=sst:42");
  });

  test("video_watched in a syllabus routes to the syllabus with video", () => {
    const result = activityLine(
      row({
        verb: "video_watched",
        video_id: 7,
        video_title: "Triangle setup",
        context_kind: "syllabus",
        target_student_id: 4,
        syllabus_id: 2,
        sst_id: 42,
        technique_id: 5,
      }),
    );
    expect(result.href).toBe("/student/4/syllabi/2?focus=sst:42&video=7");
  });

  test("video_watched in the library routes to the library with video", () => {
    const result = activityLine(
      row({
        verb: "video_watched",
        video_id: 7,
        video_title: "Triangle setup",
        context_kind: "library",
        technique_id: 5,
      }),
    );
    expect(result.href).toBe("/library?focus=technique:5&video=7");
  });

  test("technique_pinned routes to the student's pinned page", () => {
    const result = activityLine(
      row({
        verb: "technique_pinned",
        technique_id: 5,
        technique_name: "Armbar",
        target_student_id: 4,
      }),
    );
    expect(result.href).toBe("/student/4/pinned");
  });

  test("syllabus_assigned still routes to the coach syllabus view", () => {
    const result = activityLine(
      row({ verb: "syllabus_assigned", syllabus_id: 2, syllabus_name: "Blue Belt" }),
    );
    expect(result.href).toBe("/syllabi/2");
  });
});
