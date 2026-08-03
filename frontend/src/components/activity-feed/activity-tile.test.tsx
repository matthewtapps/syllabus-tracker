/**
 * ActivityTile rendering tests (browser project).
 *
 * One model for every tile kind: a teaser tile that never mutates on
 * interaction, linking to the subject in its real surface. Per kind, this
 * asserts that the teaser content renders, that it links to the right place,
 * and (for a technique) that the row does not expand in the feed. Stubs
 * window.fetch to hydrate the tiles; runs in CI's Chromium project only.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, buildUser } from "@/test/render";
import { ActivityTile } from "./activity-tile";
import type { ActivityRow } from "@/lib/activity-line";
import type {
  StudentSyllabusDetailResponse,
  SstRow,
  SyllabusAssignment,
  ThreadView as ThreadViewModel,
  Video,
} from "@/lib/api";

function row(overrides: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id: 1,
    occurred_at: new Date().toISOString(),
    verb: "sst_status_changed",
    actor_user_id: 2,
    actor_name: "Coach Lee",
    target_student_id: 4,
    target_student_name: "Sam Khan",
    technique_id: 5,
    technique_name: "Armbar",
    syllabus_id: 2,
    syllabus_name: "Blue Belt",
    sst_id: 42,
    video_id: null,
    video_title: null,
    payload_json: JSON.stringify({ from: "red", to: "amber" }),
    unread: false,
    context_kind: "syllabus",
    thread_id: null,
    camp_id: null,
    camp_name: null,
    comment_count: 0,
    ...overrides,
  };
}

function sst(overrides: Partial<SstRow> = {}): SstRow {
  return {
    id: 42,
    assignment_id: 9,
    technique_id: 5,
    technique_name: "Armbar",
    technique_description: "Isolate the arm.",
    is_global: true,
    status: "amber",
    student_notes: "",
    coach_notes: "",
    hidden_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_coach_update_at: null,
    last_coach_update_by_id: null,
    last_student_update_at: null,
    last_student_update_by_id: null,
    tags: [],
    attempt_count: 3,
    last_attempt_at: null,
    video_count: 2,
    ...overrides,
  };
}

function assignment(overrides: Partial<SyllabusAssignment> = {}): SyllabusAssignment {
  return {
    id: 9,
    student_id: 4,
    syllabus_id: 2,
    syllabus_name: "Blue Belt",
    assigned_at: new Date().toISOString(),
    assigned_by_id: 2,
    unassigned_at: null,
    unassigned_by_id: null,
    graduated_at: null,
    graduated_by_id: null,
    red_count: 1,
    amber_count: 1,
    green_count: 0,
    total_count: 2,
    last_activity_at: null,
    recent_attempt_count: 0,
    ...overrides,
  };
}

function thread(overrides: Partial<ThreadViewModel> = {}): ThreadViewModel {
  return {
    id: 7,
    anchor_kind: "sst",
    author_id: 2,
    author_name: "Coach Lee",
    visibility: "private",
    scope_student_id: 4,
    video_ts_seconds: null,
    body: "Nice work on this one.",
    created_at: new Date().toISOString(),
    deleted_at: null,
    comments: [],
    video: null,
    ...overrides,
  };
}

function video(overrides: Partial<Video> = {}): Video {
  return {
    id: 11,
    parent_kind: "technique",
    technique_id: 5,
    student_id: null,
    thread_id: null,
    camp_id: null,
    title: "Armbar drill, round 2",
    description: null,
    position: 0,
    kind: "link",
    processing_status: "ready",
    processing_error: null,
    bytes: null,
    duration_seconds: null,
    width: null,
    height: null,
    external_url: "https://example.com/clip",
    external_host: "example.com",
    external_video_id: null,
    uploaded_by_id: 2,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    hidden_at: null,
    ...overrides,
  };
}

// First match wins, so list the narrower paths first. Everything unmatched
// answers an empty array, which is what the panel's other blocks expect from
// their list endpoints.
function stubFetch(handlers: { match: string; json: unknown }[]) {
  return vi.fn().mockImplementation((url: string) => {
    const hit = handlers.find((h) => url.includes(h.match));
    return Promise.resolve(
      new Response(JSON.stringify(hit ? hit.json : []), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
}

describe("ActivityTile: technique kind", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;
  afterEach(() => fetchSpy?.mockRestore());

  const detail: StudentSyllabusDetailResponse = {
    assignment: assignment(),
    techniques: [sst()],
  };

  test("teases the row without expanding it in the feed", async () => {
    fetchSpy = vi.spyOn(window, "fetch").mockImplementation(
      stubFetch([
        { match: "/videos", json: { videos: [] } },
        { match: "/api/student/4/syllabi/2/techniques", json: detail },
      ]),
    );

    const { container } = renderWithProviders(<ActivityTile row={row()} />, {
      user: buildUser({ id: 2, role: "coach" }),
    });

    await waitFor(() => {
      expect(screen.getByText("Armbar")).toBeInTheDocument();
    });
    // Nothing expands here, so nothing claims it can.
    expect(container.querySelector("[aria-expanded]")).toBeNull();
    // A teaser is a preview, not a curation control panel.
    expect(screen.queryByRole("button", { name: /add to camp/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
  });

  test("links the row to the technique in its syllabus, opening no overlay", async () => {
    fetchSpy = vi.spyOn(window, "fetch").mockImplementation(
      stubFetch([
        { match: "/videos", json: { videos: [] } },
        { match: "/api/student/4/syllabi/2/techniques", json: detail },
      ]),
    );

    renderWithProviders(<ActivityTile row={row()} />, {
      user: buildUser({ id: 2, role: "coach" }),
    });

    await waitFor(() => {
      expect(screen.getByText("Armbar")).toBeInTheDocument();
    });

    expect(screen.getByText("Armbar").closest("a")).toHaveAttribute(
      "href",
      "/student/4/syllabi/2?focus=sst:42",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("a technique comment adds a comment teaser that targets the thread", async () => {
    fetchSpy = vi.spyOn(window, "fetch").mockImplementation(
      stubFetch([
        { match: "/videos", json: { videos: [] } },
        { match: "/api/threads", json: { threads: [thread({ comments: [] })] } },
        { match: "/api/student/4/syllabi/2/techniques", json: detail },
      ]),
    );

    renderWithProviders(
      <ActivityTile
        row={row({ verb: "thread_comment_posted", thread_id: 7, comment_count: 1 })}
      />,
      { user: buildUser({ id: 2, role: "coach" }) },
    );

    await waitFor(() => {
      expect(screen.getByText("Nice work on this one.")).toBeInTheDocument();
    });
    // One comment in the conversation, so there is nothing more to view.
    expect(screen.queryByText(/View all/)).toBeNull();

    // Same destination as the row, with the thread targeted inside it.
    expect(screen.getByText("Nice work on this one.").closest("a")).toHaveAttribute(
      "href",
      "/student/4/syllabi/2?focus=sst:42&thread=7",
    );
  });
});

describe("ActivityTile: thread kind", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;
  afterEach(() => fetchSpy?.mockRestore());

  const profileRow = row({
    verb: "thread_comment_posted",
    thread_id: 7,
    technique_id: null,
    technique_name: null,
    sst_id: null,
    context_kind: null,
    target_student_id: 4,
  });

  test("teases the conversation", async () => {
    fetchSpy = vi.spyOn(window, "fetch").mockImplementation(
      stubFetch([
        { match: "/api/threads", json: { threads: [thread({ anchor_kind: "student_profile" })] } },
      ]),
    );

    // A profile-anchored comment has no technique/video noun, so it renders the
    // thread directly (technique/video comments surface the noun instead).
    renderWithProviders(<ActivityTile row={profileRow} />, {
      user: buildUser({ id: 2, role: "coach" }),
    });

    await waitFor(() => {
      expect(screen.getByText("Nice work on this one.")).toBeInTheDocument();
    });
  });

  test("links the teaser to the thread on the profile that hosts it", async () => {
    fetchSpy = vi.spyOn(window, "fetch").mockImplementation(
      stubFetch([
        { match: "/api/threads", json: { threads: [thread({ anchor_kind: "student_profile" })] } },
      ]),
    );

    renderWithProviders(<ActivityTile row={profileRow} />, {
      user: buildUser({ id: 2, role: "coach" }),
    });

    await waitFor(() => {
      expect(screen.getByText("Nice work on this one.")).toBeInTheDocument();
    });

    expect(screen.getByText("Nice work on this one.").closest("a")).toHaveAttribute(
      "href",
      "/student/4?thread=7",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("ActivityTile: video kind", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;
  afterEach(() => fetchSpy?.mockRestore());

  const videoRow = row({ verb: "video_watched", video_id: 11, video_title: "Armbar drill" });

  test("teases the conversation under the player and links to the video", async () => {
    fetchSpy = vi.spyOn(window, "fetch").mockImplementation(
      stubFetch([
        { match: "/videos", json: { videos: [video()] } },
        {
          match: "/api/threads",
          json: { threads: [thread({ id: 8, anchor_kind: "video", body: "elbow tight" })] },
        },
      ]),
    );

    renderWithProviders(<ActivityTile row={videoRow} />, {
      user: buildUser({ id: 2, role: "coach" }),
    });

    await waitFor(() => {
      expect(screen.getByText("elbow tight")).toBeInTheDocument();
    });

    // The video in its surface (this row carries a syllabus context), with the
    // video itself focused so the surface scrolls to it.
    expect(screen.getByText("elbow tight").closest("a")).toHaveAttribute(
      "href",
      "/student/4/syllabi/2?focus=sst:42&video=11",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("a video with no threads still offers the tap target", async () => {
    fetchSpy = vi.spyOn(window, "fetch").mockImplementation(
      stubFetch([
        { match: "/videos", json: { videos: [video()] } },
        { match: "/api/threads", json: { threads: [] } },
      ]),
    );

    renderWithProviders(<ActivityTile row={videoRow} />, {
      user: buildUser({ id: 2, role: "coach" }),
    });

    await waitFor(() => {
      expect(screen.getByText("No comments yet")).toBeInTheDocument();
    });
  });
});

describe("ActivityTile: header-only kinds", () => {
  test("renders nothing for a non-noun activity", () => {
    const { container } = renderWithProviders(
      <ActivityTile
        row={row({ verb: "syllabus_assigned", technique_id: null, sst_id: null })}
      />,
      { user: buildUser({ id: 2, role: "coach" }) },
    );
    expect(container.textContent).toBe("");
  });
});
