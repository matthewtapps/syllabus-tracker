import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, buildUser } from "@/test/render";
import { MomentFeed } from "./moment-feed";
import type { ThreadView } from "@/lib/api";

function thread(over: Partial<ThreadView>): ThreadView {
  return {
    id: 1,
    anchor_kind: "video_timestamp",
    author_id: 5,
    author_name: "Sam R.",
    visibility: "private",
    scope_student_id: 5,
    video_ts_seconds: 42,
    body: "hand too low",
    created_at: new Date().toISOString(),
    deleted_at: null,
    comments: [],
    ...over,
  };
}

describe("MomentFeed", () => {
  it("renders a timestamp chip for timestamped threads", () => {
    renderWithProviders(
      <MomentFeed videoId={7} threads={[thread({})]} onSeek={vi.fn()} highlightThreadId={null} />,
      { user: buildUser({ role: "coach" }) },
    );
    expect(screen.getByRole("button", { name: /0:42/ })).toBeTruthy();
  });

  it("renders a whole-video tag for null-seconds threads", () => {
    renderWithProviders(
      <MomentFeed videoId={7} threads={[thread({ id: 2, anchor_kind: "video", video_ts_seconds: null })]} onSeek={vi.fn()} highlightThreadId={null} />,
      { user: buildUser({ role: "coach" }) },
    );
    expect(screen.getByText(/whole video/i)).toBeTruthy();
  });

  it("clicking the chip seeks to the thread's seconds", async () => {
    const onSeek = vi.fn();
    renderWithProviders(
      <MomentFeed videoId={7} threads={[thread({})]} onSeek={onSeek} highlightThreadId={null} />,
      { user: buildUser({ role: "coach" }) },
    );
    await userEvent.click(screen.getByRole("button", { name: /0:42/ }));
    expect(onSeek).toHaveBeenCalledWith(42);
  });
});
