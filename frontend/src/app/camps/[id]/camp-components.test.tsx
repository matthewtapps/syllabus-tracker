/**
 * Camp component rendering tests (browser project, CI-only).
 *
 * The camp renders its content full-fat: a technique mounts its expanded panel
 * rather than a teaser row, and the discussion that rides along with the
 * component read is used instead of refetched.
 *
 * Stubs window.fetch; runs in Chromium.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { Route, Routes } from "react-router-dom";
import CampDetailPage from "./page";
import { buildUser, renderWithProviders } from "@/test/render";
import { qk } from "@/lib/query-keys";
import type { CampComponent, LibraryTechniqueRow, ThreadView, Video } from "@/lib/api";

function buildCamp() {
  return {
    id: 10,
    student_id: 5,
    coach_id: 2,
    name: "Summer Camp 2026",
    description: null,
    created_at: "2026-06-01T00:00:00",
    archived_at: null,
  };
}

function buildTechnique(): LibraryTechniqueRow {
  return {
    id: 5,
    name: "Armbar from guard",
    description: "Break the posture before you swing the leg.",
    tags: [],
    collection_ids: [],
    collection_count: 0,
    student_count: 0,
    video_count: 0,
    last_activity_at: null,
    is_pinned: false,
  };
}

function buildThread(overrides: Partial<ThreadView> = {}): ThreadView {
  return {
    id: 71,
    anchor_kind: "camp_technique",
    author_id: 2,
    author_name: "Coach Lee",
    visibility: "private",
    scope_student_id: 5,
    video_ts_seconds: null,
    body: "Keep the elbow tight on the swing.",
    video: null,
    created_at: "2026-06-02T00:00:00",
    deleted_at: null,
    comments: [],
    ...overrides,
  };
}

function buildVideo(): Video {
  return {
    id: 31,
    parent_kind: "camp",
    technique_id: null,
    student_id: null,
    thread_id: null,
    camp_id: 10,
    title: "Sunday rolls",
    description: null,
    position: 0,
    kind: "native",
    processing_status: "ready",
    processing_error: null,
    storage_key: "videos/31.mp4",
    bytes: 1024,
    duration_seconds: 60,
    width: 1920,
    height: 1080,
    external_url: null,
    external_host: null,
    external_video_id: null,
    uploaded_by_id: 2,
    created_at: "2026-06-02T00:00:00",
    updated_at: "2026-06-02T00:00:00",
    hidden_at: null,
  } as Video;
}

function stubFetch(components: CampComponent[]) {
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
        new Response(JSON.stringify(buildCamp()), {
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
    return Promise.resolve(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
}

/** The app's caching, not the test default: the point of the component read is
 *  that a seeded discussion survives long enough to be read instead of
 *  refetched. */
function renderCamp(entry = "/camps/10") {
  return renderWithProviders(
    <Routes>
      <Route path="/camps/:id" element={<CampDetailPage />} />
    </Routes>,
    {
      user: buildUser({ id: 5, role: "student" }),
      initialEntries: [entry],
      queryClient: new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: 30_000 },
          mutations: { retry: false },
        },
      }),
    },
  );
}

describe("camp components", () => {
  let spy: ReturnType<typeof vi.spyOn> | null = null;
  afterEach(() => {
    spy?.mockRestore();
    spy = null;
  });

  test("a technique renders expanded, and its discussion is not refetched", async () => {
    const technique = buildTechnique();
    spy = stubFetch([
      {
        kind: "technique",
        id: technique.id,
        last_touch: "2026-06-02 00:00:00",
        technique,
        thread: null,
        video: null,
        threads: [buildThread()],
      },
    ]);

    renderCamp();

    await waitFor(() => {
      expect(screen.getByText("Armbar from guard")).toBeInTheDocument();
      // The expanded panel, not a teaser: the description block is mounted.
      expect(
        screen.getByText(/Break the posture before you swing the leg/i),
      ).toBeInTheDocument();
      // The hydrated discussion renders from the seeded cache.
      expect(
        screen.getByText(/Keep the elbow tight on the swing/i),
      ).toBeInTheDocument();
    });

    const calls = (spy.mock.calls as unknown[][]).map((c) => String(c[0]));
    expect(
      calls.some((url) => url.includes("anchor_kind=camp_technique")),
      "the camp read already carried this discussion",
    ).toBe(false);
  });

  test("a note picks up a reply written to its thread cache", async () => {
    const thread = buildThread({ id: 71, anchor_kind: "camp" });
    spy = stubFetch([
      {
        kind: "note",
        id: thread.id,
        last_touch: "2026-06-02 00:00:00",
        technique: null,
        thread,
        video: null,
        threads: [],
      },
    ]);

    const { queryClient } = renderCamp();

    await waitFor(() => {
      expect(
        screen.getByText(/Keep the elbow tight on the swing/i),
      ).toBeInTheDocument();
    });

    // What a reply does: writes the comment into the thread's own cache entry.
    queryClient.setQueryData(qk.thread(thread.id), {
      ...thread,
      comments: [
        {
          id: 900,
          thread_id: thread.id,
          parent_comment_id: null,
          author_id: 5,
          author_name: "Sam Khan",
          body: "Tried it tonight.",
          video: null,
          video_ts_seconds: null,
          created_at: "2026-06-03T00:00:00",
          deleted_at: null,
        },
      ],
    });

    await waitFor(() => {
      expect(screen.getByText(/Tried it tonight/i)).toBeInTheDocument();
    });
  });

  test("a camp-owned video is a component of its own", async () => {
    const video = buildVideo();
    spy = stubFetch([
      {
        kind: "video",
        id: video.id,
        last_touch: "2026-06-02 00:00:00",
        technique: null,
        thread: null,
        video,
        threads: [],
      },
    ]);

    renderCamp();

    await waitFor(() => {
      expect(screen.getByText("Sunday rolls")).toBeInTheDocument();
    });
  });

  test("a ?technique= anchor addresses that component", async () => {
    const technique = buildTechnique();
    spy = stubFetch([
      {
        kind: "technique",
        id: technique.id,
        last_touch: "2026-06-02 00:00:00",
        technique,
        thread: null,
        video: null,
        threads: [],
      },
    ]);

    const { container } = renderCamp("/camps/10?technique=5");

    await waitFor(() => {
      expect(
        container.querySelector('[data-component-key="technique:5"]'),
      ).not.toBeNull();
    });
  });
});
