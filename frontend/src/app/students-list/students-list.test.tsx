/**
 * Students-list page tests (browser project).
 *
 * Stubs window.fetch so the paged roster endpoint returns a two-page list.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StudentsListPage from "./page";
import { buildUser, renderWithProviders } from "@/test/render";

const alice = buildUser({
  id: 10,
  username: "alice",
  display_name: "Alice Active",
  role: "student",
  recent_activity_count: 3,
});

const bob = buildUser({
  id: 20,
  username: "bob",
  display_name: "Bob Quiet",
  role: "student",
  recent_activity_count: 0,
});

const coach = buildUser({ id: 1, username: "coach", display_name: "Coach", role: "coach" });

function jsonResponse(body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("StudentsListPage", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;
  const requested: string[] = [];

  function stubRoster() {
    requested.length = 0;
    const mockFn = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/students/page")) {
        requested.push(url);
        const params = new URLSearchParams(url.split("?")[1] ?? "");
        if (params.get("q")) {
          return jsonResponse({ items: [alice], total: 1 });
        }
        if (params.get("offset") === "1") {
          return jsonResponse({ items: [bob], total: 2 });
        }
        return jsonResponse({ items: [alice], total: 2 });
      }
      return jsonResponse({});
    });
    fetchSpy = vi.spyOn(window, "fetch").mockImplementation(mockFn);
  }

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  test("renders the first page and its total", async () => {
    stubRoster();

    renderWithProviders(<StudentsListPage />, { user: coach });

    expect(await screen.findByText("Alice Active")).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 students/)).toBeInTheDocument();
    // Students with their own recent activity get the proactive marker.
    expect(screen.getByLabelText("Working on their own this week")).toBeInTheDocument();
  });

  test("Load more appends the next page", async () => {
    stubRoster();

    renderWithProviders(<StudentsListPage />, { user: coach });
    await screen.findByText("Alice Active");

    await userEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByText("Bob Quiet")).toBeInTheDocument();
    expect(screen.getByText("Alice Active")).toBeInTheDocument();
  });

  test("search is handed to the server", async () => {
    stubRoster();

    renderWithProviders(<StudentsListPage />, { user: coach });
    await screen.findByText("Alice Active");

    await userEvent.type(screen.getByLabelText("Search for any student"), "ali");

    await vi.waitFor(() => {
      expect(requested.some((url) => url.includes("q=ali"))).toBe(true);
    });
  });
});
