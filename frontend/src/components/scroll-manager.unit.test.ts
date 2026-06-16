import { describe, it, expect } from "vitest";
import { scrollActionFor } from "./scroll-manager";

describe("scrollActionFor", () => {
  it("resets to top on PUSH (link/button)", () => {
    expect(scrollActionFor("PUSH")).toBe("top");
  });

  it("restores on POP (back/forward)", () => {
    expect(scrollActionFor("POP")).toBe("restore");
  });

  it("does nothing on REPLACE (programmatic param strip)", () => {
    expect(scrollActionFor("REPLACE")).toBe("none");
  });
});
