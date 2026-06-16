/**
 * SuggestionQueue component rendering tests (browser project, CI-only).
 *
 * Stubs window.fetch to serve a single pending suggestion and asserts that the
 * student name and suggested technique name render. Also verifies the queue is
 * not rendered when the pending list is empty.
 *
 * NOTE: .test.tsx files run in Chromium via vitest-browser and cannot execute
 * on this NixOS dev box (Chromium shared-lib dependencies are absent). This
 * test is verified locally via tsc --noEmit + npm run lint only; CI runs the
 * actual browser render.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { SuggestionQueue } from "./suggestion-queue";
import { buildUser, renderWithProviders } from "@/test/render";
import type { PendingSuggestion } from "@/lib/api";

const pendingSuggestion: PendingSuggestion = {
  id: 1,
  student_id: 2,
  student_name: "Sam Rivera",
  technique_id: 5,
  technique_name: "Butterfly guard",
  anchor_video_id: null,
  anchor_video_title: null,
  anchor_seconds: null,
  created_at: "2026-06-16T10:00:00Z",
};

function makeStubFetch(suggestions: PendingSuggestion[]) {
  return vi.spyOn(window, "fetch").mockImplementation(
    (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("/api/suggestions/pending")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ suggestions }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      // Library techniques + camps endpoints are fetched only when a row
      // enters approve/replace mode; return empty lists for completeness.
      if (url.includes("/api/techniques")) {
        return Promise.resolve(
          new Response(
            JSON.stringify([]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      if (url.includes("/api/camps")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ camps: [] }),
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

describe("SuggestionQueue", () => {
  afterEach(() => vi.restoreAllMocks());

  test("renders student name and technique name for a pending suggestion", async () => {
    const fetchSpy = makeStubFetch([pendingSuggestion]);

    renderWithProviders(<SuggestionQueue />, {
      user: buildUser({ id: 1, role: "coach" }),
    });

    await waitFor(() => {
      expect(screen.getByText("Butterfly guard")).toBeInTheDocument();
    });

    expect(screen.getByText("Sam Rivera")).toBeInTheDocument();

    fetchSpy.mockRestore();
  });

  test("renders nothing when the pending queue is empty", async () => {
    const fetchSpy = makeStubFetch([]);

    const { container } = renderWithProviders(<SuggestionQueue />, {
      user: buildUser({ id: 1, role: "coach" }),
    });

    // Wait for the fetch to settle then confirm no suggestion content appears.
    await waitFor(() => {
      expect(
        screen.queryByText("Technique suggestions"),
      ).not.toBeInTheDocument();
    });

    expect(container.firstChild).toBeNull();

    fetchSpy.mockRestore();
  });
});
