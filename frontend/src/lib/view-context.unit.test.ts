import { describe, expect, it, test } from "vitest";
import { viewContextHref, rowToViewContext, activitySurface } from "./view-context";
import { parseFocusToken, refToken } from "./entity-ref";

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
        camp_id: null,
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
        camp_id: null,
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
        camp_id: null,
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
        camp_id: null,
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
        camp_id: null,
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
        camp_id: null,
      }),
    ).toBeNull();
  });
  test("sst_added with full ids maps to the syllabus context", () => {
    expect(
      rowToViewContext({
        verb: "sst_added",
        context_kind: null,
        target_student_id: 4,
        syllabus_id: 2,
        sst_id: 42,
        technique_id: 9,
        video_id: null,
        camp_id: null,
      }),
    ).toEqual({
      kind: "syllabus",
      student: { type: "student", id: 4 },
      syllabus: { type: "syllabus", id: 2 },
      sst: { type: "sst", id: 42 },
    });
  });
  test("sst_added without sst_id returns null", () => {
    expect(
      rowToViewContext({
        verb: "sst_added",
        context_kind: null,
        target_student_id: 4,
        syllabus_id: 2,
        sst_id: null,
        technique_id: 9,
        video_id: null,
        camp_id: null,
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
        camp_id: null,
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
        camp_id: null,
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
        camp_id: null,
      }),
    ).toBeNull();
  });
  test("unrelated verb returns null", () => {
    expect(
      rowToViewContext({
        verb: "technique_pinned",
        context_kind: null,
        target_student_id: 4,
        syllabus_id: 2,
        sst_id: null,
        technique_id: null,
        video_id: null,
        camp_id: null,
      }),
    ).toBeNull();
  });
  test("syllabus-wide events resolve to the student's syllabus surface", () => {
    for (const verb of ["syllabus_assigned", "syllabus_unassigned", "syllabus_graduated"]) {
      const ctx = rowToViewContext({
        verb,
        context_kind: null,
        target_student_id: 4,
        syllabus_id: 2,
        sst_id: null,
        technique_id: null,
        video_id: null,
        camp_id: null,
      });
      expect(ctx).toEqual({
        kind: "syllabus",
        student: { type: "student", id: 4 },
        syllabus: { type: "syllabus", id: 2 },
      });
      // No sst to focus: the deep link degrades to the bare surface page.
      expect(viewContextHref(ctx!)).toBe("/student/4/syllabi/2");
    }
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
        camp_id: null,
        syllabus_name: "Blue Belt",
      }),
    ).toEqual({ kind: "syllabus", label: "Blue Belt" });
  });
  test("sst_added shows the syllabus name chip", () => {
    expect(
      activitySurface({
        verb: "sst_added",
        context_kind: null,
        target_student_id: 4,
        syllabus_id: 2,
        sst_id: 42,
        technique_id: 9,
        video_id: null,
        camp_id: null,
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
        camp_id: null,
        syllabus_name: null,
      }),
    ).toEqual({ kind: "library", label: "Global Technique Library" });
  });
  test("syllabus-wide event shows the syllabus name chip", () => {
    expect(
      activitySurface({
        verb: "syllabus_graduated",
        context_kind: null,
        target_student_id: 4,
        syllabus_id: 2,
        sst_id: null,
        technique_id: null,
        video_id: null,
        camp_id: null,
        syllabus_name: "Blue Belt",
      }),
    ).toEqual({ kind: "syllabus", label: "Blue Belt" });
  });
  test("no resolvable surface returns null", () => {
    expect(
      activitySurface({
        verb: "technique_pinned",
        context_kind: null,
        target_student_id: 4,
        syllabus_id: 2,
        sst_id: null,
        technique_id: null,
        video_id: null,
        camp_id: null,
        syllabus_name: "Blue Belt",
      }),
    ).toBeNull();
  });
});

describe("camp deep links", () => {
  it("round-trips a camp EntityRef token", () => {
    expect(refToken({ type: "camp", id: 7 })).toBe("camp:7");
    expect(parseFocusToken("camp:7")).toEqual({ type: "camp", id: 7 });
  });

  it("routes a camp_created row to the camp page", () => {
    const ctx = rowToViewContext({
      verb: "camp_created",
      context_kind: "camp",
      target_student_id: 3,
      syllabus_id: null,
      sst_id: null,
      technique_id: null,
      video_id: null,
      camp_id: 7,
    });
    expect(ctx).not.toBeNull();
    expect(viewContextHref(ctx!)).toBe("/camps/7?focus=camp:7");
  });

  it("routes a camp video_added row focused on the video", () => {
    const ctx = rowToViewContext({
      verb: "video_added",
      context_kind: "camp",
      target_student_id: 3,
      syllabus_id: null,
      sst_id: null,
      technique_id: null,
      video_id: 12,
      camp_id: 7,
    });
    expect(viewContextHref(ctx!)).toBe("/camps/7?focus=camp:7&video=12");
  });
});
