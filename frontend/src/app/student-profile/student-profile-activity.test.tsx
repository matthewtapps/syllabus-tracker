/**
 * Student profile "Recent activity" section tests (browser project).
 *
 * Verifies that the feed renders activityLine text from the mocked endpoint.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import StudentProfilePage from "./page";
import { buildUser, renderWithProviders } from "@/test/render";
import type { ActivityRow } from "@/lib/activity-line";

function buildActivityRow(overrides: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id: 1,
    occurred_at: new Date().toISOString(),
    verb: "attempt_logged",
    actor_user_id: 42,
    actor_name: "Alice",
    target_student_id: 42,
    technique_id: 101,
    technique_name: "Armbar",
    syllabus_id: null,
    syllabus_name: null,
    sst_id: null,
    video_id: null,
    video_title: null,
    payload_json: null,
    unread: false,
    ...overrides,
  };
}

function stubFetch(feedRows: ActivityRow[]) {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes("/api/activity/feed")) {
      return Promise.resolve(
        new Response(JSON.stringify(feedRows), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    if (url.includes("/api/users") || url.includes("/api/me")) {
      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    if (url.includes("/api/activity/unread_count")) {
      return Promise.resolve(
        new Response(JSON.stringify({ count: 0 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({}), { status: 200 }),
    );
  });
}

describe("StudentProfilePage / recent activity", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  test("renders activityLine text for feed rows", async () => {
    const rows = [
      buildActivityRow({ verb: "attempt_logged", technique_name: "Armbar" }),
      buildActivityRow({
        id: 2,
        verb: "sst_status_changed",
        technique_name: "Kimura",
        payload_json: JSON.stringify({ from: "amber", to: "green" }),
      }),
    ];
    fetchSpy = vi.spyOn(window, "fetch").mockImplementation(stubFetch(rows));

    const student = buildUser({ id: 42, role: "student" });
    renderWithProviders(<StudentProfilePage />, {
      user: student,
      initialEntries: ["/student/42"],
    });

    await waitFor(() => {
      expect(screen.getByText(/logged an attempt on Armbar/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/went green on Kimura/i)).toBeInTheDocument();
  });

  test("shows empty state when feed is empty", async () => {
    fetchSpy = vi.spyOn(window, "fetch").mockImplementation(stubFetch([]));

    const student = buildUser({ id: 42, role: "student" });
    renderWithProviders(<StudentProfilePage />, {
      user: student,
      initialEntries: ["/student/42"],
    });

    await waitFor(() => {
      expect(
        screen.getByText(/no activity recorded yet/i),
      ).toBeInTheDocument();
    });
  });
});
