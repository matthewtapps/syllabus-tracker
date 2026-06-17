/**
 * Student matches page component test (browser project, CI-only).
 *
 * Mounts the page at /student/2/matches as the owning student (id 2) and
 * verifies:
 * - The competition name from the stubbed match renders.
 * - The result badge label (W for win) renders.
 * - An empty video list (no videos) is handled without error.
 *
 * NOTE: .test.tsx files run in Chromium via vitest-browser and cannot execute
 * on this NixOS dev box (Chromium shared-lib dependencies are absent). This
 * test is verified locally via tsc --noEmit + npm run lint only; CI runs the
 * actual browser render.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import StudentMatchesPage from "./page";
import { buildUser, renderWithProviders } from "@/test/render";

function makeStubFetch() {
  return vi.spyOn(window, "fetch").mockImplementation(
    (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (/\/api\/students\/\d+\/matches$/.test(url)) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              matches: [
                {
                  id: 10,
                  registration_id: 3,
                  result: "win",
                  method: "submission",
                  method_detail: null,
                  occurred_at: "2026-08-15",
                  created_by_id: 2,
                  created_at: "2026-08-15T18:00:00Z",
                  competition_id: 1,
                  competition_name: "IBJJF Pans 2026",
                  camp_id: 5,
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      if (/\/api\/matches\/\d+\/videos$/.test(url)) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ videos: [] }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      if (url.includes("/api/admin/users")) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              buildUser({ id: 2, role: "student", display_name: "Alex Rivera" }),
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      if (url.includes("/api/activity/unread_count")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ count: 0 }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      return Promise.resolve(
        new Response(JSON.stringify({}), { status: 200 }),
      );
    },
  );
}

describe("StudentMatchesPage", () => {
  afterEach(() => vi.restoreAllMocks());

  test("renders the competition name for a match", async () => {
    const fetchSpy = makeStubFetch();

    renderWithProviders(
      <Routes>
        <Route path="/student/:id/matches" element={<StudentMatchesPage />} />
      </Routes>,
      {
        user: buildUser({ id: 2, role: "student" }),
        initialEntries: ["/student/2/matches"],
      },
    );

    await waitFor(() => {
      expect(screen.getByText("IBJJF Pans 2026")).toBeInTheDocument();
    });
    fetchSpy.mockRestore();
  });

  test("renders the result badge for a win", async () => {
    const fetchSpy = makeStubFetch();

    renderWithProviders(
      <Routes>
        <Route path="/student/:id/matches" element={<StudentMatchesPage />} />
      </Routes>,
      {
        user: buildUser({ id: 2, role: "student" }),
        initialEntries: ["/student/2/matches"],
      },
    );

    await waitFor(() => {
      expect(screen.getByText("W")).toBeInTheDocument();
    });
    fetchSpy.mockRestore();
  });

  test("shows empty state when no matches", async () => {
    const fetchSpy = vi.spyOn(window, "fetch").mockImplementation(
      (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();

        if (/\/api\/students\/\d+\/matches$/.test(url)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ matches: [] }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          );
        }

        if (url.includes("/api/activity/unread_count")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ count: 0 }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          );
        }

        return Promise.resolve(
          new Response(JSON.stringify({}), { status: 200 }),
        );
      },
    );

    renderWithProviders(
      <Routes>
        <Route path="/student/:id/matches" element={<StudentMatchesPage />} />
      </Routes>,
      {
        user: buildUser({ id: 2, role: "student" }),
        initialEntries: ["/student/2/matches"],
      },
    );

    await waitFor(() => {
      expect(screen.getByText(/no matches recorded yet/i)).toBeInTheDocument();
    });
    fetchSpy.mockRestore();
  });
});
