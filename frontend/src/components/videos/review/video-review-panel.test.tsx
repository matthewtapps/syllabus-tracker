import { afterEach, describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { renderWithProviders, buildUser } from "@/test/render";
import { VideoReviewPanel } from "./video-review-panel";
import { useSeekOnce } from "./use-seek-once";
import {
  PlayerControllerProvider,
  usePlayerController,
  type PlayerRegistration,
} from "../player-context";
import type { CommentView, ThreadView, Video } from "@/lib/api";

function buildVideo(over: Partial<Video> = {}): Video {
  return {
    id: 7,
    parent_kind: "technique",
    technique_id: 1,
    student_id: null,
    thread_id: null,
    camp_id: null,
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

function buildComment(over: Partial<CommentView> = {}): CommentView {
  return {
    id: 900,
    thread_id: 1,
    parent_comment_id: null,
    author_id: 3,
    author_name: "Sam Khan",
    body: "felt way better this round",
    video: null,
    video_ts_seconds: null,
    created_at: "2026-07-10T00:00:00Z",
    deleted_at: null,
    ...over,
  };
}

function buildThread(over: Partial<ThreadView> = {}): ThreadView {
  return {
    id: 1,
    anchor_kind: "video_timestamp",
    author_id: 2,
    author_name: "Coach Lee",
    visibility: "broadcast",
    scope_student_id: null,
    video_ts_seconds: 84,
    body: "keep the elbow tight",
    video: null,
    created_at: "2026-07-10T00:00:00Z",
    deleted_at: null,
    comments: [],
    ...over,
  };
}

/** Stubs the threads query for the video; everything else answers empty. */
function stubThreads(threads: ThreadView[]) {
  return vi.spyOn(window, "fetch").mockImplementation((input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const payload = url.includes("/api/threads") ? { threads } : [];
    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
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

describe("VideoReviewPanel feed mode", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;
  afterEach(() => fetchSpy?.mockRestore());

  it("previews the focus thread first, then the newest other one, with a view-all line", async () => {
    fetchSpy = stubThreads([
      buildThread({ id: 1, body: "keep the elbow tight", created_at: "2026-07-01T00:00:00Z" }),
      buildThread({
        id: 2,
        author_name: "Sam Khan",
        body: "felt way better this round",
        created_at: "2026-07-20T00:00:00Z",
        comments: [buildComment({ thread_id: 2 })],
      }),
      buildThread({ id: 3, body: "third one", created_at: "2026-07-05T00:00:00Z" }),
    ]);

    renderWithProviders(
      <VideoReviewPanel
        video={buildVideo()}
        surface={{ kind: "library" }}
        feedPresentation={{ focusThreadId: 1, href: "/library?focus=technique:1" }}
      />,
      { user: buildUser({ role: "coach" }) },
    );

    await waitFor(() => {
      expect(screen.getByText("keep the elbow tight")).toBeInTheDocument();
    });
    expect(screen.getByText("felt way better this round")).toBeInTheDocument();
    // The third thread is over budget; it lives on the video's own surface.
    expect(screen.queryByText("third one")).toBeNull();
    // Roots plus replies across every thread on the video: 3 + 1.
    expect(screen.getByText("View all 4 comments")).toBeInTheDocument();
  });

  it("still renders a tap target when the video has no threads", async () => {
    fetchSpy = stubThreads([]);

    renderWithProviders(
      <VideoReviewPanel
        video={buildVideo()}
        surface={{ kind: "library" }}
        feedPresentation={{ focusThreadId: null, href: "/library?focus=technique:1" }}
      />,
      { user: buildUser({ role: "coach" }) },
    );

    await waitFor(() => {
      expect(screen.getByText("No comments yet")).toBeInTheDocument();
    });
    expect(screen.queryByText(/View all/)).toBeNull();
  });

  it("links the teaser region to the video in its surface, not the player", async () => {
    fetchSpy = stubThreads([buildThread()]);

    renderWithProviders(
      <VideoReviewPanel
        video={buildVideo({ title: "Armbar drill, round 2" })}
        surface={{ kind: "library" }}
        feedPresentation={{ focusThreadId: 1, href: "/library?focus=technique:1" }}
      />,
      { user: buildUser({ role: "coach" }) },
    );

    await waitFor(() => {
      expect(screen.getByText("keep the elbow tight")).toBeInTheDocument();
    });

    // No overlay: the teaser itself is a link to the real surface. (The
    // external-link player card renders its own link, so scope to the teaser.)
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("keep the elbow tight").closest("a")).toHaveAttribute(
      "href",
      "/library?focus=technique:1",
    );
  });

  it("drops the old collapsed-discussion toggle", async () => {
    fetchSpy = stubThreads([buildThread()]);

    renderWithProviders(
      <VideoReviewPanel
        video={buildVideo()}
        surface={{ kind: "library" }}
        feedPresentation={{ focusThreadId: 1, href: "/library?focus=technique:1" }}
      />,
      { user: buildUser({ role: "coach" }) },
    );

    await waitFor(() => {
      expect(screen.getByText("keep the elbow tight")).toBeInTheDocument();
    });
    expect(screen.queryByText(/show discussion/i)).toBeNull();
    expect(screen.queryByText(/hide discussion/i)).toBeNull();
    expect(screen.queryByText(/more comments?$/i)).toBeNull();
  });
});

describe("useSeekOnce", () => {
  function SeekProbe({ startAt }: { startAt: number | null }) {
    useSeekOnce(usePlayerController(), startAt);
    return null;
  }

  it("resumes exactly once, when the player reports it can seek", () => {
    let reg: PlayerRegistration | null = null;
    const seek = vi.fn();

    render(
      <PlayerControllerProvider onReady={(r) => { reg = r; }}>
        <SeekProbe startAt={42} />
      </PlayerControllerProvider>,
    );

    // No seek handle yet (an embed never registers one): nothing happens.
    expect(seek).not.toHaveBeenCalled();

    act(() => reg!.registerSeek(seek));
    expect(seek).toHaveBeenCalledWith(42);

    // Later playback progress must not drag the viewer back to the entry point.
    act(() => reg!.reportProgress(60, 120));
    expect(seek).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a resume position", () => {
    let reg: PlayerRegistration | null = null;
    const seek = vi.fn();

    render(
      <PlayerControllerProvider onReady={(r) => { reg = r; }}>
        <SeekProbe startAt={null} />
      </PlayerControllerProvider>,
    );

    act(() => reg!.registerSeek(seek));
    expect(seek).not.toHaveBeenCalled();
  });
});
