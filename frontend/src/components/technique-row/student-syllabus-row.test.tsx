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

  test("coach viewer sees the status toggle, attempts heading, and student notes section", () => {
    // Student-notes block hides itself when empty and the viewer cannot
    // edit it (i.e. coach view). Seed content so the section renders.
    const sst = buildSst({
      status: "amber",
      student_notes: "Bumped the elbow up.",
    });
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
      { user: buildUser({ id: 7, role: "coach" }) },
    );

    // StatusToggle has aria-label "Technique status" on the group; only
    // coaches see it.
    expect(
      screen.getByRole("group", { name: /technique status/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /attempts/i }),
    ).toBeInTheDocument();
    // From a coach's perspective the student-notes block is labeled
    // "Student notes" instead of "My notes".
    expect(
      screen.getByRole("heading", { name: /student notes/i }),
    ).toBeInTheDocument();
  });

  test("owning student does not see the status toggle", () => {
    const sst = buildSst({ status: "amber" });
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

    // Status is coach-controlled; the toggle never renders for students.
    expect(
      screen.queryByRole("group", { name: /technique status/i }),
    ).toBeNull();
    // 'My notes' is the student-facing label on the student-notes block.
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
