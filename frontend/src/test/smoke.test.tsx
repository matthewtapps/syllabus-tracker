import { describe, test, expect } from "vitest";
import { render, screen } from "@testing-library/react";

describe("test harness smoke", () => {
  test("renders DOM", () => {
    render(<button type="button">Hello world</button>);
    expect(screen.getByRole("button", { name: "Hello world" })).toBeInTheDocument();
  });
});
