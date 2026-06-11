/**
 * ActivityDigest tile rendering tests (browser project).
 *
 * Stubs window.fetch to serve a synthetic ActivityDigest payload and asserts
 * the four metric tiles render with the correct labels, counts, and delta text.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { ActivityDigest } from "./activity-digest";
import { renderWithProviders } from "@/test/render";
import type { ActivityDigest as ActivityDigestType } from "@/lib/api";

// Deltas: +7 (positive), +4 (positive), -2 (negative), 0 (no change).
const mockDigest: ActivityDigestType = {
  window_days: 7,
  metrics: [
    {
      key: "attempts_logged",
      label: "Attempts logged",
      count: 37,
      prev_count: 30,
      delta: 7,
      daily: [3, 5, 4, 6, 7, 5, 7],
    },
    {
      key: "videos_watched",
      label: "Videos watched",
      count: 24,
      prev_count: 20,
      delta: 4,
      daily: [2, 3, 4, 3, 4, 4, 4],
    },
    {
      key: "active_students",
      label: "Active students",
      count: 11,
      prev_count: 13,
      delta: -2,
      daily: [1, 2, 2, 1, 2, 1, 2],
    },
    {
      key: "techniques_pinned",
      label: "Techniques pinned",
      count: 8,
      prev_count: 8,
      delta: 0,
      daily: [1, 1, 1, 1, 1, 1, 2],
    },
  ],
};

function makeStubFetch(digest: ActivityDigestType | null, status = 200) {
  const mockFn = vi.fn().mockImplementation((url: string) => {
    if (url.includes("/api/dashboard/activity_digest")) {
      if (status !== 200) {
        return Promise.resolve(new Response("err", { status }));
      }
      return Promise.resolve(
        new Response(JSON.stringify(digest), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
  });
  return mockFn;
}

describe("ActivityDigest", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  test("renders all four metric tiles with correct labels and counts", async () => {
    fetchSpy = vi
      .spyOn(window, "fetch")
      .mockImplementation(makeStubFetch(mockDigest));

    renderWithProviders(<ActivityDigest />);

    await waitFor(() => {
      expect(screen.getByText("Attempts logged")).toBeInTheDocument();
    });
    expect(screen.getByText("37")).toBeInTheDocument();
    expect(screen.getByText("Active students")).toBeInTheDocument();
  });

  test("renders delta text for positive, negative, and zero deltas", async () => {
    fetchSpy = vi
      .spyOn(window, "fetch")
      .mockImplementation(makeStubFetch(mockDigest));

    renderWithProviders(<ActivityDigest />);

    await waitFor(() => {
      expect(screen.getByText("Up 7 vs last week")).toBeInTheDocument();
    });
    expect(screen.getByText("Up 4 vs last week")).toBeInTheDocument();
    expect(screen.getByText("2 fewer vs last week")).toBeInTheDocument();
    expect(screen.getByText("No change vs last week")).toBeInTheDocument();
  });

  test("shows error state when the query rejects", async () => {
    fetchSpy = vi
      .spyOn(window, "fetch")
      .mockImplementation(makeStubFetch(null, 500));

    renderWithProviders(<ActivityDigest />);

    expect(
      await screen.findByText("Could not load recent activity."),
    ).toBeInTheDocument();
  });
});
