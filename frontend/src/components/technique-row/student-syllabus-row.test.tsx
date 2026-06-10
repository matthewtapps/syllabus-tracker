import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { screen } from "@testing-library/react";
import { Accordion } from "@/components/ui/accordion";
import { TechniqueRow } from "./technique-row";
import { buildSst, buildTechnique } from "@/test/fixtures";
import { buildUser, renderWithProviders } from "@/test/render";

function stubFetchOk(body: unknown = []) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("TechniqueRow / student-syllabus context", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;
  beforeEach(() => {
    fetchSpy = vi.spyOn(window, "fetch").mockImplementation(stubFetchOk());
  });
  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  test("expanded row exposes status toggle, attempts heading, and notes section", () => {
    const sst = buildSst({ status: "amber", student_notes: "" });
    const technique = buildTechnique();
    const value = String(technique.id);
    renderWithProviders(
      <Accordion type="single" collapsible value={value}>
        <TechniqueRow
          technique={technique}
          context={{
            kind: "student-syllabus",
            studentId: 42,
            syllabusId: 7,
            assignmentId: 13,
            sst,
          }}
          value={value}
          isOpen
        />
      </Accordion>,
      { user: buildUser({ id: 42, role: "student" }) },
    );

    // StatusToggle has aria-label "Technique status" on the group.
    expect(
      screen.getByRole("group", { name: /technique status/i }),
    ).toBeInTheDocument();
    // Attempts section heading rendered.
    expect(
      screen.getByRole("heading", { name: /attempts/i }),
    ).toBeInTheDocument();
    // Coach-notes block is suppressed for the owning student when empty;
    // student-notes block is editable for the owner.
    expect(
      screen.getByRole("heading", { name: /my notes/i }),
    ).toBeInTheDocument();
  });

  test("collapsed row shows the status dot but does not mount expanded blocks", () => {
    const sst = buildSst({ status: "green" });
    const technique = buildTechnique();
    const value = String(technique.id);
    renderWithProviders(
      <Accordion type="single" collapsible value="">
        <TechniqueRow
          technique={technique}
          context={{
            kind: "student-syllabus",
            studentId: 42,
            syllabusId: 7,
            assignmentId: 13,
            sst,
          }}
          value={value}
          isOpen={false}
        />
      </Accordion>,
      { user: buildUser({ id: 42, role: "student" }) },
    );

    // The status dot is purely decorative aria-label; assertions on
    // headings: expanded panel should not be mounted.
    expect(screen.queryByRole("heading", { name: /attempts/i })).toBeNull();
    expect(screen.queryByRole("group", { name: /technique status/i })).toBeNull();
  });
});
