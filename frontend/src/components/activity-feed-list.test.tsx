/**
 * ActivityFeedList rendering tests (browser project).
 *
 * Verifies the list renders actor names and activity lines, shows custom empty
 * text when there are no rows, applies the stretched-link pattern (overlay
 * anchor + separate N-more link), and shows the context surface chip.
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
  // --- stretched-link: whole-row overlay (plan Task 14) ---
  test("renders the overlay link with aria-label pointing to the deep-link href", () => {
    renderWithProviders(<ActivityFeedList rows={[row({})]} isLoading={false} />);
    // The overlay anchor has no visible text; find it by its aria-label.
    const link = screen.getByRole("link", { name: /Alex Rivera logged an attempt on Knee Cut Pass/i });
    expect(link.getAttribute("href")).toBe("/student/4/syllabi/2?focus=sst:42");
  });

  test("renders actor name and activity text inside the content div", () => {
    renderWithProviders(<ActivityFeedList rows={[row({})]} isLoading={false} />);
    expect(screen.getByText("Alex Rivera")).toBeTruthy();
    expect(screen.getByText(/logged an attempt on/)).toBeTruthy();
    expect(screen.getByText(/Knee Cut Pass/)).toBeTruthy();
  });

  test("renders a non-link row when there is no href", () => {
    renderWithProviders(
      <ActivityFeedList
        rows={[row({ verb: "performed_unknown", technique_id: null, sst_id: null })]}
        isLoading={false}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("performed an action")).toBeTruthy();
  });

  // --- existing coverage (layout-adapted) ---
  test("renders actor name and activity line for one row", () => {
    renderWithProviders(
      <ActivityFeedList rows={[row({ technique_name: "Armbar" })]} isLoading={false} />,
    );
    expect(screen.getByText("Alex Rivera")).toBeTruthy();
    // verb and subject render as one combined node now (no bolding), so match
    // the whole phrase rather than the two pieces separately.
    expect(screen.getByText("logged an attempt on Armbar")).toBeTruthy();
  });

  test("empty state shows emptyText", () => {
    renderWithProviders(
      <ActivityFeedList rows={[]} isLoading={false} emptyText="Nothing here yet." />,
    );
    expect(screen.getByText("Nothing here yet.")).toBeTruthy();
  });

  // --- coalesced feed: separate N-more link (plan Task 14) ---
  test("coalesced feed renders an overlay link AND a separate N-more link to the student activity page", () => {
    const rows = [
      row({ id: 2, technique_name: "Armbar" }),
      row({ id: 1, technique_name: "Triangle" }),
    ];
    renderWithProviders(
      <ActivityFeedList rows={rows} isLoading={false} coalesce />,
    );
    // There should be exactly two links: the overlay and the N-more.
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);

    // The N-more link now has its own aria-label and points to the per-student activity page.
    const nMoreLink = screen.getByRole("link", { name: /See all of Alex Rivera's activity/i });
    expect(nMoreLink.getAttribute("href")).toBe("/student/2/activity");

    // The overlay link still points to the deep-link destination.
    const overlayLink = screen.getByRole("link", { name: /Alex Rivera logged an attempt on Armbar/i });
    expect(overlayLink.getAttribute("href")).toBe("/student/4/syllabi/2?focus=sst:42");
  });

  // --- new: no-href coalesced row keeps the N-more link ---
  test("coalesced no-href rows: no overlay link but N-more link to student activity page is still present", () => {
    // Use a verb that yields no href when technique fields are missing (default branch).
    const noHrefRow = (id: number) =>
      row({
        id,
        verb: "sst_hidden",
        technique_id: null,
        technique_name: null,
        sst_id: null,
        syllabus_id: null,
        syllabus_name: null,
      });
    renderWithProviders(
      <ActivityFeedList rows={[noHrefRow(1), noHrefRow(2)]} isLoading={false} coalesce />,
    );
    // No overlay link should be rendered (line.href is undefined).
    const links = screen.getAllByRole("link");
    // Only the N-more link should be present (no overlay).
    expect(links).toHaveLength(1);
    const nMoreLink = links[0];
    expect(nMoreLink.getAttribute("href")).toBe("/student/2/activity");
    expect(nMoreLink).toBeTruthy();
  });

  // --- new: detailed prop shows absolute timestamp and full actor name ---
  test("detailed prop shows absolute timestamp and full actor name", () => {
    const fixedDate = new Date("2026-03-15T10:00:00.000Z").toISOString();
    renderWithProviders(
      <ActivityFeedList
        rows={[row({ occurred_at: fixedDate, actor_name: "Jordan Blake" })]}
        isLoading={false}
        detailed
      />,
    );
    // The year 2026 should appear in the absolute timestamp format.
    expect(screen.getByText(/2026/)).toBeTruthy();
    // The full actor name should be present in the DOM.
    expect(screen.getByText("Jordan Blake")).toBeTruthy();
  });

  // --- Feature A: verb icon shown when showAvatar={false} ---
  test("renders verb-icon container when showAvatar is false", () => {
    renderWithProviders(
      <ActivityFeedList rows={[row({})]} isLoading={false} showAvatar={false} />,
    );
    expect(screen.getByTestId("verb-icon-container")).toBeTruthy();
  });

  test("does not render verb-icon container when showAvatar is true", () => {
    renderWithProviders(
      <ActivityFeedList rows={[row({})]} isLoading={false} showAvatar />,
    );
    expect(screen.queryByTestId("verb-icon-container")).toBeNull();
  });

  // --- context surface chip (plan Task 12, preserved in Task 14) ---
  test("syllabus-context row shows the syllabus name chip", () => {
    renderWithProviders(
      <ActivityFeedList rows={[row({ syllabus_name: "Blue Belt" })]} isLoading={false} />,
    );
    expect(screen.getByText("Blue Belt")).toBeTruthy();
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
    expect(screen.getByText("Library")).toBeTruthy();
  });
});
