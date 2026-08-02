/**
 * Camp detail page tests (browser project, CI-only).
 *
 * Verifies:
 *  - The page renders components from a stubbed `/api/camps/:id/components`
 *  - A note component renders in full, not as a teaser
 *  - The composer renders with an "Attach technique" button
 *  - A student sees the "Attach technique" button but no "Create new" tab in the picker
 *  - A coach sees both "Pick existing" and "Create new" tabs
 *  - Empty-state hint renders when the camp holds nothing
 *
 * Stubs window.fetch; runs in Chromium (CI only, not bare Vitest on NixOS).
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Routes, Route } from "react-router-dom";
import { renderWithProviders, buildUser } from "@/test/render";
import CampDetailPage from "./page";
import type { CampComponent, ThreadView } from "@/lib/api";

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
    ...overrides,
  };
}

function buildThread(overrides: Partial<ThreadView> = {}): ThreadView {
  return {
    id: 42,
    anchor_kind: "camp",
    author_id: 2,
    author_name: "Coach Lee",
    visibility: "private",
    scope_student_id: 5,
    video_ts_seconds: null,
    body: "Drill the grip break every round.",
    video: null,
    created_at: "2026-06-02T00:00:00",
    deleted_at: null,
    comments: [],
    ...overrides,
  };
}

function buildNoteComponent(thread = buildThread()): CampComponent {
  return {
    kind: "note",
    id: thread.id,
    last_touch: "2026-06-02 00:00:00",
    technique: null,
    thread,
    video: null,
    threads: [],
  };
}

/**
 * Stub window.fetch for the three endpoints the camp page always calls:
 *  - /api/camps/10  -> camp detail
 *  - /api/camps/10/components  -> a page of camp components
 *  - /api/threads  -> empty thread list
 * Any other URL returns 404.
 */
function stubFetch({
  camp = buildCamp(),
  components = [] as CampComponent[],
} = {}) {
  return vi.spyOn(window, "fetch").mockImplementation((input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;

    if (url.includes("/api/camps/10/components")) {
      return Promise.resolve(
        new Response(JSON.stringify({ components, next_cursor: null }), {
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

describe("CampDetailPage components", () => {
  let spy: ReturnType<typeof vi.spyOn> | null = null;
  afterEach(() => {
    spy?.mockRestore();
    spy = null;
  });

  test("renders empty-state hint when the camp holds nothing", async () => {
    spy = stubFetch({ components: [] });

    renderCampPage(buildUser({ id: 5, role: "student" }));

    await waitFor(() => {
      expect(
        screen.getByText(/Post a technique, video, or note to start this camp/i),
      ).toBeInTheDocument();
    });
  });

  test("renders a note component in full, body and all", async () => {
    spy = stubFetch({ components: [buildNoteComponent()] });

    renderCampPage(buildUser({ id: 5, role: "student" }));

    await waitFor(() => {
      expect(screen.getByText("Coach Lee")).toBeInTheDocument();
      // The whole thread renders here; a teaser would not carry the composer.
      expect(
        screen.getByText(/Drill the grip break every round/i),
      ).toBeInTheDocument();
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
      if (url.includes("/api/camps/10/components"))
        return Promise.resolve(
          new Response(JSON.stringify({ components: [], next_cursor: null }), {
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
