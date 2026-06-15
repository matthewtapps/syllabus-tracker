import { describe, expect, test } from "vitest";
import { viewContextHref, rowToViewContext, activitySurface } from "./view-context";

describe("viewContextHref", () => {
  test("library context without video", () => {
    expect(
      viewContextHref({ kind: "library", technique: { type: "technique", id: 9 } }),
    ).toBe("/library?focus=technique:9");
  });
  test("library context with video", () => {
    expect(
      viewContextHref({
        kind: "library",
        technique: { type: "technique", id: 9 },
        video: { type: "video", id: 7 },
      }),
    ).toBe("/library?focus=technique:9&video=7");
  });
  test("syllabus context without video", () => {
    expect(
      viewContextHref({
        kind: "syllabus",
        student: { type: "student", id: 4 },
        syllabus: { type: "syllabus", id: 2 },
        sst: { type: "sst", id: 42 },
      }),
    ).toBe("/student/4/syllabi/2?focus=sst:42");
  });
  test("syllabus context with video", () => {
    expect(
      viewContextHref({
        kind: "syllabus",
        student: { type: "student", id: 4 },
        syllabus: { type: "syllabus", id: 2 },
        sst: { type: "sst", id: 42 },
        video: { type: "video", id: 7 },
      }),
    ).toBe("/student/4/syllabi/2?focus=sst:42&video=7");
  });
});

describe("rowToViewContext", () => {
  test("video_watched with syllabus context", () => {
    expect(
      rowToViewContext({
        verb: "video_watched",
        context_kind: "syllabus",
        target_student_id: 4,
        syllabus_id: 2,
        sst_id: 42,
        technique_id: 9,
        video_id: 7,
      }),
    ).toEqual({
      kind: "syllabus",
      student: { type: "student", id: 4 },
      syllabus: { type: "syllabus", id: 2 },
      sst: { type: "sst", id: 42 },
      video: { type: "video", id: 7 },
    });
  });
  test("video_watched with library context", () => {
    expect(
      rowToViewContext({
        verb: "video_watched",
        context_kind: "library",
        target_student_id: 4,
        syllabus_id: null,
        sst_id: null,
        technique_id: 9,
        video_id: 7,
      }),
    ).toEqual({
      kind: "library",
      technique: { type: "technique", id: 9 },
      video: { type: "video", id: 7 },
    });
  });
  test("video_added (fanned out, no context_kind) resolves to the library technique", () => {
    expect(
      rowToViewContext({
        verb: "video_added",
        context_kind: null,
        target_student_id: 4,
        syllabus_id: null,
        sst_id: null,
        technique_id: 9,
        video_id: 7,
      }),
    ).toEqual({
      kind: "library",
      technique: { type: "technique", id: 9 },
      video: { type: "video", id: 7 },
    });
  });
  test("video_watched with no resolvable context returns null", () => {
    expect(
      rowToViewContext({
        verb: "video_watched",
        context_kind: null,
        target_student_id: 4,
        syllabus_id: null,
        sst_id: null,
        technique_id: null,
        video_id: 7,
      }),
    ).toBeNull();
  });
  test("attempt_logged maps to syllabus context", () => {
    expect(
      rowToViewContext({
        verb: "attempt_logged",
        context_kind: null,
        target_student_id: 4,
        syllabus_id: 2,
        sst_id: 42,
        technique_id: 9,
        video_id: null,
      }),
    ).toEqual({
      kind: "syllabus",
      student: { type: "student", id: 4 },
      syllabus: { type: "syllabus", id: 2 },
      sst: { type: "sst", id: 42 },
    });
  });
  test("attempt_logged without syllabus columns returns null", () => {
    expect(
      rowToViewContext({
        verb: "attempt_logged",
        context_kind: null,
        target_student_id: 4,
        syllabus_id: null,
        sst_id: null,
        technique_id: 9,
        video_id: null,
      }),
    ).toBeNull();
  });
  test("thread_comment_posted with syllabus context maps to the sst", () => {
    expect(
      rowToViewContext({
        verb: "thread_comment_posted",
        context_kind: "syllabus",
        target_student_id: 4,
        syllabus_id: 2,
        sst_id: 42,
        technique_id: 9,
        video_id: null,
      }),
    ).toEqual({
      kind: "syllabus",
      student: { type: "student", id: 4 },
      syllabus: { type: "syllabus", id: 2 },
      sst: { type: "sst", id: 42 },
    });
  });
  test("thread_comment_posted with library context maps to the technique", () => {
    expect(
      rowToViewContext({
        verb: "thread_comment_posted",
        context_kind: "library",
        target_student_id: null,
        syllabus_id: null,
        sst_id: null,
        technique_id: 9,
        video_id: null,
      }),
    ).toEqual({
      kind: "library",
      technique: { type: "technique", id: 9 },
    });
  });
  test("thread_comment_posted broadcast sst (no student) returns null", () => {
    expect(
      rowToViewContext({
        verb: "thread_comment_posted",
        context_kind: "syllabus",
        target_student_id: null,
        syllabus_id: 2,
        sst_id: 42,
        technique_id: 9,
        video_id: null,
      }),
    ).toBeNull();
  });
  test("unrelated verb returns null", () => {
    expect(
      rowToViewContext({
        verb: "syllabus_assigned",
        context_kind: null,
        target_student_id: 4,
        syllabus_id: 2,
        sst_id: null,
        technique_id: null,
        video_id: null,
      }),
    ).toBeNull();
  });
});

describe("activitySurface", () => {
  test("syllabus action shows the syllabus name", () => {
    expect(
      activitySurface({
        verb: "attempt_logged",
        context_kind: null,
        target_student_id: 4,
        syllabus_id: 2,
        sst_id: 42,
        technique_id: 9,
        video_id: null,
        syllabus_name: "Blue Belt",
      }),
    ).toEqual({ kind: "syllabus", label: "Blue Belt" });
  });
  test("library video shows the global library label", () => {
    expect(
      activitySurface({
        verb: "video_watched",
        context_kind: "library",
        target_student_id: 4,
        syllabus_id: null,
        sst_id: null,
        technique_id: 9,
        video_id: 7,
        syllabus_name: null,
      }),
    ).toEqual({ kind: "library", label: "Global Technique Library" });
  });
  test("no resolvable surface returns null", () => {
    expect(
      activitySurface({
        verb: "syllabus_assigned",
        context_kind: null,
        target_student_id: 4,
        syllabus_id: 2,
        sst_id: null,
        technique_id: null,
        video_id: null,
        syllabus_name: "Blue Belt",
      }),
    ).toBeNull();
  });
});
