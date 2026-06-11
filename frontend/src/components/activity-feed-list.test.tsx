/**
 * ActivityFeedList rendering tests (browser project).
 *
 * Verifies the list renders actor names and activity lines, shows custom empty
 * text when there are no rows, and applies the "and N more" coalescing suffix.
 */
import { describe, expect, test } from "vitest";
import { screen } from "@testing-library/react";
import { ActivityFeedList } from "./activity-feed-list";
import { renderWithProviders } from "@/test/render";
import type { ActivityRow } from "@/lib/activity-line";

function makeRow(p: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id: 1,
    occurred_at: "2026-06-11T00:00:00Z",
    verb: "attempt_logged",
    actor_user_id: 1,
    actor_name: "Alex",
    target_student_id: 1,
    technique_id: 1,
    technique_name: "Armbar",
    syllabus_id: null,
    syllabus_name: null,
    sst_id: null,
    video_id: null,
    video_title: null,
    payload_json: null,
    unread: false,
    context_kind: null,
    ...p,
  };
}

describe("ActivityFeedList", () => {
  test("renders actor name and activity line for one row", async () => {
    renderWithProviders(
      <ActivityFeedList rows={[makeRow()]} isLoading={false} />,
    );

    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.getByText("logged an attempt on Armbar")).toBeInTheDocument();
  });

  test("empty state shows emptyText", async () => {
    renderWithProviders(
      <ActivityFeedList rows={[]} isLoading={false} emptyText="Nothing here yet." />,
    );

    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
  });

  test("with coalesce, two consecutive same-actor same-verb rows show 'and 1 more' suffix", async () => {
    const rows = [
      makeRow({ id: 2, technique_name: "Armbar" }),
      makeRow({ id: 1, technique_name: "Triangle" }),
    ];

    renderWithProviders(
      <ActivityFeedList rows={rows} isLoading={false} coalesce />,
    );

    expect(screen.getByText(/logged an attempt on Armbar and 1 more/)).toBeInTheDocument();
  });
});
