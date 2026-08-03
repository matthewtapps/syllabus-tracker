import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { screen } from "@testing-library/react";
import { TechniqueRowTeaser } from "./technique-row-teaser";
import { buildSst, buildTechnique } from "@/test/fixtures";
import { buildUser, renderWithProviders } from "@/test/render";

function stubFetchOk() {
  return vi.fn().mockResolvedValue(
    new Response("[]", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("TechniqueRowTeaser", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    fetchSpy = vi.spyOn(window, "fetch").mockImplementation(stubFetchOk());
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  test("renders the technique name as a link to it in its surface", () => {
    renderWithProviders(
      <TechniqueRowTeaser
        technique={buildTechnique()}
        context={{ kind: "global-library" }}
        href="/library?focus=technique:1"
      />,
      { user: buildUser({ role: "student" }) },
    );

    const link = screen.getByRole("link", { name: /armbar/i });
    expect(link).toHaveAttribute("href", "/library?focus=technique:1");
  });

  test("carries no aria-expanded, and points right rather than unfolding", () => {
    const { container } = renderWithProviders(
      <TechniqueRowTeaser
        technique={buildTechnique()}
        context={{ kind: "global-library" }}
        href="/library?focus=technique:1"
      />,
      { user: buildUser({ role: "student" }) },
    );

    expect(container.querySelectorAll("[aria-expanded]")).toHaveLength(0);
    // The tap opens a separate surface, so the caret must not read as an
    // in-place disclosure.
    expect(container.querySelector(".lucide-chevron-right")).not.toBeNull();
    expect(container.querySelector(".lucide-chevron-down")).toBeNull();
  });

  test("renders no curation chrome for a student on their own pinned surface", () => {
    renderWithProviders(
      <TechniqueRowTeaser
        technique={buildTechnique({ is_pinned: true })}
        context={{ kind: "student-pinned", studentId: 42 }}
        href="/library?focus=technique:1"
      />,
      { user: buildUser({ id: 42, role: "student" }) },
    );

    expect(screen.queryByRole("button", { name: /pin technique/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /unpin technique/i }),
    ).toBeNull();
  });

  test("renders no hidden toggle or remove button for a coach on a syllabus row", () => {
    const technique = buildTechnique();
    renderWithProviders(
      <TechniqueRowTeaser
        technique={technique}
        context={{
          kind: "student-syllabus",
          studentId: 42,
          syllabusId: 7,
          assignmentId: 13,
          sst: buildSst(),
          graduatedAt: null,
        }}
        href="/library?focus=technique:1"
      />,
      { user: buildUser({ id: 7, role: "coach" }) },
    );

    expect(screen.queryByRole("button", { name: /hide/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
    // The whole row is exactly one control, and it is a link.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});
