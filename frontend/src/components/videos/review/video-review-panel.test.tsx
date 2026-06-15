import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders, buildUser } from "@/test/render";
import { VideoReviewPanel } from "./video-review-panel";
import type { Video } from "@/lib/api";

function buildVideo(over: Partial<Video> = {}): Video {
  return {
    id: 7,
    parent_kind: "technique",
    technique_id: 1,
    student_id: null,
    thread_id: null,
    title: "Test clip",
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
    uploaded_by_id: 5,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    hidden_at: null,
    ...over,
  };
}

describe("VideoReviewPanel (CX-010 composer gate)", () => {
  beforeEach(() => {
    // The threads query fetches the feed; return an empty list so render is stable.
    vi.spyOn(window, "fetch").mockResolvedValue(
      new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }),
    );
  });

  it("renders the create-comment composer for a technique-parented video", () => {
    renderWithProviders(
      <VideoReviewPanel video={buildVideo({ parent_kind: "technique" })} surface={{ kind: "library" }} />,
      { user: buildUser({ role: "coach" }) },
    );
    expect(screen.getByRole("button", { name: /comment on video/i })).toBeTruthy();
  });

  it("hides the create-comment composer for a thread-reply video", () => {
    renderWithProviders(
      <VideoReviewPanel
        video={buildVideo({ parent_kind: "thread", technique_id: null, thread_id: 99 })}
        surface={{ kind: "library" }}
      />,
      { user: buildUser({ role: "coach" }) },
    );
    expect(screen.queryByRole("button", { name: /comment on video/i })).toBeNull();
  });
});
