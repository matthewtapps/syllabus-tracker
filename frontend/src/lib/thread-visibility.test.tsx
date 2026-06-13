import { describe, it, expect } from "vitest";
import { deriveThreadVisibility } from "./thread-visibility";
import { buildUser } from "@/test/render";

const coach = buildUser({ id: 1, role: "coach" });
const student = buildUser({ id: 9, role: "student" });

describe("deriveThreadVisibility", () => {
  it("coach on the global library starts a broadcast thread", () => {
    expect(deriveThreadVisibility({ kind: "library" }, coach)).toEqual({
      visibility: "broadcast",
      scope_student_id: null,
    });
  });
  it("coach on a student surface scopes the thread to that student", () => {
    expect(deriveThreadVisibility({ kind: "student", studentId: 9 }, coach)).toEqual({
      visibility: "private",
      scope_student_id: 9,
    });
  });
  it("a student always posts privately scoped to themselves (library)", () => {
    expect(deriveThreadVisibility({ kind: "library" }, student)).toEqual({
      visibility: "private",
      scope_student_id: 9,
    });
  });
  it("a student always posts privately scoped to themselves (student surface)", () => {
    expect(deriveThreadVisibility({ kind: "student", studentId: 9 }, student)).toEqual({
      visibility: "private",
      scope_student_id: 9,
    });
  });
});
