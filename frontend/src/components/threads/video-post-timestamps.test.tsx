/**
 * Tests for Phase 3B: timestamped replies on a video post.
 *
 * Covers:
 *   1. CommentItem renders a seek chip when video_ts_seconds is set and
 *      an onSeek handler is provided; omits it when absent.
 *   2. ReplyComposer shows a stamp control when stampable is provided, and
 *      the stamped time is passed as the third arg to onSubmit.
 *
 * Run in CI (Chromium via Vitest browser mode); window.fetch is stubbed.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommentItem } from "./comment-item";
import { ReplyComposer } from "./reply-composer";
import { buildUser, renderWithProviders } from "@/test/render";
import type { CommentView } from "@/lib/api";

function buildComment(overrides: Partial<CommentView> = {}): CommentView {
  return {
    id: 1,
    thread_id: 10,
    parent_comment_id: null,
    author_id: 2,
    author_name: "Bob B",
    body: "Nice move",
    video: null,
    video_ts_seconds: null,
    created_at: new Date().toISOString(),
    deleted_at: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// CommentItem – seek chip
// ---------------------------------------------------------------------------

describe("CommentItem – seek chip", () => {
  test("renders an interactive seek chip when video_ts_seconds is set and onSeek is provided", () => {
    const onSeek = vi.fn();
    const comment = buildComment({ video_ts_seconds: 65 }); // 1:05

    renderWithProviders(
      <CommentItem comment={comment} authorName="Bob B" onSeek={onSeek} />,
      { user: buildUser() },
    );

    // The chip should display "@1:05"
    const chip = screen.getByRole("button", { name: /seek to 1:05/i });
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveTextContent("@1:05");
  });

  test("calls onSeek with the comment's timestamp when chip is clicked", async () => {
    const user = userEvent.setup();
    const onSeek = vi.fn();
    const comment = buildComment({ video_ts_seconds: 65 });

    renderWithProviders(
      <CommentItem comment={comment} authorName="Bob B" onSeek={onSeek} />,
      { user: buildUser() },
    );

    await user.click(screen.getByRole("button", { name: /seek to/i }));
    expect(onSeek).toHaveBeenCalledWith(65);
  });

  test("renders a static label (not a button) when video_ts_seconds is set but onSeek is absent", () => {
    const comment = buildComment({ video_ts_seconds: 65 });

    renderWithProviders(
      <CommentItem comment={comment} authorName="Bob B" />,
      { user: buildUser() },
    );

    // A button should NOT exist
    expect(screen.queryByRole("button", { name: /seek to/i })).toBeNull();
    // But the timestamp text should still appear
    expect(screen.getByText("@1:05")).toBeInTheDocument();
  });

  test("renders no timestamp chip when video_ts_seconds is null", () => {
    const comment = buildComment({ video_ts_seconds: null });
    const onSeek = vi.fn();

    renderWithProviders(
      <CommentItem comment={comment} authorName="Bob B" onSeek={onSeek} />,
      { user: buildUser() },
    );

    expect(screen.queryByRole("button", { name: /seek to/i })).toBeNull();
    expect(screen.queryByText(/@\d/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ReplyComposer – stamp control
// ---------------------------------------------------------------------------

describe("ReplyComposer – stamp current time", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    fetchSpy = vi.spyOn(window, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  test("stamp button appears when stampable is provided and canStamp is true", () => {
    renderWithProviders(
      <ReplyComposer
        anchorKind="technique"
        anchorId={1}
        pending={false}
        stampable={{ currentTime: 42, canStamp: true }}
        onSubmit={vi.fn()}
      />,
      { user: buildUser({ role: "coach" }) },
    );

    expect(screen.getByRole("button", { name: /pin reply to current time/i })).toBeInTheDocument();
  });

  test("stamp button is disabled when canStamp is false", () => {
    renderWithProviders(
      <ReplyComposer
        anchorKind="technique"
        anchorId={1}
        pending={false}
        stampable={{ currentTime: 0, canStamp: false }}
        onSubmit={vi.fn()}
      />,
      { user: buildUser({ role: "coach" }) },
    );

    expect(screen.getByRole("button", { name: /pin reply to current time/i })).toBeDisabled();
  });

  test("clicking stamp captures the current time and shows 'Replying at'", async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <ReplyComposer
        anchorKind="technique"
        anchorId={1}
        pending={false}
        stampable={{ currentTime: 42, canStamp: true }}
        onSubmit={vi.fn()}
      />,
      { user: buildUser({ role: "coach" }) },
    );

    await user.click(screen.getByRole("button", { name: /pin reply to current time/i }));
    expect(screen.getByText(/replying at 0:42/i)).toBeInTheDocument();
  });

  test("clicking X clears the stamped time", async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <ReplyComposer
        anchorKind="technique"
        anchorId={1}
        pending={false}
        stampable={{ currentTime: 42, canStamp: true }}
        onSubmit={vi.fn()}
      />,
      { user: buildUser({ role: "coach" }) },
    );

    await user.click(screen.getByRole("button", { name: /pin reply to current time/i }));
    expect(screen.getByText(/replying at 0:42/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /clear timestamp/i }));
    expect(screen.queryByText(/replying at/i)).toBeNull();
  });

  test("onSubmit receives the stamped timestamp as the third arg", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    renderWithProviders(
      <ReplyComposer
        anchorKind="technique"
        anchorId={1}
        pending={false}
        stampable={{ currentTime: 42, canStamp: true }}
        onSubmit={onSubmit}
      />,
      { user: buildUser({ role: "coach" }) },
    );

    await user.click(screen.getByRole("button", { name: /pin reply to current time/i }));
    await user.type(screen.getByPlaceholderText("Reply…"), "great move");
    await user.click(screen.getByRole("button", { name: "Reply" }));

    expect(onSubmit).toHaveBeenCalledWith("great move", null, 42);
  });

  test("onSubmit receives null timestamp when no stamp was captured", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    renderWithProviders(
      <ReplyComposer
        anchorKind="technique"
        anchorId={1}
        pending={false}
        stampable={{ currentTime: 42, canStamp: true }}
        onSubmit={onSubmit}
      />,
      { user: buildUser({ role: "coach" }) },
    );

    await user.type(screen.getByPlaceholderText("Reply…"), "whole video comment");
    await user.click(screen.getByRole("button", { name: "Reply" }));

    expect(onSubmit).toHaveBeenCalledWith("whole video comment", null, null);
  });

  test("no stamp button when stampable is not provided", () => {
    renderWithProviders(
      <ReplyComposer
        anchorKind="technique"
        anchorId={1}
        pending={false}
        onSubmit={vi.fn()}
      />,
      { user: buildUser({ role: "coach" }) },
    );

    expect(screen.queryByRole("button", { name: /pin reply to current time/i })).toBeNull();
  });
});
