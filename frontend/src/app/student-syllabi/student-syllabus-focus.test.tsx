// frontend/src/app/student-syllabi/student-syllabus-focus.test.tsx
import { describe, expect, test, vi, afterEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { renderWithProviders, buildUser } from "@/test/render";
import StudentSyllabusDetailPage from "./[syllabusId]/page";

// Minimal fetch stub: one syllabus assignment with one technique (sst id 42,
// technique id 5). The endpoint is /api/student/:id/syllabi/:syllabusId/techniques.
function makeStubFetch() {
  return vi.spyOn(window, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    // Expanding the focused technique mounts the videos block, which fetches
    // .../techniques/<id>/videos. That URL also contains /syllabi/ + /techniques,
    // so serve it an empty array before the techniques branch to avoid handing
    // it technique-shaped JSON (which would crash the videos list).
    if (url.includes("/videos")) {
      return Promise.resolve(
        new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } }),
      );
    }
    if (url.includes("/syllabi/") && url.includes("/techniques")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            assignment: { id: 1, syllabus_name: "Blue Belt", total_count: 1, graduated_at: null },
            techniques: [
              {
                id: 42,
                technique_id: 5,
                technique_name: "Knee Cut Pass",
                technique_description: "",
                status: "amber",
                tags: [],
                last_attempt_at: null,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
  });
}

describe("student-syllabus focus", () => {
  afterEach(() => vi.restoreAllMocks());

  test("arriving with ?focus=sst:42 expands the matching technique", async () => {
    const fetchSpy = makeStubFetch();
    renderWithProviders(
      <Routes>
        <Route path="/student/:id/syllabi/:syllabusId" element={<StudentSyllabusDetailPage />} />
      </Routes>,
      {
        user: buildUser({ role: "coach", id: 2 }),
        initialEntries: ["/student/4/syllabi/2?focus=sst:42"],
      },
    );
    // The technique name lives in the row header alongside other text, so assert
    // against the row's full text content rather than an exact-text query.
    await waitFor(() => {
      const rowEl = document.getElementById("technique-row-5");
      expect(rowEl?.textContent ?? "").toContain("Knee Cut Pass");
    });
    // The accordion item for sst 42 is expanded (its content region is present).
    await waitFor(() =>
      expect(document.querySelector('[data-state="open"]')).toBeTruthy(),
    );
    fetchSpy.mockRestore();
  });
});
