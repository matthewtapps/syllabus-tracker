/**
 * Per-student activity page tests (browser project, CI-only).
 *
 * Mounts the page on /student/4/activity as a coach and verifies:
 * - Feed rows render from the student-scoped endpoint.
 * - The feed is uncoalesced (no "N more" shown for distinct rows).
 * - Empty state text is present when the feed is empty.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import StudentActivityPage from "./page";
import { buildUser, renderWithProviders } from "@/test/render";
import type { ActivityRow } from "@/lib/activity-line";

function buildActivityRow(overrides: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id: 1,
    occurred_at: new Date().toISOString(),
    verb: "attempt_logged",
    actor_user_id: 4,
    actor_name: "Jordan Smith",
    target_student_id: 4,
    technique_id: 5,
    technique_name: "Armbar",
    syllabus_id: 2,
    syllabus_name: "Blue Belt",
    sst_id: 42,
    video_id: null,
    video_title: null,
    payload_json: null,
    unread: false,
    context_kind: null,
    thread_id: null,
    ...overrides,
  };
}

function makeStubFetch(feedRows: ActivityRow[]) {
  return vi.spyOn(window, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/student/") && url.includes("/activity_feed")) {
      return Promise.resolve(
        new Response(JSON.stringify(feedRows), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    if (url.includes("/api/admin/users") || url.includes("/api/me")) {
      return Promise.resolve(
        new Response(
          JSON.stringify([
            buildUser({ id: 4, role: "student", display_name: "Jordan Smith" }),
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
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

describe("StudentActivityPage", () => {
  afterEach(() => vi.restoreAllMocks());

  test("renders feed rows from the student-scoped endpoint", async () => {
    const rows = [
      buildActivityRow({ id: 1, verb: "attempt_logged", technique_name: "Armbar" }),
      buildActivityRow({ id: 2, verb: "technique_pinned", technique_name: "Triangle", sst_id: null, syllabus_id: null }),
    ];
    const fetchSpy = makeStubFetch(rows);

    renderWithProviders(
      <Routes>
        <Route path="/student/:id/activity" element={<StudentActivityPage />} />
      </Routes>,
      {
        user: buildUser({ role: "coach", id: 99 }),
        initialEntries: ["/student/4/activity"],
      },
    );

    await waitFor(() => {
      expect(screen.getByText(/logged an attempt on/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Armbar/i)).toBeInTheDocument();
    fetchSpy.mockRestore();
  });

  test("does not coalesce distinct rows", async () => {
    const rows = [
      buildActivityRow({ id: 1, verb: "attempt_logged", technique_name: "Armbar" }),
      buildActivityRow({ id: 2, verb: "technique_pinned", technique_name: "Triangle", sst_id: null, syllabus_id: null }),
    ];
    const fetchSpy = makeStubFetch(rows);

    renderWithProviders(
      <Routes>
        <Route path="/student/:id/activity" element={<StudentActivityPage />} />
      </Routes>,
      {
        user: buildUser({ role: "coach", id: 99 }),
        initialEntries: ["/student/4/activity"],
      },
    );

    await waitFor(() => {
      expect(screen.getByText(/logged an attempt on/i)).toBeInTheDocument();
    });
    // No "N more" link when the feed is uncoalesced.
    expect(screen.queryByText(/and \d+ more/i)).toBeNull();
    fetchSpy.mockRestore();
  });

  test("shows empty state when feed is empty", async () => {
    const fetchSpy = makeStubFetch([]);

    renderWithProviders(
      <Routes>
        <Route path="/student/:id/activity" element={<StudentActivityPage />} />
      </Routes>,
      {
        user: buildUser({ role: "coach", id: 99 }),
        initialEntries: ["/student/4/activity"],
      },
    );

    await waitFor(() => {
      expect(screen.getByText(/no activity yet/i)).toBeInTheDocument();
    });
    fetchSpy.mockRestore();
  });

  test("resolves student display name in title for coach view", async () => {
    const fetchSpy = makeStubFetch([]);

    renderWithProviders(
      <Routes>
        <Route path="/student/:id/activity" element={<StudentActivityPage />} />
      </Routes>,
      {
        user: buildUser({ role: "coach", id: 99 }),
        initialEntries: ["/student/4/activity"],
      },
    );

    await waitFor(() => {
      expect(screen.getByText(/Jordan Smith's timeline/i)).toBeInTheDocument();
    });
    fetchSpy.mockRestore();
  });
});
