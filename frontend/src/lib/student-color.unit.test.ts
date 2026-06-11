import { describe, expect, it } from "vitest";
import { studentColor, STUDENT_COLOR_PALETTE } from "./student-color";

describe("studentColor", () => {
  it("is deterministic: same id maps to the same pair", () => {
    expect(studentColor(42)).toEqual(studentColor(42));
  });

  it("returns a palette member", () => {
    const c = studentColor(123);
    expect(STUDENT_COLOR_PALETTE).toContainEqual(c);
  });

  it("spreads adjacent ids to different palette entries", () => {
    const a = studentColor(1);
    const b = studentColor(2);
    expect(a).not.toEqual(b);
  });
});
