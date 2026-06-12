/**
 * Students-list page activity triage tests (browser project).
 *
 * Stubs window.fetch to return one Active student and one Coach-led student.
 * The Active tab now gathers both; the Student-led pill narrows to own-activity.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { screen } from "@testing-library/react";
import StudentsListPage from "./page";
import { buildUser, renderWithProviders } from "@/test/render";

const now = new Date();
const recentIso = new Date(now.getTime() - 3 * 86400 * 1000).toISOString(); // 3 days ago
const oldIso = new Date(now.getTime() - 30 * 86400 * 1000).toISOString();   // 30 days ago

const activeStudent = buildUser({
  id: 10,
  username: "alice",
  display_name: "Alice Active",
  role: "student",
  last_student_activity_at: recentIso,
  last_coach_activity_at: oldIso,
});

const coachLedStudent = buildUser({
  id: 20,
  username: "bob",
  display_name: "Bob CoachLed",
  role: "student",
  last_student_activity_at: oldIso,
  last_coach_activity_at: recentIso,
});

const coach = buildUser({ id: 1, username: "coach", display_name: "Coach", role: "coach" });

describe("StudentsListPage / activity triage", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;

  function stubStudents() {
    const mockFn = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/students")) {
        return Promise.resolve(
          new Response(JSON.stringify([activeStudent, coachLedStudent]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    });
    fetchSpy = vi.spyOn(window, "fetch").mockImplementation(mockFn);
  }

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  test("default Active tab (Everyone) shows both active and coach-led students", async () => {
    stubStudents();

    renderWithProviders(<StudentsListPage />, { user: coach });

    expect(await screen.findByText("Alice Active")).toBeInTheDocument();
    expect(screen.getByText("Bob CoachLed")).toBeInTheDocument();
  });

  test("Student-led pill narrows Active to own-activity students", async () => {
    stubStudents();

    renderWithProviders(<StudentsListPage />, {
      user: coach,
      initialEntries: ["/?view=student_led"],
    });

    // Student-led student stays.
    expect(await screen.findByText("Alice Active")).toBeInTheDocument();

    // Coach-led student is filtered out.
    expect(screen.queryByText("Bob CoachLed")).toBeNull();
  });
});
