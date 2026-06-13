import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { clusterPins, ScrubberPins } from "./scrubber-pins";
import type { ThreadView } from "@/lib/api";

function t(id: number, secs: number): ThreadView {
  return {
    id, anchor_kind: "video_timestamp", author_id: 1, author_name: "x",
    visibility: "broadcast", scope_student_id: null, video_ts_seconds: secs,
    body: "b", created_at: "", deleted_at: null, comments: [],
  };
}

describe("clusterPins", () => {
  it("merges pins closer than the gap, keeps far ones separate", () => {
    const groups = clusterPins([t(1, 10), t(2, 11), t(3, 80)], 100, 0.05);
    expect(groups).toHaveLength(2);
    expect(groups[0].threads.map((x) => x.id)).toEqual([1, 2]);
    expect(groups[1].threads.map((x) => x.id)).toEqual([3]);
  });
  it("ignores threads without seconds or with zero duration", () => {
    expect(clusterPins([t(1, 10)], 0, 0.05)).toHaveLength(0);
  });
});

describe("ScrubberPins", () => {
  it("clicking a single pin invokes onPinClick with its thread", async () => {
    const onPinClick = vi.fn();
    render(
      <ScrubberPins threads={[t(1, 30)]} duration={100} activeThreadId={null} onPinClick={onPinClick} onClusterClick={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /moment at 0:30/i }));
    expect(onPinClick).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });
});
