import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { activeMoment, MomentOverlay } from "./moment-overlay";
import type { ThreadView } from "@/lib/api";

function t(id: number, secs: number, body: string): ThreadView {
  return {
    id, anchor_kind: "video_timestamp", author_id: 1, author_name: "Sam R.",
    visibility: "broadcast", scope_student_id: null, video_ts_seconds: secs,
    body, created_at: "", deleted_at: null, comments: [],
  };
}

describe("activeMoment", () => {
  const threads = [t(1, 42, "low hand"), t(2, 120, "good finish")];
  it("returns the moment whose window contains the current time", () => {
    expect(activeMoment(threads, 44)?.id).toBe(1);
  });
  it("returns null outside every window", () => {
    expect(activeMoment(threads, 80)).toBeNull();
  });
  it("picks the nearest when two windows overlap", () => {
    const overlap = [t(1, 42, "a"), t(2, 45, "b")];
    expect(activeMoment(overlap, 44)?.id).toBe(2);
  });
});

describe("MomentOverlay", () => {
  it("renders the active moment and opens it on tap", async () => {
    const onOpen = vi.fn();
    render(<MomentOverlay threads={[t(1, 42, "low hand")]} currentTime={43} pinnedThread={null} onOpen={onOpen} />);
    expect(screen.getByText("low hand")).toBeTruthy();
    await userEvent.click(screen.getByText("low hand"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });
  it("renders nothing when no moment is active and none pinned", () => {
    const { container } = render(<MomentOverlay threads={[t(1, 42, "x")]} currentTime={80} pinnedThread={null} onOpen={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
