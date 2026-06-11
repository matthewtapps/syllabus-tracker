/**
 * ActivityFeedList rendering tests (browser project).
 *
 * Verifies the list renders actor names and activity lines, shows custom empty
 * text when there are no rows, applies the "and N more" coalescing suffix, and
 * wraps linkable rows in a whole-row anchor.
 */
import { describe, expect, test } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { ActivityFeedList } from "./activity-feed-list";
import type { ActivityRow } from "@/lib/activity-line";

function row(overrides: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id: 1,
    occurred_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    verb: "attempt_logged",
    actor_user_id: 2,
    actor_name: "Alex Rivera",
    target_student_id: 4,
    technique_id: 5,
    technique_name: "Knee Cut Pass",
    syllabus_id: 2,
    syllabus_name: "Blue Belt",
    sst_id: 42,
    video_id: null,
    video_title: null,
    payload_json: null,
    unread: false,
    context_kind: null,
    ...overrides,
  };
}

describe("ActivityFeedList", () => {
  // --- whole-row link behavior (plan Task 5 requirement) ---
  test("renders the whole row as a link to the deep-link href", () => {
    renderWithProviders(<ActivityFeedList rows={[row({})]} isLoading={false} />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/student/4/syllabi/2?focus=sst:42");
    expect(link.textContent).toContain("Alex Rivera");
    expect(link.textContent).toContain("logged an attempt on");
    expect(link.textContent).toContain("Knee Cut Pass");
  });

  test("renders a non-link row when there is no href", () => {
    renderWithProviders(
      <ActivityFeedList
        rows={[row({ verb: "performed_unknown", technique_id: null, sst_id: null })]}
        isLoading={false}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("performed an action")).toBeInTheDocument();
  });

  // --- existing coverage (layout-adapted) ---
  test("renders actor name and activity line for one row", () => {
    renderWithProviders(
      <ActivityFeedList rows={[row({ technique_name: "Armbar" })]} isLoading={false} />,
    );
    expect(screen.getByText("Alex Rivera")).toBeInTheDocument();
    // verb and subject are rendered as a single uniform line now.
    expect(screen.getByText(/logged an attempt on Armbar/)).toBeInTheDocument();
  });

  test("empty state shows emptyText", () => {
    renderWithProviders(
      <ActivityFeedList rows={[]} isLoading={false} emptyText="Nothing here yet." />,
    );
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
  });

  test("with coalesce, two consecutive same-actor same-verb rows show 'and 1 more' suffix", () => {
    const rows = [
      row({ id: 2, technique_name: "Armbar" }),
      row({ id: 1, technique_name: "Triangle" }),
    ];
    renderWithProviders(
      <ActivityFeedList rows={rows} isLoading={false} coalesce />,
    );
    // The suffix is appended to the subject text node inside the description <p>.
    expect(screen.getByText(/Armbar and 1 more/)).toBeInTheDocument();
  });

  // --- context surface chip (plan Task 12) ---
  test("syllabus-context row shows the syllabus name chip", () => {
    renderWithProviders(
      <ActivityFeedList rows={[row({ syllabus_name: "Blue Belt" })]} isLoading={false} />,
    );
    expect(screen.getByText("Blue Belt")).toBeInTheDocument();
  });

  test("library-context video_watched row shows the Library chip", () => {
    renderWithProviders(
      <ActivityFeedList
        rows={[
          row({
            verb: "video_watched",
            context_kind: "library",
            technique_id: 5,
            video_id: 7,
            video_title: "Triangle setup",
            syllabus_id: null,
            sst_id: null,
            syllabus_name: null,
          }),
        ]}
        isLoading={false}
      />,
    );
    expect(screen.getByText("Library")).toBeInTheDocument();
  });
});
