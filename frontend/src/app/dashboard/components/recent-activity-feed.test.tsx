/**
 * RecentActivityFeed panel rendering tests (browser project).
 *
 * Stubs window.fetch to serve a single ActivityRow and asserts that actor name
 * and activity line text are rendered. Verifies no "See all" link is present
 * (the browsable feed is a future feature).
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { RecentActivityFeed } from "./recent-activity-feed";
import { renderWithProviders } from "@/test/render";
import type { ActivityRow } from "@/lib/api";

const mockRow: ActivityRow = {
  id: 1,
  occurred_at: new Date().toISOString(),
  verb: "attempt_logged",
  actor_user_id: 42,
  actor_name: "Sam Khan",
  target_student_id: 42,
  technique_id: 7,
  technique_name: "Triangle",
  syllabus_id: null,
  syllabus_name: null,
  sst_id: null,
  video_id: null,
  video_title: null,
  payload_json: null,
  unread: false,
};

function makeStubFetch(rows: ActivityRow[]) {
  const mockFn = vi.fn().mockImplementation((url: string) => {
    if (url.includes("/api/dashboard/activity_feed")) {
      return Promise.resolve(
        new Response(JSON.stringify(rows), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
  });
  return mockFn;
}

describe("RecentActivityFeed", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  test("renders actor name and activity line text", async () => {
    fetchSpy = vi
      .spyOn(window, "fetch")
      .mockImplementation(makeStubFetch([mockRow]));

    renderWithProviders(<RecentActivityFeed />);

    await waitFor(() => {
      expect(screen.getByText("Sam Khan")).toBeInTheDocument();
    });
    expect(screen.getByText(/logged an attempt on Triangle/)).toBeInTheDocument();
  });

  test("does not render a See all link", async () => {
    fetchSpy = vi
      .spyOn(window, "fetch")
      .mockImplementation(makeStubFetch([mockRow]));

    renderWithProviders(<RecentActivityFeed />);

    await waitFor(() => {
      expect(screen.getByText("Sam Khan")).toBeInTheDocument();
    });
    expect(screen.queryByRole("link", { name: /see all/i })).toBeNull();
  });
});
