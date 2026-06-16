/**
 * Competition detail page component test (browser project, CI-only).
 *
 * Mounts the page at /competitions/1 as a coach and verifies:
 * - The competition name renders from the stubbed GET /api/competitions/1.
 * - A rostered student's name renders in the roster section.
 *
 * NOTE: .test.tsx files run in Chromium via vitest-browser and cannot execute
 * on this NixOS dev box (Chromium shared-lib dependencies are absent). This
 * test is verified locally via tsc --noEmit + npm run lint only; CI runs the
 * actual browser render.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import CompetitionDetailPage from "./page";
import { buildUser, renderWithProviders } from "@/test/render";

function makeStubFetch() {
  return vi.spyOn(window, "fetch").mockImplementation(
    (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (/\/api\/competitions\/\d+$/.test(url)) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 1,
              name: "IBJJF Pans 2026",
              date: "2026-08-15",
              created_by_id: 1,
              created_at: "2026-06-01T00:00:00Z",
              roster: [
                {
                  student_id: 2,
                  student_name: "Alex Rivera",
                  registered_at: "2026-06-10T00:00:00Z",
                  camp_id: 5,
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      if (url.includes("/api/students")) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              buildUser({ id: 2, role: "student", display_name: "Alex Rivera" }),
            ]),
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

describe("CompetitionDetailPage", () => {
  afterEach(() => vi.restoreAllMocks());

  test("renders the competition name", async () => {
    const fetchSpy = makeStubFetch();

    renderWithProviders(
      <Routes>
        <Route path="/competitions/:id" element={<CompetitionDetailPage />} />
      </Routes>,
      {
        user: buildUser({ id: 1, role: "coach" }),
        initialEntries: ["/competitions/1"],
      },
    );

    await waitFor(() => {
      expect(screen.getByText("IBJJF Pans 2026")).toBeInTheDocument();
    });
    fetchSpy.mockRestore();
  });

  test("renders the rostered student name", async () => {
    const fetchSpy = makeStubFetch();

    renderWithProviders(
      <Routes>
        <Route path="/competitions/:id" element={<CompetitionDetailPage />} />
      </Routes>,
      {
        user: buildUser({ id: 1, role: "coach" }),
        initialEntries: ["/competitions/1"],
      },
    );

    await waitFor(() => {
      expect(screen.getByText("Alex Rivera")).toBeInTheDocument();
    });
    fetchSpy.mockRestore();
  });
});
