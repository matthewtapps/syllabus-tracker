/**
 * Student camps list page (browser project). Asserts the coach-only "Add camp"
 * affordance: a coach viewing another student's camps sees the button, while a
 * student viewing their own camps does not.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";

import StudentCampsPage from "./page";
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
      return Promise.resolve(jsonResponse({ camps: [] }));
    }
    if (url.includes("/api/users")) {
      return Promise.resolve(
        jsonResponse([
          { id: 42, username: "stu", display_name: "Stu", role: "student", archived: false },
        ]),
      );
    }
    return Promise.resolve(jsonResponse({}));
  });
}

describe("StudentCampsPage / add-camp affordance", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;
  afterEach(() => fetchSpy?.mockRestore());

  test("coach sees Add camp for another student", async () => {
    fetchSpy = vi.spyOn(window, "fetch").mockImplementation(stubFetch());
    const coach = buildUser({ id: 1, role: "coach" });
    renderWithProviders(
      <Routes>
        <Route path="/student/:id/camps" element={<StudentCampsPage />} />
      </Routes>,
      { user: coach, initialEntries: ["/student/42/camps"] },
    );

    expect(
      await screen.findByRole("button", { name: /add camp/i }),
    ).toBeInTheDocument();
  });

  test("student does not see Add camp on own camps", async () => {
    fetchSpy = vi.spyOn(window, "fetch").mockImplementation(stubFetch());
    const student = buildUser({ id: 42, role: "student" });
    renderWithProviders(
      <Routes>
        <Route path="/student/:id/camps" element={<StudentCampsPage />} />
      </Routes>,
      { user: student, initialEntries: ["/student/42/camps"] },
    );

    await screen.findByText("My camps");
    expect(
      screen.queryByRole("button", { name: /add camp/i }),
    ).toBeNull();
  });
});
