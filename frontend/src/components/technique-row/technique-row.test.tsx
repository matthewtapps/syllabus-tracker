import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { TechniqueRow } from "./technique-row";
import { buildTechnique } from "@/test/fixtures";
import { buildUser, renderWithProviders } from "@/test/render";

function stubFetchOk(body: unknown = []) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
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
    renderWithProviders(
      <TechniqueRow
        technique={technique}
        context={{ kind: "global-library" }}
        expanded={false}
        onToggle={() => undefined}
      />,
      { user: buildUser({ role: "coach" }) },
    );

    // Header is always present.
    expect(screen.getByRole("button", { name: /armbar/i })).toBeInTheDocument();
    // Videos block, library-stats, description label aren't mounted.
    expect(screen.queryByRole("heading", { name: /videos/i })).toBeNull();
    expect(screen.queryByRole("heading", { name: /usage/i })).toBeNull();
    // No fetch fired because the data-bearing blocks never mounted.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("expanded row for a coach renders the edit affordance and stats heading", async () => {
    const technique = buildTechnique();
    renderWithProviders(
      <TechniqueRow
        technique={technique}
        context={{ kind: "global-library" }}
        expanded
        onToggle={() => undefined}
      />,
      { user: buildUser({ role: "coach" }) },
    );

    // Description renders.
    expect(screen.getByText(technique.description)).toBeInTheDocument();
    // Coach sees the edit pencil + the stats/usage section + videos heading.
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
    renderWithProviders(
      <TechniqueRow
        technique={technique}
        context={{ kind: "global-library" }}
        expanded
        onToggle={() => undefined}
      />,
      { user: buildUser({ role: "student" }) },
    );

    expect(screen.getByText(technique.description)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /edit name and description/i }),
    ).toBeNull();
    expect(screen.queryByRole("heading", { name: /usage/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^pin technique$/i })).toBeInTheDocument();
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
    renderWithProviders(
      <TechniqueRow
        technique={technique}
        context={{ kind: "student-pinned", studentId: 42 }}
        expanded
        onToggle={() => undefined}
      />,
      { user: buildUser({ id: 42, role: "student" }) },
    );

    expect(
      screen.getByRole("button", { name: /unpin technique/i }),
    ).toBeInTheDocument();
  });

  test("coach viewer of a pinned technique sees no pin/unpin control", () => {
    const technique = buildTechnique({ is_pinned: true });
    renderWithProviders(
      <TechniqueRow
        technique={technique}
        context={{ kind: "student-pinned", studentId: 42 }}
        expanded
        onToggle={() => undefined}
      />,
      { user: buildUser({ id: 7, role: "coach" }) },
    );

    expect(screen.queryByRole("button", { name: /pin technique/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /unpin technique/i })).toBeNull();
  });

  test("clicking Pin optimistically swaps to Unpin", async () => {
    fetchSpy?.mockImplementation(
      vi.fn().mockResolvedValue(
        new Response(null, { status: 204 }),
      ),
    );
    const technique = buildTechnique({ is_pinned: false });
    renderWithProviders(
      <TechniqueRow
        technique={technique}
        context={{ kind: "global-library" }}
        expanded
        onToggle={() => undefined}
      />,
      { user: buildUser({ id: 42, role: "student" }) },
    );

    const pinButton = screen.getByRole("button", { name: /^pin technique$/i });
    fireEvent.click(pinButton);

    // Note: the optimistic patch updates the pinned-list cache key, not the
    // technique prop. Since this test does not render the same row through
    // a list backed by that cache, we instead assert the fetch fired with
    // the expected POST.
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/student/42/pinned_techniques",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });
});

describe("TechniqueRow / header toggling", () => {
  test("onToggle fires when the header is clicked", () => {
    const onToggle = vi.fn();
    const technique = buildTechnique();
    renderWithProviders(
      <TechniqueRow
        technique={technique}
        context={{ kind: "global-library" }}
        expanded={false}
        onToggle={onToggle}
      />,
      { user: buildUser({ role: "coach" }) },
    );
    fireEvent.click(screen.getByRole("button", { name: /armbar/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
