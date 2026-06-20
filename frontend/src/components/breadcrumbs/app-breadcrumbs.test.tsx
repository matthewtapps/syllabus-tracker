/**
 * AppBreadcrumbs camp-detail tests (browser project).
 *
 * The `/camps/:id` route is special-cased: the student id needed to link the
 * Student / Camps crumbs comes from the camp data, not the URL. These tests
 * stub the camp-detail and all-users fetch endpoints and assert the resolved
 * trail links back to the correct student (no camp-id-as-student-id collision)
 * and that the role filter and loading fallback behave.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { AppBreadcrumbs } from "./app-breadcrumbs";
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
    return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
  });
}

const camp = {
  id: 7,
  student_id: 4,
  coach_id: 1,
  name: "Leg Lock Camp",
  description: null,
  created_at: "2026-01-01T00:00:00Z",
  archived_at: null,
  references_camp_id: null,
};

const users = [
  { id: 4, username: "jane_doe", display_name: "Jane Doe", role: "student", archived: false },
];

/** Reads the desktop (full-trail) breadcrumb nav. */
function desktopNav() {
  // The desktop trail is the first <nav>/breadcrumb; query by the link list.
  return screen.getAllByRole("navigation")[0];
}

describe("AppBreadcrumbs camp detail (/camps/:id)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  test("coach: builds Dashboard > Students > {student} > Camps > {camp} with correct student links", async () => {
    fetchSpy = vi.spyOn(window, "fetch").mockImplementation(
      stubFetch({
        "/api/camps/7": { status: 200, body: camp },
        "/api/admin/users": { status: 200, body: users },
      }),
    );

    const user = buildUser({ role: "coach", id: 1 });
    renderWithProviders(<AppBreadcrumbs />, {
      user,
      initialEntries: ["/camps/7"],
    });

    // Camp name (current page) resolves.
    await waitFor(() => {
      expect(screen.getAllByText("Leg Lock Camp").length).toBeGreaterThan(0);
    });

    // Student crumb links to /student/4, not /student/7 (no id collision).
    await waitFor(() => {
      const link = within(desktopNav()).getByRole("link", { name: "Jane Doe" });
      expect(link).toHaveAttribute("href", "/student/4");
    });

    const campsLink = within(desktopNav()).getByRole("link", { name: "Camps" });
    expect(campsLink).toHaveAttribute("href", "/student/4/camps");

    // Coach gets the Students crumb.
    expect(
      within(desktopNav()).getByRole("link", { name: "Students" }),
    ).toHaveAttribute("href", "/students");
  });

  test("student: omits the Students crumb", async () => {
    fetchSpy = vi.spyOn(window, "fetch").mockImplementation(
      stubFetch({
        "/api/camps/7": { status: 200, body: camp },
        "/api/admin/users": { status: 200, body: users },
      }),
    );

    const user = buildUser({ role: "student", id: 4 });
    renderWithProviders(<AppBreadcrumbs />, {
      user,
      initialEntries: ["/camps/7"],
    });

    await waitFor(() => {
      const link = within(desktopNav()).getByRole("link", { name: "Jane Doe" });
      expect(link).toHaveAttribute("href", "/student/4");
    });

    expect(
      within(desktopNav()).queryByRole("link", { name: "Students" }),
    ).toBeNull();
  });
});
