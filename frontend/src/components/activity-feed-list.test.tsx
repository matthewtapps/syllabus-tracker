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
import { renderWithProviders, buildUser } from "@/test/render";
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
    thread_id: null,
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

  test("coach viewer can open the actor's profile from the avatar", () => {
    renderWithProviders(<ActivityFeedList rows={[row({})]} isLoading={false} />, {
      user: buildUser({ id: 99, role: "coach" }),
    });
    const profileLink = screen.getByRole("link", { name: /View Alex Rivera's profile/i });
    expect(profileLink.getAttribute("href")).toBe("/student/2");
  });

  test("student viewer gets no actor profile link", () => {
    renderWithProviders(<ActivityFeedList rows={[row({})]} isLoading={false} />);
    expect(screen.queryByRole("link", { name: /profile/i })).toBeNull();
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

    // The overlay link for the representative row is present.
    const overlayLink = screen.getByRole("link", { name: /Alex Rivera logged an attempt on Armbar/i });
    expect(overlayLink.getAttribute("href")).toBe("/student/4/syllabi/2?focus=sst:42");

    // The N-more toggle is a button, not a link.
    const toggleBtn = screen.getByRole("button", { name: /and \d+ more/i });
    expect(toggleBtn).toBeTruthy();
    expect(toggleBtn.getAttribute("aria-expanded")).toBe("false");
  });

  test("coalesced toggle expands and reveals the additional member rows", () => {
    const rows = [
      row({ id: 2, technique_name: "Armbar", sst_id: 42 }),
      row({ id: 1, technique_name: "Triangle", sst_id: 43 }),
    ];
    renderWithProviders(
      <ActivityFeedList rows={rows} isLoading={false} coalesce />,
    );

    // Before expansion, the toggle button is collapsed.
    const toggleBtn = screen.getByRole("button", { name: /and 1 more/i });
    expect(toggleBtn.getAttribute("aria-expanded")).toBe("false");

    // The actor name "Alex Rivera" should appear exactly once (the representative row only).
    expect(screen.getAllByText("Alex Rivera")).toHaveLength(1);

    // Click the toggle button.
    fireEvent.click(toggleBtn);

    // After expansion, the button label changes and aria-expanded flips.
    expect(screen.getByRole("button", { name: /Show less/i }).getAttribute("aria-expanded")).toBe("true");

    // The second member is rendered showing the SUBJECT only (e.g. "Triangle"),
    // not the full repeated verb phrase.
    expect(screen.getByText("Triangle")).toBeTruthy();
    // The verb phrase appears exactly once (on the representative row only, not repeated per member).
    const verbMatches = screen.queryAllByText(/logged an attempt on/);
    expect(verbMatches).toHaveLength(1);
    // The actor name still appears exactly once (compact members have no actor name).
    expect(screen.getAllByText("Alex Rivera")).toHaveLength(1);

    // Click again to collapse.
    fireEvent.click(screen.getByRole("button", { name: /Show less/i }));
    expect(screen.getByRole("button", { name: /and 1 more/i }).getAttribute("aria-expanded")).toBe("false");
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

  test("library-context video_watched row shows the global library chip", () => {
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
    expect(screen.getByText("Global Technique Library")).toBeTruthy();
  });

  // --- inlineAvatar: small avatar rendered inline by the actor name ---
  test("inlineAvatar with showAvatar=false renders a small inline avatar by the name", () => {
    renderWithProviders(
      <ActivityFeedList
        rows={[row({})]}
        isLoading={false}
        showAvatar={false}
        inlineAvatar
      />,
    );
    // The inline avatar wrapper should be present.
    expect(screen.getByTestId("inline-avatar")).toBeTruthy();
    // The actor name should still appear.
    expect(screen.getByText("Alex Rivera")).toBeTruthy();
  });

  test("without inlineAvatar, no inline avatar element is rendered", () => {
    renderWithProviders(
      <ActivityFeedList
        rows={[row({})]}
        isLoading={false}
        showAvatar={false}
      />,
    );
    expect(screen.queryByTestId("inline-avatar")).toBeNull();
  });
});
