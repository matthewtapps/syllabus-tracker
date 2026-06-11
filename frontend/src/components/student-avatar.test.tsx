import { expect, test } from "vitest";
import { screen } from "@testing-library/react";
import { StudentAvatar } from "./student-avatar";
import { renderWithProviders } from "@/test/render";

test("renders initials from a display name", () => {
  renderWithProviders(<StudentAvatar id={1} name="Alex Rivera" />);
  expect(screen.getByText("AR")).toBeInTheDocument();
});

test("falls back to a question mark for an empty name", () => {
  renderWithProviders(<StudentAvatar id={2} name="" />);
  expect(screen.getByText("?")).toBeInTheDocument();
});
