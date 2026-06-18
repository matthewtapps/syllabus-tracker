/**
 * Match dialog smoke test (browser project, CI-only).
 *
 * Mounts the camp detail page for a competition-linked camp and verifies that
 * clicking the match button opens the "Add match" dialog instead of crashing
 * to the "Session lost" error boundary.
 *
 * NOTE: .test.tsx files run in Chromium via vitest-browser and cannot execute
 * on this NixOS dev box (Chromium shared-lib dependencies are absent). This
 * test is verified locally via tsc --noEmit + npm run lint only; CI runs the
 * actual browser render.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import CampDetailPage from "./page";
import { buildUser, renderWithProviders } from "@/test/render";

function makeStubFetch() {
  return vi.spyOn(window, "fetch").mockImplementation(
    (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      // Camp detail - includes competition_id, registration_id, student_id
      if (/\/api\/camps\/\d+$/.test(url)) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 1,
              student_id: 2,
              coach_id: 1,
              name: "Tournament prep",
              description: null,
              created_at: "2026-06-16T00:00:00Z",
              archived_at: null,
              competition_id: 10,
              competition_name: "Summer Open",
              registration_id: 99,
              references_camp_id: null,
              references_camp_name: null,
              techniques: [],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      // Registration matches
      if (/\/api\/registrations\/\d+\/matches/.test(url)) {
        return Promise.resolve(
          new Response(
            JSON.stringify([]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      // Threads
      if (url.includes("/api/threads")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ threads: [] }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      // Camp videos
      if (/\/api\/camps\/\d+\/videos/.test(url)) {
        return Promise.resolve(
          new Response(
            JSON.stringify([]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      // Library techniques
      if (/\/api\/techniques$/.test(url)) {
        return Promise.resolve(
          new Response(
            JSON.stringify([]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      // Competitions list
      if (/\/api\/competitions$/.test(url)) {
        return Promise.resolve(
          new Response(
            JSON.stringify([]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      // Unread activity count
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

describe("LogMatchDialog", () => {
  afterEach(() => vi.restoreAllMocks());

  test("opens the Add match dialog without crashing to Session lost", async () => {
    const fetchSpy = makeStubFetch();
    const user = userEvent.setup();

    renderWithProviders(
      <Routes>
        <Route path="/camps/:id" element={<CampDetailPage />} />
      </Routes>,
      {
        user: buildUser({ id: 1, role: "coach" }),
        initialEntries: ["/camps/1"],
      },
    );

    // Wait for the page to load and the match button to appear.
    const matchBtn = await screen.findByRole("button", { name: /match/i });
    await user.click(matchBtn);

    // The dialog title should appear and the error boundary should not.
    expect(await screen.findByText("Add match")).toBeInTheDocument();
    expect(screen.queryByText("Session lost")).toBeNull();

    fetchSpy.mockRestore();
  });
});
