import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { Accordion } from "@/components/ui/accordion";
import { TechniqueRow } from "./technique-row";
import { buildTechnique } from "@/test/fixtures";
import { buildUser, renderWithProviders } from "@/test/render";
import type { LibraryTechniqueRow } from "@/lib/api";
import type { RowContext } from "./technique-row-context";

function stubFetchOk(body: unknown = []) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function renderRow({
  technique,
  context,
  open,
  user,
}: {
  technique: LibraryTechniqueRow;
  context: RowContext;
  open: boolean;
  user: ReturnType<typeof buildUser>;
}) {
  const value = String(technique.id);
  return renderWithProviders(
    <Accordion type="single" collapsible value={open ? value : ""}>
      <TechniqueRow
        technique={technique}
        context={context}
        value={value}
        isOpen={open}
      />
    </Accordion>,
    { user },
  );
}

describe("TechniqueRow / global-library", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    fetchSpy = vi.spyOn(window, "fetch").mockImplementation(stubFetchOk());
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  test("collapsed row does not mount the expanded panel or videos block", () => {
    const technique = buildTechnique();
    renderRow({
      technique,
      context: { kind: "global-library" },
      open: false,
      user: buildUser({ role: "coach" }),
    });

    // Header (the accordion trigger) is always present.
    expect(
      screen.getByRole("button", { name: /armbar/i }),
    ).toBeInTheDocument();
    // Expanded blocks are not mounted: no Usage heading, no Videos heading,
    // no description paragraph.
    expect(screen.queryByRole("heading", { name: /videos/i })).toBeNull();
    expect(screen.queryByRole("heading", { name: /usage/i })).toBeNull();
    expect(screen.queryByText(technique.description)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("expanded row for a coach renders the edit affordance and stats heading", async () => {
    const technique = buildTechnique();
    renderRow({
      technique,
      context: { kind: "global-library" },
      open: true,
      user: buildUser({ role: "coach" }),
    });

    expect(screen.getByText(technique.description)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /edit name and description/i }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /usage/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: /videos/i })).toBeInTheDocument();
  });

  test("expanded row for a student hides the edit affordance and shows the pin button", () => {
    const technique = buildTechnique({ is_pinned: false });
    renderRow({
      technique,
      context: { kind: "global-library" },
      open: true,
      user: buildUser({ role: "student" }),
    });

    expect(screen.getByText(technique.description)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /edit name and description/i }),
    ).toBeNull();
    expect(screen.queryByRole("heading", { name: /usage/i })).toBeNull();
    expect(
      screen.getByRole("button", { name: /^pin technique$/i }),
    ).toBeInTheDocument();
  });
});

describe("TechniqueRow / student-pinned", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    fetchSpy = vi.spyOn(window, "fetch").mockImplementation(stubFetchOk());
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  test("owning student sees an Unpin button on a pinned technique", () => {
    const technique = buildTechnique({ is_pinned: true });
    renderRow({
      technique,
      context: { kind: "student-pinned", studentId: 42 },
      open: true,
      user: buildUser({ id: 42, role: "student" }),
    });

    expect(
      screen.getByRole("button", { name: /unpin technique/i }),
    ).toBeInTheDocument();
  });

  test("coach viewer of a pinned technique sees no pin/unpin control", () => {
    const technique = buildTechnique({ is_pinned: true });
    renderRow({
      technique,
      context: { kind: "student-pinned", studentId: 42 },
      open: true,
      user: buildUser({ id: 7, role: "coach" }),
    });

    expect(screen.queryByRole("button", { name: /pin technique/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /unpin technique/i }),
    ).toBeNull();
  });

  test("clicking Pin issues the optimistic POST", async () => {
    fetchSpy?.mockImplementation(
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );
    const technique = buildTechnique({ is_pinned: false });
    renderRow({
      technique,
      context: { kind: "global-library" },
      open: true,
      user: buildUser({ id: 42, role: "student" }),
    });

    fireEvent.click(screen.getByRole("button", { name: /^pin technique$/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/student/42/pinned_techniques",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });
});

describe("TechniqueRow / accordion behavior", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    fetchSpy = vi.spyOn(window, "fetch").mockImplementation(stubFetchOk());
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  test("header trigger has the right accessibility shape", () => {
    const technique = buildTechnique();
    renderRow({
      technique,
      context: { kind: "global-library" },
      open: false,
      user: buildUser({ role: "coach" }),
    });
    const trigger = screen.getByRole("button", { name: /armbar/i });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});
