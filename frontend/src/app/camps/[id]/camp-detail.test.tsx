/**
 * Camp detail page component test (browser project, CI-only).
 *
 * Mounts the page at /camps/1 as a coach and verifies:
 * - Camp name renders from the stubbed GET /api/camps/1 response.
 * - Empty feed state text appears when the camp feed is empty.
 * - Coaches see a Rename control; the builds-on display is gone.
 *
 * NOTE: .test.tsx files run in Chromium via vitest-browser and cannot execute
 * on this NixOS dev box (Chromium shared-lib dependencies are absent). This
 * test is verified locally via tsc --noEmit + npm run lint only; CI runs the
 * actual browser render.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import CampDetailPage from "./page";
import { buildUser, renderWithProviders } from "@/test/render";

function makeStubFetch() {
  return vi.spyOn(window, "fetch").mockImplementation(
    (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (/\/api\/camps\/\d+$/.test(url)) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 1,
              student_id: 2,
              coach_id: 1,
              name: "Worlds prep",
              description: "Focus on guard passing",
              created_at: "2026-06-16T00:00:00Z",
              archived_at: null,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      if (/\/api\/camps\/\d+\/feed/.test(url)) {
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      if (url.includes("/api/threads")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ threads: [] }),
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

describe("CampDetailPage", () => {
  afterEach(() => vi.restoreAllMocks());

  test("renders the camp name", async () => {
    const fetchSpy = makeStubFetch();

    renderWithProviders(
      <Routes>
        <Route path="/camps/:id" element={<CampDetailPage />} />
      </Routes>,
      {
        user: buildUser({ id: 1, role: "coach" }),
        initialEntries: ["/camps/1"],
      },
    );

    await waitFor(() => {
      expect(screen.getByText("Worlds prep")).toBeInTheDocument();
    });
    fetchSpy.mockRestore();
  });

  test("shows empty feed state when the camp feed is empty", async () => {
    const fetchSpy = makeStubFetch();

    renderWithProviders(
      <Routes>
        <Route path="/camps/:id" element={<CampDetailPage />} />
      </Routes>,
      {
        user: buildUser({ id: 1, role: "coach" }),
        initialEntries: ["/camps/1"],
      },
    );

    await waitFor(() => {
      expect(
        screen.getByText(/post a technique, video, or note to start this camp/i),
      ).toBeInTheDocument();
    });
    fetchSpy.mockRestore();
  });

  test("coach sees a Rename control and no builds-on display", async () => {
    const fetchSpy = vi.spyOn(window, "fetch").mockImplementation(
      (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();

        if (/\/api\/camps\/\d+$/.test(url)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 1,
                student_id: 2,
                coach_id: 1,
                name: "Worlds prep",
                description: null,
                created_at: "2026-06-16T00:00:00Z",
                archived_at: null,
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          );
        }

        if (/\/api\/camps\/\d+\/feed/.test(url)) {
          return Promise.resolve(
            new Response(JSON.stringify([]), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }

        if (url.includes("/api/threads")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ threads: [] }),
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
        <Route path="/camps/:id" element={<CampDetailPage />} />
      </Routes>,
      {
        user: buildUser({ id: 1, role: "coach" }),
        initialEntries: ["/camps/1"],
      },
    );

    await waitFor(() => {
      expect(screen.getByText("Worlds prep")).toBeInTheDocument();
    });

    // Coach-only rename affordance present.
    expect(
      screen.getByRole("button", { name: /rename/i }),
    ).toBeInTheDocument();

    // Builds-on display has been removed.
    expect(screen.queryByText(/builds on/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Foundation camp")).not.toBeInTheDocument();

    fetchSpy.mockRestore();
  });

  test("student does not see the Rename control", async () => {
    const fetchSpy = makeStubFetch();

    renderWithProviders(
      <Routes>
        <Route path="/camps/:id" element={<CampDetailPage />} />
      </Routes>,
      {
        // student_id in the stub is 2, so this is the owning student.
        user: buildUser({ id: 2, role: "student" }),
        initialEntries: ["/camps/1"],
      },
    );

    await waitFor(() => {
      expect(screen.getByText("Worlds prep")).toBeInTheDocument();
    });

    expect(
      screen.queryByRole("button", { name: /rename/i }),
    ).not.toBeInTheDocument();

    fetchSpy.mockRestore();
  });
});
