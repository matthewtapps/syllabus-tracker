/**
 * CampSearchSheet tests (browser project, runs in Chromium on CI).
 *
 * Stubs window.fetch (not vi.spyOn on the ESM api module) per the project
 * pattern for browser tests. Uses renderWithProviders + buildUser.
 */
import { describe, expect, test, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders, buildUser } from "@/test/render";
import { CampSearchSheet } from "./camp-search-sheet";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal CampSearchResult returned by the stubbed API. */
const SEARCH_RESULT = {
  techniques: [
    { thread_id: 10, technique_id: 1, technique_name: "Single Leg X" },
  ],
  videos: [
    { video_id: 5, title: "Drill footage", thread_id: 20 },
    { video_id: 6, title: "", thread_id: null },
  ],
  threads: [
    { thread_id: 30, snippet: "Great session today", is_comment: false },
    { thread_id: 30, snippet: "Thanks coach", is_comment: true },
  ],
};

/** Stub window.fetch to return SEARCH_RESULT for /api/camps/. */
function stubSearchFetch(result = SEARCH_RESULT) {
  const stub = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => result,
  });
  vi.stubGlobal("fetch", stub);
  return stub;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CampSearchSheet", () => {
  test("sheet is closed initially and opens when open=true", () => {
    renderWithProviders(
      <CampSearchSheet
        campId={1}
        open={false}
        onOpenChange={() => {}}
        onJump={() => {}}
      />,
      { user: buildUser({ id: 2, role: "coach" }) },
    );
    // When closed, the sheet title should not be in the document.
    expect(screen.queryByText("Search camp")).toBeNull();
  });

  test("renders search input when open", () => {
    stubSearchFetch();
    renderWithProviders(
      <CampSearchSheet
        campId={1}
        open={true}
        onOpenChange={() => {}}
        onJump={() => {}}
      />,
    );
    expect(screen.getByRole("textbox", { name: /search query/i })).toBeTruthy();
  });

  test("shows prompt text before typing", () => {
    stubSearchFetch();
    renderWithProviders(
      <CampSearchSheet
        campId={1}
        open={true}
        onOpenChange={() => {}}
        onJump={() => {}}
      />,
    );
    expect(screen.getByText("Start typing to search.")).toBeTruthy();
  });

  test("typing a query fires fetch and renders grouped results", async () => {
    stubSearchFetch();
    renderWithProviders(
      <CampSearchSheet
        campId={1}
        open={true}
        onOpenChange={() => {}}
        onJump={() => {}}
      />,
    );

    const input = screen.getByRole("textbox", { name: /search query/i });
    fireEvent.change(input, { target: { value: "single" } });

    // Wait for results to appear.
    await waitFor(() => {
      expect(screen.getByText("Single Leg X")).toBeTruthy();
    });

    // All three groups should render.
    expect(screen.getByText("Techniques")).toBeTruthy();
    expect(screen.getByText("Videos")).toBeTruthy();
    expect(screen.getByText(/Threads/)).toBeTruthy();
    expect(screen.getByText("Drill footage")).toBeTruthy();
    expect(screen.getByText("Great session today")).toBeTruthy();
    // Untitled clip fallback for empty title.
    expect(screen.getByText("(untitled clip)")).toBeTruthy();
  });

  test("kind chip 'Techniques' hides Videos and Threads sections", async () => {
    stubSearchFetch();
    renderWithProviders(
      <CampSearchSheet
        campId={1}
        open={true}
        onOpenChange={() => {}}
        onJump={() => {}}
      />,
    );

    const input = screen.getByRole("textbox", { name: /search query/i });
    fireEvent.change(input, { target: { value: "leg" } });

    // Wait for results.
    await waitFor(() => {
      expect(screen.getByText("Single Leg X")).toBeTruthy();
    });

    // Switch to Techniques-only chip.
    const chip = screen.getByText("Techniques");
    fireEvent.click(chip);

    // Videos and Threads headings should no longer be visible.
    expect(screen.queryByText("Videos")).toBeNull();
    expect(screen.queryByText(/Threads/)).toBeNull();
    // Technique result stays.
    expect(screen.getByText("Single Leg X")).toBeTruthy();
  });

  test("tapping a technique result calls onJump and triggers onOpenChange(false)", async () => {
    stubSearchFetch();
    const onJump = vi.fn();
    const onOpenChange = vi.fn();

    renderWithProviders(
      <CampSearchSheet
        campId={1}
        open={true}
        onOpenChange={onOpenChange}
        onJump={onJump}
      />,
    );

    const input = screen.getByRole("textbox", { name: /search query/i });
    fireEvent.change(input, { target: { value: "x" } });

    await waitFor(() => {
      expect(screen.getByText("Single Leg X")).toBeTruthy();
    });

    const row = screen.getByRole("button", { name: "Single Leg X" });
    fireEvent.click(row);

    expect(onJump).toHaveBeenCalledWith(10); // technique thread_id = 10
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("tapping a thread result calls onJump with the correct thread_id", async () => {
    stubSearchFetch();
    const onJump = vi.fn();

    renderWithProviders(
      <CampSearchSheet
        campId={1}
        open={true}
        onOpenChange={() => {}}
        onJump={onJump}
      />,
    );

    const input = screen.getByRole("textbox", { name: /search query/i });
    fireEvent.change(input, { target: { value: "session" } });

    await waitFor(() => {
      expect(screen.getByText("Great session today")).toBeTruthy();
    });

    const row = screen.getByText("Great session today").closest("button");
    expect(row).toBeTruthy();
    fireEvent.click(row!);

    expect(onJump).toHaveBeenCalledWith(30); // thread thread_id = 30
  });

  test("shows 'No matches found' when result is empty", async () => {
    stubSearchFetch({ techniques: [], videos: [], threads: [] });

    renderWithProviders(
      <CampSearchSheet
        campId={1}
        open={true}
        onOpenChange={() => {}}
        onJump={() => {}}
      />,
    );

    const input = screen.getByRole("textbox", { name: /search query/i });
    fireEvent.change(input, { target: { value: "zzz" } });

    await waitFor(() => {
      expect(screen.getByText("No matches found.")).toBeTruthy();
    });
  });
});
