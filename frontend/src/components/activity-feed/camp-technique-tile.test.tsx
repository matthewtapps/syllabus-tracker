/**
 * camp_technique feed tile tests (browser project).
 *
 * 1. A camp_technique activity row (camp_id + technique_id + context_kind="camp")
 *    renders a technique card rather than a bare comment tile.
 * 2. The "pick existing" path in the technique picker posts a camp_technique
 *    thread via POST /api/threads with the right payload.
 *
 * Stubs window.fetch; runs in CI's Chromium project only.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { Routes, Route } from "react-router-dom";
import { renderWithProviders, buildUser } from "@/test/render";
import { ActivityTile } from "./activity-tile";
import type { ActivityRow } from "@/lib/activity-line";
import type { LibraryTechniqueRow } from "@/lib/api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function campTechniqueRow(overrides: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id: 1,
    occurred_at: new Date().toISOString(),
    verb: "thread_comment_posted",
    actor_user_id: 2,
    actor_name: "Coach Lee",
    target_student_id: 4,
    target_student_name: "Sam Khan",
    technique_id: 7,
    technique_name: "Scissor Sweep",
    syllabus_id: null,
    syllabus_name: null,
    sst_id: null,
    video_id: null,
    video_title: null,
    payload_json: null,
    unread: false,
    context_kind: "camp",
    thread_id: 99,
    camp_id: 3,
    camp_name: "X-guard Camp",
    comment_count: 1,
    ...overrides,
  };
}

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

function stubFetch(handlers: { match: string; json: unknown; status?: number }[]) {
  return vi.fn().mockImplementation((url: string) => {
    const hit = handlers.find((h) => url.includes(h.match));
    return Promise.resolve(
      new Response(JSON.stringify(hit ? hit.json : {}), {
        status: hit?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("camp_technique tile rendering", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;
  afterEach(() => fetchSpy?.mockRestore());

  test("a camp_technique row renders as a technique card, not a bare comment", async () => {
    // Stub the library endpoint so TechniqueTile can hydrate the technique.
    fetchSpy = vi.spyOn(window, "fetch").mockImplementation(
      stubFetch([
        { match: "/api/techniques", json: [technique()] },
        // threads endpoint may be called by the discussion block once expanded
        { match: "/api/threads", json: { threads: [] } },
      ]),
    );

    renderWithProviders(<ActivityTile row={campTechniqueRow()} />, {
      user: buildUser({ id: 2, role: "coach" }),
    });

    // The technique name must appear in the card.
    await waitFor(() => {
      expect(screen.getByText("Scissor Sweep")).toBeInTheDocument();
    });

    // The row must NOT have rendered as a plain text comment tile — no
    // "discussion" heading is visible before the accordion is opened.
    expect(screen.queryByText(/discussion/i)).toBeNull();
  });

  test("a plain camp thread (no technique_id) still renders as a thread tile, not a technique card", async () => {
    fetchSpy = vi.spyOn(window, "fetch").mockImplementation(
      stubFetch([
        {
          match: "/api/threads",
          json: {
            threads: [
              {
                id: 99,
                anchor_kind: "camp",
                author_id: 2,
                author_name: "Coach Lee",
                visibility: "private",
                scope_student_id: 4,
                video_ts_seconds: null,
                body: "Great session today.",
                video: null,
                created_at: new Date().toISOString(),
                deleted_at: null,
                comments: [],
              },
            ],
          },
        },
      ]),
    );

    renderWithProviders(
      <ActivityTile
        row={campTechniqueRow({
          technique_id: null,
          technique_name: null,
        })}
      />,
      { user: buildUser({ id: 2, role: "coach" }) },
    );

    // The thread body text must appear.
    await waitFor(() => {
      expect(screen.getByText(/Great session today/)).toBeInTheDocument();
    });

    // The technique name must NOT appear — no technique card was rendered.
    expect(screen.queryByText("Scissor Sweep")).toBeNull();
  });
});

describe("camp technique picker — thread posting", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;
  afterEach(() => fetchSpy?.mockRestore());

  test("pick-existing submits a camp_technique thread with empty body", async () => {
    const posted: unknown[] = [];

    fetchSpy = vi.spyOn(window, "fetch").mockImplementation(
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes("/api/techniques") && (!init || init.method !== "POST")) {
          return Promise.resolve(
            new Response(JSON.stringify([technique()]), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        if (url.includes("/api/threads") && init?.method === "POST") {
          posted.push(JSON.parse(init.body as string));
          return Promise.resolve(
            new Response(JSON.stringify({ id: 101 }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        // camp feed endpoint — must be checked before the general camp endpoint
        if (url.includes("/api/camps/") && url.includes("/feed")) {
          return Promise.resolve(
            new Response(JSON.stringify([]), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        // camp data endpoint
        if (url.includes("/api/camps/")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 3,
                name: "X-guard Camp",
                student_id: 4,
                coach_id: 2,
                description: null,
                archived_at: null,
                techniques: [],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          );
        }
        return Promise.resolve(
          new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
        );
      }),
    );

    // Render the camp page inside a matched Route so useParams returns the
    // camp id. Without a <Route path="/camps/:id">, useParams() returns {}
    // and the page immediately redirects rather than loading.
    const { default: CampDetailPage } = await import("@/app/camps/[id]/page");
    renderWithProviders(
      <Routes>
        <Route path="/camps/:id" element={<CampDetailPage />} />
      </Routes>,
      {
        user: buildUser({ id: 2, role: "coach" }),
        initialEntries: ["/camps/3"],
      },
    );

    // Wait for the camp to load.
    await waitFor(() => {
      expect(screen.getByText("Attach technique")).toBeInTheDocument();
    });

    // Open the picker dialog.
    fireEvent.click(screen.getByRole("button", { name: /attach technique/i }));

    // Wait for the library techniques to load and the technique to appear.
    await waitFor(() => {
      expect(screen.getByText("Scissor Sweep")).toBeInTheDocument();
    });

    // Select the technique and click Add. The checkbox is labelled by the
    // technique name (the <label> wraps both the Checkbox and the name text).
    fireEvent.click(screen.getByRole("checkbox", { name: /scissor sweep/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /add 1 technique/i }),
      ).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: /add 1 technique/i }));

    // After success, a POST to /api/threads should have been made with the
    // camp_technique anchor and an empty body.
    await waitFor(() => {
      expect(posted.length).toBeGreaterThan(0);
    });

    const payload = posted[0] as Record<string, unknown>;
    expect(payload.anchor_kind).toBe("camp_technique");
    expect(payload.anchor_id).toBe(7);
    expect(payload.camp_id).toBe(3);
    expect(payload.body).toBe("");
    expect(payload.visibility).toBe("private");
    expect(payload.scope_student_id).toBe(4);
  });
});
