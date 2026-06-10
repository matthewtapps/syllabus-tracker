/**
 * Student profile "Recent activity" section tests (browser project).
 *
 * Verifies that the feed renders activityLine text from the mocked endpoint,
 * and that the request URL is scoped to the profiled student (not the gym-wide
 * feed). This guards against the regression where useActivityFeed() was called
 * with no student id, causing coaches to see gym-wide activity on a student's
 * profile page.
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

/**
 * Creates a fetch stub that serves feed rows for the student-scoped endpoint
 * and records which URLs were requested so tests can assert routing.
 */
function makeStubFetch(feedRows: ActivityRow[]) {
  const requestedUrls: string[] = [];
  const mockFn = vi.fn().mockImplementation((url: string) => {
    requestedUrls.push(url);
    // Student-scoped feed endpoint (Bug 1 fix).
    if (url.includes("/api/student/") && url.includes("/activity_feed")) {
      return Promise.resolve(
        new Response(JSON.stringify(feedRows), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    // Old gym-wide endpoint — intentionally return empty so any accidental
    // call to /api/activity/feed is distinguishable.
    if (url.includes("/api/activity/feed")) {
      return Promise.resolve(
        new Response(JSON.stringify([]), {
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
  return { mockFn, requestedUrls };
}

describe("StudentProfilePage / recent activity", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  test("uses student-scoped endpoint, not gym-wide feed", async () => {
    const rows = [
      buildActivityRow({ verb: "attempt_logged", technique_name: "Armbar" }),
    ];
    const { mockFn, requestedUrls } = makeStubFetch(rows);
    fetchSpy = vi.spyOn(window, "fetch").mockImplementation(mockFn);

    const student = buildUser({ id: 42, role: "student" });
    renderWithProviders(<StudentProfilePage />, {
      user: student,
      initialEntries: ["/student/42"],
    });

    await waitFor(() => {
      expect(screen.getByText(/logged an attempt on Armbar/i)).toBeInTheDocument();
    });

    // Assert the request URL contains the student id, not the gym-wide path.
    const feedUrls = requestedUrls.filter((u) => u.includes("activity_feed") || u.includes("/activity/feed"));
    expect(feedUrls.some((u) => u.includes("/api/student/42/activity_feed"))).toBe(true);
    expect(feedUrls.every((u) => !u.includes("/api/activity/feed"))).toBe(true);
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
    const { mockFn } = makeStubFetch(rows);
    fetchSpy = vi.spyOn(window, "fetch").mockImplementation(mockFn);

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
    const { mockFn } = makeStubFetch([]);
    fetchSpy = vi.spyOn(window, "fetch").mockImplementation(mockFn);

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
