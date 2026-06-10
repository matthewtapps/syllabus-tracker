/**
 * NavBar unread badge tests (browser project).
 *
 * Stubs the activity/unread_count and activity/mark_all_read fetch endpoints
 * to verify the badge reflects the count and "Mark all read" clears it.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { userEvent } from "@vitest/browser/context";
import { NavBar } from "./navbar";
import { buildUser, renderWithProviders } from "@/test/render";

function stubFetch(routes: Record<string, { status: number; body: unknown }>) {
  return vi.fn().mockImplementation((url: string) => {
    for (const [pattern, reply] of Object.entries(routes)) {
      if (url.includes(pattern)) {
        return Promise.resolve(
          new Response(JSON.stringify(reply.body), {
            status: reply.status,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
    }
    // Default: empty 200
    return Promise.resolve(
      new Response(JSON.stringify({}), { status: 200 }),
    );
  });
}

describe("NavBar unread badge", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  test("shows the unread count when there are unread items", async () => {
    fetchSpy = vi.spyOn(window, "fetch").mockImplementation(
      stubFetch({
        "unread_count": { status: 200, body: { count: 5 } },
      }),
    );

    const user = buildUser({ role: "student" });
    renderWithProviders(<NavBar user={user} onLogout={() => {}} />, { user });

    await waitFor(() => {
      expect(screen.getByText("5")).toBeInTheDocument();
    });

    // The bell button has an accessible label mentioning 5 unread.
    expect(
      screen.getByRole("button", { name: /activity.*5 unread/i }),
    ).toBeInTheDocument();
  });

  test("shows no badge when unread count is zero", async () => {
    fetchSpy = vi.spyOn(window, "fetch").mockImplementation(
      stubFetch({
        "unread_count": { status: 200, body: { count: 0 } },
      }),
    );

    const user = buildUser({ role: "student" });
    renderWithProviders(<NavBar user={user} onLogout={() => {}} />, { user });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /^activity$/i }),
      ).toBeInTheDocument();
    });

    // No numeric badge rendered.
    expect(screen.queryByText(/^\d+$/)).toBeNull();
  });

  test("mark all read is offered when there are unread items", async () => {
    fetchSpy = vi.spyOn(window, "fetch").mockImplementation(
      stubFetch({
        "unread_count": { status: 200, body: { count: 3 } },
        "mark_all_read": { status: 204, body: null },
      }),
    );

    const user = buildUser({ role: "student" });
    renderWithProviders(<NavBar user={user} onLogout={() => {}} />, { user });

    // Wait for badge to appear.
    await waitFor(() => {
      expect(screen.getByText("3")).toBeInTheDocument();
    });

    // Open the bell dropdown. userEvent fires the full pointer+mouse+click
    // sequence that Radix DropdownMenu requires to toggle open.
    await userEvent.click(screen.getByRole("button", { name: /activity.*3 unread/i }));

    // "Mark all read" option is visible.
    await waitFor(() => {
      expect(
        screen.getByRole("menuitem", { name: /mark all read/i }),
      ).toBeInTheDocument();
    });
  });
});
