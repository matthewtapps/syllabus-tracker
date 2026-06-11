/**
 * RecentActivityFeed panel rendering tests (browser project).
 *
 * Mocks getDashboardActivityFeed from the api module and asserts that actor
 * name and the activity line text are rendered. Verifies no "See all" link is
 * present (the browsable feed is a future feature).
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { screen } from "@testing-library/react";
import * as api from "@/lib/api";
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

describe("RecentActivityFeed", () => {
  let feedSpy: ReturnType<typeof vi.spyOn> | null = null;

  afterEach(() => {
    feedSpy?.mockRestore();
  });

  test("renders actor name and activity line text", async () => {
    feedSpy = vi
      .spyOn(api, "getDashboardActivityFeed")
      .mockResolvedValue([mockRow]);

    renderWithProviders(<RecentActivityFeed />);

    expect(await screen.findByText("Sam Khan")).toBeInTheDocument();
    expect(
      await screen.findByText(/logged an attempt on Triangle/),
    ).toBeInTheDocument();
  });

  test("does not render a See all link", async () => {
    feedSpy = vi
      .spyOn(api, "getDashboardActivityFeed")
      .mockResolvedValue([mockRow]);

    renderWithProviders(<RecentActivityFeed />);

    await screen.findByText("Sam Khan");
    expect(screen.queryByRole("link", { name: /see all/i })).toBeNull();
  });
});
