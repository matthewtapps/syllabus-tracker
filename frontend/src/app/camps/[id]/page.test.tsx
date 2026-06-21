/**
 * Camp detail page feed tests (browser project, CI-only).
 *
 * Verifies:
 *  - The feed renders activity rows from a stubbed `/api/camps/:id/feed`
 *  - The composer renders with an "Attach technique" button
 *  - A student sees the "Attach technique" button but no "Create new" tab in the picker
 *  - A coach sees both "Pick existing" and "Create new" tabs
 *  - Empty-state hint renders when the feed is empty
 *
 * Stubs window.fetch; runs in Chromium (CI only, not bare Vitest on NixOS).
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Routes, Route } from "react-router-dom";
import { renderWithProviders, buildUser } from "@/test/render";
import CampDetailPage from "./page";
import type { ActivityRow } from "@/lib/activity-line";

// Minimal camp detail response (matches backend CampDetailResponse / getCamp shape).
function buildCamp(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    student_id: 5,
    coach_id: 2,
    name: "Summer Camp 2026",
    description: null,
    created_at: "2026-06-01T00:00:00",
    archived_at: null,
    techniques: [],
    ...overrides,
  };
}

function buildFeedRow(overrides: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id: 1,
    occurred_at: new Date().toISOString(),
    verb: "thread_comment_posted",
    actor_user_id: 2,
    actor_name: "Coach Lee",
    target_student_id: 5,
    target_student_name: "Sam Khan",
    technique_id: null,
    technique_name: null,
    syllabus_id: null,
    syllabus_name: null,
    sst_id: null,
    video_id: null,
    video_title: null,
    payload_json: null,
    unread: false,
    context_kind: "camp",
    thread_id: 42,
    camp_id: 10,
    camp_name: "Summer Camp 2026",
    comment_count: 1,
    ...overrides,
  };
}

/**
 * Stub window.fetch for the three endpoints the camp page always calls:
 *  - /api/camps/10  → camp detail
 *  - /api/camps/10/feed  → paginated activity rows
 *  - /api/threads  → empty thread list (for ActivityTile hydration)
 * Any other URL returns 404.
 */
function stubFetch({
  camp = buildCamp(),
  feedRows = [] as ActivityRow[],
} = {}) {
  return vi.spyOn(window, "fetch").mockImplementation((input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;

    if (url.includes("/api/camps/10/feed")) {
      return Promise.resolve(
        new Response(JSON.stringify(feedRows), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    if (/\/api\/camps\/10(?:$|\?)/.test(url)) {
      return Promise.resolve(
        new Response(JSON.stringify(camp), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    if (url.includes("/api/threads")) {
      return Promise.resolve(
        new Response(JSON.stringify({ threads: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  });
}

/**
 * Render CampDetailPage inside a Routes tree so useParams receives the `:id`
 * param. The MemoryRouter from renderWithProviders is initialised with the
 * camp URL so the route matches immediately.
 */
function renderCampPage(user: ReturnType<typeof buildUser>) {
  return renderWithProviders(
    <Routes>
      <Route path="/camps/:id" element={<CampDetailPage />} />
    </Routes>,
    { user, initialEntries: ["/camps/10"] },
  );
}

describe("CampDetailPage feed", () => {
  let spy: ReturnType<typeof vi.spyOn> | null = null;
  afterEach(() => {
    spy?.mockRestore();
    spy = null;
  });

  test("renders empty-state hint when the feed has no rows", async () => {
    spy = stubFetch({ feedRows: [] });

    renderCampPage(buildUser({ id: 5, role: "student" }));

    await waitFor(() => {
      expect(
        screen.getByText(/Post a technique, video, or note to start this camp/i),
      ).toBeInTheDocument();
    });
  });

  test("renders feed rows returned by the camp feed API", async () => {
    spy = stubFetch({
      feedRows: [buildFeedRow({ id: 77, actor_name: "Coach Lee" })],
    });

    renderCampPage(buildUser({ id: 5, role: "student" }));

    // ActivityTileHeader renders the actor name.
    await waitFor(() => {
      expect(screen.getByText("Coach Lee")).toBeInTheDocument();
    });
  });

  test("student sees the composer with an Attach technique button", async () => {
    spy = stubFetch();

    renderCampPage(buildUser({ id: 5, role: "student" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /attach technique/i }),
      ).toBeInTheDocument();
    });
  });

  test("student picker shows only Pick existing, no Create new tab", async () => {
    const techLibrary = [
      {
        id: 99,
        name: "Triangle",
        description: "",
        tags: [],
        collection_ids: [],
        collection_count: 0,
        student_count: 0,
        video_count: 0,
        last_activity_at: null,
        is_pinned: false,
      },
    ];
    spy = vi.spyOn(window, "fetch").mockImplementation((input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      if (url.includes("/api/camps/10/feed"))
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      if (/\/api\/camps\/10(?:$|\?)/.test(url))
        return Promise.resolve(
          new Response(JSON.stringify(buildCamp()), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      // Library techniques endpoint.
      if (url.includes("/api/techniques") || url.includes("/api/library"))
        return Promise.resolve(
          new Response(JSON.stringify(techLibrary), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    renderCampPage(buildUser({ id: 5, role: "student" }));

    const attachBtn = await screen.findByRole("button", { name: /attach technique/i });
    await userEvent.click(attachBtn);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      // Students do not see a Create new tab.
      expect(screen.queryByRole("tab", { name: /create new/i })).toBeNull();
    });
  });

  test("coach picker shows both Pick existing and Create new tabs", async () => {
    spy = stubFetch({ camp: buildCamp({ coach_id: 2 }) });

    renderCampPage(buildUser({ id: 2, role: "coach" }));

    const attachBtn = await screen.findByRole("button", { name: /attach technique/i });
    await userEvent.click(attachBtn);

    await waitFor(() => {
      expect(
        screen.getByRole("tab", { name: /pick existing/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("tab", { name: /create new/i }),
      ).toBeInTheDocument();
    });
  });
});
