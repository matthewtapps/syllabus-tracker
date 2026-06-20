/**
 * ActivityTileHeader rendering tests (browser project).
 *
 * Verifies the breadcrumb renders actor / target / surface / technique as
 * individual links for a coach viewer on the gym feed, the caption is the
 * minimal verb (no repeated technique name) with a status dot, and the target
 * segment is omitted on a single-student surface. Runs in CI's Chromium only.
 */
import { describe, expect, test } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders, buildUser } from "@/test/render";
import { ActivityTileHeader } from "./activity-tile-header";
import type { ActivityRow } from "@/lib/activity-line";

function row(overrides: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id: 1,
    occurred_at: new Date().toISOString(),
    verb: "sst_status_changed",
    actor_user_id: 2,
    actor_name: "Coach Dave",
    target_student_id: 4,
    target_student_name: "Jon Sharp",
    technique_id: 5,
    technique_name: "Top Turtle",
    syllabus_id: 7,
    syllabus_name: "Blue Belt Syllabus",
    sst_id: 42,
    video_id: null,
    video_title: null,
    payload_json: JSON.stringify({ from: "red", to: "amber" }),
    unread: false,
    context_kind: "syllabus",
    thread_id: null,
    camp_id: null,
    camp_name: null,
    comment_count: 0,
    ...overrides,
  };
}

describe("ActivityTileHeader", () => {
  test("gym scope renders actor, target, and surface as individual links plus a minimal caption", () => {
    renderWithProviders(
      <ActivityTileHeader row={row()} scope={{ kind: "gym" }} />,
      { user: buildUser({ id: 99, role: "coach" }) },
    );

    expect(screen.getByRole("link", { name: "Coach Dave" }).getAttribute("href")).toBe("/student/2");
    expect(screen.getByRole("link", { name: "Jon Sharp" }).getAttribute("href")).toBe("/student/4");
    // Surface crumb links to the bare syllabus root (no focus token).
    const surface = screen.getByRole("link", { name: "Blue Belt Syllabus" });
    expect(surface.getAttribute("href")).toBe("/student/4/syllabi/7");
    // The technique is now its own breadcrumb crumb, deep-linked to the row.
    const technique = screen.getByRole("link", { name: "Top Turtle" });
    expect(technique.getAttribute("href")).toContain("focus=");

    // Caption is the minimal verb plus the status label; the technique name is
    // NOT repeated in the caption (the breadcrumb carries it). The caption text
    // spans an icon + text + dot + label, so match the paragraph's text content.
    const caption = screen.getByText(/Set to/);
    expect(caption.textContent).toMatch(/Set to/);
    expect(caption.textContent).toMatch(/Doing/);
    expect(caption.textContent).not.toMatch(/Top Turtle/);
    expect(document.querySelector(".bg-status-amber")).not.toBeNull();
  });

  test("single-student scope omits the target segment", () => {
    renderWithProviders(
      <ActivityTileHeader row={row()} scope={{ kind: "student", studentId: 4 }} />,
      { user: buildUser({ id: 99, role: "coach" }) },
    );
    expect(screen.getByRole("link", { name: "Coach Dave" })).toBeInTheDocument();
    expect(screen.queryByText("Jon Sharp")).toBeNull();
  });
});
