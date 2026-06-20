/**
 * ActivityTile rendering tests (browser project).
 *
 * Stubs window.fetch to hydrate the embedded tiles. Verifies that a syllabus
 * technique activity embeds the technique row (with no curation chrome), a
 * comment activity embeds the thread, and a non-noun activity renders nothing
 * (header-only fallback). Runs in CI's Chromium project only.
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
    video_replies: [],
    ...overrides,
  };
}

function stubFetch(handlers: { match: string; json: unknown }[]) {
  return vi.fn().mockImplementation((url: string) => {
    const hit = handlers.find((h) => url.includes(h.match));
    return Promise.resolve(
      new Response(JSON.stringify(hit ? hit.json : {}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
}

describe("ActivityTile", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;
  afterEach(() => fetchSpy?.mockRestore());

  test("embeds the technique row for a syllabus activity, without curation chrome", async () => {
    const detail: StudentSyllabusDetailResponse = {
      assignment: assignment(),
      techniques: [sst()],
    };
    fetchSpy = vi.spyOn(window, "fetch").mockImplementation(
      stubFetch([{ match: "/api/student/4/syllabi/2/techniques", json: detail }]),
    );

    renderWithProviders(<ActivityTile row={row()} />, {
      user: buildUser({ id: 2, role: "coach" }),
    });

    await waitFor(() => {
      expect(screen.getByText("Armbar")).toBeInTheDocument();
    });
    // Embedded mode hides the curation chrome.
    expect(screen.queryByRole("button", { name: /add to camp/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
  });

  test("embeds the thread for a profile comment (no technique noun)", async () => {
    fetchSpy = vi.spyOn(window, "fetch").mockImplementation(
      stubFetch([
        { match: "/api/threads", json: { threads: [thread({ anchor_kind: "student_profile" })] } },
      ]),
    );

    // A profile-anchored comment has no technique/video noun, so it renders the
    // thread directly (technique/video comments surface the noun instead).
    renderWithProviders(
      <ActivityTile
        row={row({
          verb: "thread_comment_posted",
          thread_id: 7,
          technique_id: null,
          sst_id: null,
          context_kind: null,
          target_student_id: 4,
        })}
      />,
      { user: buildUser({ id: 2, role: "coach" }) },
    );

    await waitFor(() => {
      expect(screen.getByText(/Nice work on this one/)).toBeInTheDocument();
    });
  });

  test("renders nothing for a non-noun activity (header-only fallback)", () => {
    const { container } = renderWithProviders(
      <ActivityTile
        row={row({ verb: "syllabus_assigned", technique_id: null, sst_id: null })}
      />,
      { user: buildUser({ id: 2, role: "coach" }) },
    );
    expect(container.textContent).toBe("");
  });
});
