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
        onJumpVideo={() => {}}
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
        onJumpVideo={() => {}}
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
        onJumpVideo={() => {}}
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
        onJumpVideo={() => {}}
      />,
    );

    const input = screen.getByRole("textbox", { name: /search query/i });
    fireEvent.change(input, { target: { value: "single" } });

    // Wait for results to appear.
    await waitFor(() => {
      expect(screen.getByText("Single Leg X")).toBeTruthy();
    });

    // All three groups should render.
    // "Techniques" appears in both the kind chip (span) and the section heading
    // (li), so use getAllByText and check at least one element is present.
    expect(screen.getAllByText("Techniques").length).toBeGreaterThan(0);
    // "Videos" similarly appears in both chip and heading.
    expect(screen.getAllByText("Videos").length).toBeGreaterThan(0);
    // The section heading is "Threads & replies"; the chip is "Threads".
    expect(screen.getByText("Threads & replies")).toBeTruthy();
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
        onJumpVideo={() => {}}
      />,
    );

    const input = screen.getByRole("textbox", { name: /search query/i });
    fireEvent.change(input, { target: { value: "leg" } });

    // Wait for results.
    await waitFor(() => {
      expect(screen.getByText("Single Leg X")).toBeTruthy();
    });

    // Switch to Techniques-only chip. "Techniques" appears in both the kind
    // chip (span/Badge, first in DOM) and the section heading (li), so pick
    // the first element — that is always the chip.
    const chip = screen.getAllByText("Techniques")[0];
    fireEvent.click(chip);

    // The section headings for Videos and Threads & replies should no longer
    // be visible. The kind chip badges ("Videos", "Threads") always stay
    // rendered, so we must assert specifically on the section heading elements
    // (li tags) rather than on the text alone.
    expect(screen.queryAllByText("Videos").filter((el) => el.tagName === "LI")).toHaveLength(0);
    // The Threads section heading is "Threads & replies" — unambiguous from the
    // "Threads" chip badge, so a plain queryByText works here.
    expect(screen.queryByText("Threads & replies")).toBeNull();
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
        onJumpVideo={() => {}}
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
        onJumpVideo={() => {}}
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
        onJumpVideo={() => {}}
      />,
    );

    const input = screen.getByRole("textbox", { name: /search query/i });
    fireEvent.change(input, { target: { value: "zzz" } });

    await waitFor(() => {
      expect(screen.getByText("No matches found.")).toBeTruthy();
    });
  });
});
