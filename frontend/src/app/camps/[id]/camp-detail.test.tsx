/**
 * Camp detail page component test (browser project, CI-only).
 *
 * Mounts the page at /camps/1 as a coach and verifies:
 * - Camp name renders from the stubbed GET /api/camps/1 response.
 * - Empty technique state text appears when techniques: [].
 * - Empty discussion state text appears when threads: [].
 * - "Builds on" link renders when references_camp_id + references_camp_name
 *   are present in the camp payload.
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
              techniques: [],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
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

  test("shows empty technique state when techniques list is empty", async () => {
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
      expect(screen.getByText(/no techniques yet/i)).toBeInTheDocument();
    });
    fetchSpy.mockRestore();
  });

  test("shows empty discussion state when threads list is empty", async () => {
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
      expect(screen.getByText(/no discussion yet/i)).toBeInTheDocument();
    });
    fetchSpy.mockRestore();
  });

  test("renders Builds-on link when references_camp_id and references_camp_name are present", async () => {
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
                references_camp_id: 7,
                references_camp_name: "Foundation camp",
                techniques: [],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
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
      expect(screen.getByText("Foundation camp")).toBeInTheDocument();
    });

    // The heading label should also be visible.
    expect(screen.getByText(/builds on/i)).toBeInTheDocument();

    fetchSpy.mockRestore();
  });
});
