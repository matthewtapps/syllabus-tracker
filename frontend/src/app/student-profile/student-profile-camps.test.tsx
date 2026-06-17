/**
 * Student profile "Camps" section (browser project). Mocks campsUiEnabled on so
 * the gated section renders, stubs the camps endpoint, and asserts the card
 * renders and links to the camp, and that no standalone "Matches" link exists.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";

vi.mock("@/lib/features", () => ({ campsUiEnabled: true }));

import StudentProfilePage from "./page";
import { buildUser, renderWithProviders } from "@/test/render";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function stubFetch() {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes("/api/camps?student_id=")) {
      return Promise.resolve(
        jsonResponse({
          camps: [
            {
              id: 9,
              student_id: 42,
              coach_id: 1,
              name: "Worlds Prep",
              description: "block",
              created_at: new Date().toISOString(),
              archived_at: null,
              competition_id: 3,
              references_camp_id: null,
              competition_name: "IBJJF Worlds",
              technique_count: 12,
              video_count: 4,
              last_activity_at: new Date().toISOString(),
            },
          ],
        }),
      );
    }
    if (url.includes("/activity_feed")) return Promise.resolve(jsonResponse([]));
    // Profile preview sections: syllabi + pinned both expect an array.
    if (url.includes("/pinned_techniques") || url.includes("/syllabi")) {
      return Promise.resolve(jsonResponse([]));
    }
    return Promise.resolve(jsonResponse({}));
  });
}

describe("StudentProfilePage / camps section", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;
  afterEach(() => fetchSpy?.mockRestore());

  test("renders camp cards and no standalone matches link", async () => {
    fetchSpy = vi.spyOn(window, "fetch").mockImplementation(stubFetch());
    const student = buildUser({ id: 42, role: "student" });
    renderWithProviders(
      <Routes>
        <Route path="/student/:id" element={<StudentProfilePage />} />
      </Routes>,
      { user: student, initialEntries: ["/student/42"] },
    );

    const card = await screen.findByText("Worlds Prep");
    expect(card.closest("a")).toHaveAttribute("href", "/camps/9");
    expect(screen.queryByRole("link", { name: /matches/i })).toBeNull();
  });
});
