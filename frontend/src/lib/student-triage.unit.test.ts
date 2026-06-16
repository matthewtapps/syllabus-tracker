import { describe, expect, it } from "vitest";
import { categorizeStudent, isStudentLed, TRIAGE_THRESHOLD_DAYS } from "./student-triage";
import type { User } from "./api";

const now = Date.parse("2026-06-11T12:00:00Z");
const recent = "2026-06-10T12:00:00Z";
const old = "2026-05-01T12:00:00Z";

function makeUser(overrides: Partial<User>): User {
  return {
    id: 1,
    username: "testuser",
    display_name: "Test User",
    role: "student",
    archived: false,
    ...overrides,
  };
}

describe("student triage", () => {
  it("active = recent student activity regardless of coach", () => {
    expect(categorizeStudent(makeUser({ last_student_activity_at: recent, last_coach_activity_at: recent }), now)).toBe("active");
    expect(categorizeStudent(makeUser({ last_student_activity_at: recent, last_coach_activity_at: old }), now)).toBe("active");
  });
  it("student-led = active and no recent coach activity", () => {
    expect(isStudentLed(makeUser({ last_student_activity_at: recent, last_coach_activity_at: old }), now)).toBe(true);
    expect(isStudentLed(makeUser({ last_student_activity_at: recent, last_coach_activity_at: recent }), now)).toBe(false);
  });
  it("coach-led = no recent student activity but recent coach activity", () => {
    expect(categorizeStudent(makeUser({ last_student_activity_at: old, last_coach_activity_at: recent }), now)).toBe("coach_led");
  });
  it("quiet = neither recent", () => {
    expect(categorizeStudent(makeUser({ last_student_activity_at: old, last_coach_activity_at: old }), now)).toBe("quiet");
    expect(categorizeStudent(makeUser({}), now)).toBe("quiet");
  });
  it("threshold is 14 days", () => {
    expect(TRIAGE_THRESHOLD_DAYS).toBe(14);
  });
});
