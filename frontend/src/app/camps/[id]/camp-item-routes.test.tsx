/**
 * Camp item route tests (browser project).
 *
 * A camp owns its content, so a camp feed tile cannot navigate "to the surface
 * that owns it" the way a dashboard tile does: that surface is the camp page the
 * reader is already on. These two routes are the detail surface instead.
 *
 * 1. The technique route renders the technique and reads the CAMP-scoped
 *    conversation (anchor_kind=camp_technique + camp_id), never the global
 *    library conversation about the same technique.
 * 2. The thread route renders the whole discussion, root plus replies.
 *
 * Stubs window.fetch; runs in CI's Chromium project only.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { Routes, Route } from "react-router-dom";
import { renderWithProviders, buildUser } from "@/test/render";
import type { LibraryTechniqueRow } from "@/lib/api";

function technique(overrides: Partial<LibraryTechniqueRow> = {}): LibraryTechniqueRow {
  return {
    id: 7,
    name: "Scissor Sweep",
    description: "Classic scissor sweep from closed guard.",
    tags: [],
    collection_ids: [],
    collection_count: 0,
    student_count: 0,
    video_count: 0,
    last_activity_at: null,
    is_pinned: false,
    ...overrides,
  };
}

const CAMP = {
  id: 3,
  name: "X-guard Camp",
  student_id: 4,
  coach_id: 2,
  description: null,
  archived_at: null,
  techniques: [],
};

function thread(overrides: Record<string, unknown> = {}) {
  return {
    id: 99,
    anchor_kind: "camp",
    author_id: 2,
    author_name: "Coach Lee",
    visibility: "private",
    scope_student_id: 4,
    video_ts_seconds: null,
    body: "Keep the elbow tight.",
    video: null,
    created_at: new Date().toISOString(),
    deleted_at: null,
    comments: [],
    ...overrides,
  };
}

/**
 * Records every threads URL requested so a test can assert the anchor scope.
 *
 * `/api/threads/<id>` returns a bare thread and `/api/threads?anchor…` returns a
 * list, so the two are matched apart rather than by a shared prefix.
 */
function stubFetch(
  handlers: { threadList?: unknown; thread?: unknown },
  threadUrls: string[],
) {
  return vi.fn().mockImplementation((url: string) => {
    let json: unknown = {};
    if (/\/api\/threads\/\d+/.test(url)) {
      threadUrls.push(url);
      json = handlers.thread ?? {};
    } else if (url.includes("/api/threads")) {
      threadUrls.push(url);
      json = handlers.threadList ?? { threads: [] };
    } else if (url.includes("/techniques")) {
      json = { techniques: [technique()] };
    } else if (url.includes("/api/camps/")) {
      json = CAMP;
    }
    return Promise.resolve(
      new Response(JSON.stringify(json), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
}

describe("camp technique route", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;
  afterEach(() => fetchSpy?.mockRestore());

  test("renders the technique and reads the camp-scoped conversation", async () => {
    const threadUrls: string[] = [];
    fetchSpy = vi.spyOn(window, "fetch").mockImplementation(
      stubFetch(
        { threadList: { threads: [thread({ anchor_kind: "camp_technique" })] } },
        threadUrls,
      ),
    );

    const { default: CampTechniquePage } = await import(
      "./techniques/[techniqueId]/page"
    );
    renderWithProviders(
      <Routes>
        <Route path="/camps/:id/techniques/:techniqueId" element={<CampTechniquePage />} />
      </Routes>,
      {
        user: buildUser({ id: 2, role: "coach" }),
        initialEntries: ["/camps/3/techniques/7"],
      },
    );

    // The technique is named, and the camp it is being read inside is named too:
    // the page carries the context a sheet could not.
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Scissor Sweep" })).toBeInTheDocument();
    });
    expect(screen.getByText(/In X-guard Camp/)).toBeInTheDocument();

    // The discussion must be the camp's, not the global library's. Reading the
    // wrong conversation here would look plausible and be silently wrong.
    await waitFor(() => {
      expect(threadUrls.some((u) => u.includes("anchor_kind=camp_technique"))).toBe(true);
    });
    expect(threadUrls.every((u) => !u.includes("anchor_kind=technique&"))).toBe(true);
    expect(threadUrls.some((u) => u.includes("camp_id=3"))).toBe(true);
  });
});

describe("camp thread route", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;
  afterEach(() => fetchSpy?.mockRestore());

  test("renders the whole discussion, root and replies", async () => {
    const threadUrls: string[] = [];
    fetchSpy = vi.spyOn(window, "fetch").mockImplementation(
      stubFetch(
        {
          thread: thread({
            comments: [
              {
                id: 500,
                thread_id: 99,
                parent_comment_id: null,
                author_id: 4,
                author_name: "Sam Khan",
                body: "Felt way better this round.",
                video: null,
                video_ts_seconds: null,
                created_at: new Date().toISOString(),
                edited_at: null,
                deleted_at: null,
              },
            ],
          }),
        },
        threadUrls,
      ),
    );

    const { default: CampThreadPage } = await import("./threads/[threadId]/page");
    renderWithProviders(
      <Routes>
        <Route path="/camps/:id/threads/:threadId" element={<CampThreadPage />} />
      </Routes>,
      {
        user: buildUser({ id: 2, role: "coach" }),
        initialEntries: ["/camps/3/threads/99"],
      },
    );

    // The reply is what the feed teaser could only preview.
    await waitFor(() => {
      expect(screen.getByText(/Keep the elbow tight/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Felt way better this round/)).toBeInTheDocument();
    expect(screen.getByText(/In X-guard Camp/)).toBeInTheDocument();

    // Fetched by id, not by listing the camp's whole anchor.
    expect(threadUrls.some((u) => /\/api\/threads\/99/.test(u))).toBe(true);
    expect(threadUrls.every((u) => !u.includes("anchor_kind=camp&"))).toBe(true);
  });
});
