import { describe, expect, test } from "vitest";
import { screen } from "@testing-library/react";
import { AuthErrorBoundary } from "./auth-error-boundary";
import { useUser } from "@/lib/current-user-context";
import { renderWithProviders } from "@/test/render";

// useUser throws when there is no CurrentUserProvider above it. The error
// boundary should catch the throw and render the recovery panel rather than
// letting React unmount the whole tree.
function ThrowsWithoutProvider() {
  useUser();
  return null;
}

describe("AuthErrorBoundary", () => {
  test("catches a useUser() throw and renders the recovery panel", () => {
    renderWithProviders(
      <AuthErrorBoundary>
        <ThrowsWithoutProvider />
      </AuthErrorBoundary>,
      { user: null },
    );

    expect(screen.getByRole("heading", { name: /session lost/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refresh/i })).toBeInTheDocument();
  });

  test("renders children normally when no error is thrown", () => {
    renderWithProviders(
      <AuthErrorBoundary>
        <p>Healthy tree</p>
      </AuthErrorBoundary>,
    );

    expect(screen.getByText("Healthy tree")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /session lost/i })).toBeNull();
  });
});
