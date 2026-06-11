/**
 * ActivityFeedList rendering tests (browser project).
 *
 * Verifies the list renders actor names and activity lines, shows custom empty
 * text when there are no rows, applies the stretched-link pattern (overlay
 * anchor), and shows the context surface chip. Coalesced groups expand in place
 * via a toggle button rather than navigating to a separate page.
 */
import { describe, expect, test } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
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
  // --- stretched-link: whole-row overlay ---
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

  // --- existing coverage ---
  test("renders actor name and activity line for one row", () => {
    renderWithProviders(
      <ActivityFeedList rows={[row({ technique_name: "Armbar" })]} isLoading={false} />,
    );
    expect(screen.getByText("Alex Rivera")).toBeTruthy();
    expect(screen.getByText("logged an attempt on Armbar")).toBeTruthy();
  });

  test("empty state shows emptyText", () => {
    renderWithProviders(
      <ActivityFeedList rows={[]} isLoading={false} emptyText="Nothing here yet." />,
    );
    expect(screen.getByText("Nothing here yet.")).toBeTruthy();
  });

  // --- coalesced feed: expand in place via toggle button ---
  test("coalesced feed renders an overlay link AND a toggle button (not a nav link) for grouped rows", () => {
    const rows = [
      row({ id: 2, technique_name: "Armbar" }),
      row({ id: 1, technique_name: "Triangle" }),
    ];
    renderWithProviders(
      <ActivityFeedList rows={rows} isLoading={false} coalesce />,
    );

    // There should be exactly one link: the overlay for the representative row.
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);

    // The overlay link still points to the deep-link destination.
    const overlayLink = screen.getByRole("link", { name: /Alex Rivera logged an attempt on Armbar/i });
    expect(overlayLink.getAttribute("href")).toBe("/student/4/syllabi/2?focus=sst:42");

    // The N-more toggle is a button, not a link.
    const toggleBtn = screen.getByRole("button", { name: /and \d+ more/i });
    expect(toggleBtn).toBeTruthy();
    expect(toggleBtn.getAttribute("aria-expanded")).toBe("false");
  });

  test("coalesced toggle expands and reveals the additional member rows", () => {
    const rows = [
      row({ id: 2, technique_name: "Armbar" }),
      row({ id: 1, technique_name: "Triangle" }),
    ];
    renderWithProviders(
      <ActivityFeedList rows={rows} isLoading={false} coalesce />,
    );

    // Triangle is the second member; it should NOT be visible yet.
    expect(screen.queryByText(/Triangle/)).toBeNull();

    // Click the toggle button.
    const toggleBtn = screen.getByRole("button", { name: /and 1 more/i });
    fireEvent.click(toggleBtn);

    // After expansion, Triangle appears and button label changes.
    expect(screen.getByText(/Triangle/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Show less/i })).toBeTruthy();

    // Click again to collapse.
    fireEvent.click(screen.getByRole("button", { name: /Show less/i }));
    expect(screen.queryByText(/Triangle/)).toBeNull();
    expect(screen.getByRole("button", { name: /and 1 more/i })).toBeTruthy();
  });

  // --- no-href coalesced row: toggle button present, no overlay link ---
  test("coalesced no-href rows: no overlay link but toggle button is present", () => {
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
    // No overlay link (line.href is undefined).
    expect(screen.queryByRole("link")).toBeNull();
    // The toggle button is still present.
    const toggleBtn = screen.getByRole("button", { name: /and \d+ more/i });
    expect(toggleBtn).toBeTruthy();
  });

  // --- detailed prop shows absolute timestamp and full actor name ---
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

  // --- Feature A: inline verb icon present when coalesce=false, absent when coalesce=true ---
  test("renders inline verb-icon when coalesce is false (default)", () => {
    renderWithProviders(
      <ActivityFeedList rows={[row({})]} isLoading={false} />,
    );
    expect(screen.getByTestId("verb-icon")).toBeTruthy();
  });

  test("does not render inline verb-icon when coalesce is true", () => {
    renderWithProviders(
      <ActivityFeedList rows={[row({})]} isLoading={false} coalesce />,
    );
    expect(screen.queryByTestId("verb-icon")).toBeNull();
  });

  // --- context surface chip ---
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
