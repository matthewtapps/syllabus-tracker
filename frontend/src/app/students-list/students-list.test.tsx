/**
 * Students-list page activity triage tests (browser project).
 *
 * Mocks getStudents to return one Active student and one Coach-led student,
 * then asserts the default Active tab shows the active student only.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { screen } from "@testing-library/react";
import * as api from "@/lib/api";
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
  let studentsSpy: ReturnType<typeof vi.spyOn> | null = null;
  let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;

  afterEach(() => {
    studentsSpy?.mockRestore();
    fetchSpy?.mockRestore();
  });

  test("default Active tab shows active student and hides coach-led student", async () => {
    studentsSpy = vi
      .spyOn(api, "getStudents")
      .mockResolvedValue([activeStudent, coachLedStudent]);

    // Stub unread_count so NavBar (if rendered) doesn't throw.
    fetchSpy = vi.spyOn(window, "fetch").mockImplementation((input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
      if (url.includes("unread_count")) {
        return Promise.resolve(
          new Response(JSON.stringify({ count: 0 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({}), { status: 200 }),
      );
    });

    renderWithProviders(<StudentsListPage />, { user: coach });

    // Active student should appear.
    expect(await screen.findByText("Alice Active")).toBeInTheDocument();

    // Coach-led student should NOT appear on the Active tab.
    expect(screen.queryByText("Bob CoachLed")).toBeNull();
  });
});
