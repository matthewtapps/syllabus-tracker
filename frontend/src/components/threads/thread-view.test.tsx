import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { screen } from "@testing-library/react";
import { ThreadView } from "./thread-view";
import { buildUser, renderWithProviders } from "@/test/render";
import type { ThreadView as ThreadViewModel, CommentView } from "@/lib/api";

function buildComment(overrides: Partial<CommentView> = {}): CommentView {
  return {
    id: 1,
    thread_id: 10,
    parent_comment_id: null,
    author_id: 2,
    author_name: "Bob B",
    body: "Great technique!",
    created_at: new Date().toISOString(),
    deleted_at: null,
    ...overrides,
  };
}

function buildThread(overrides: Partial<ThreadViewModel> = {}): ThreadViewModel {
  return {
    id: 10,
    anchor_kind: "technique",
    author_id: 1,
    author_name: "Alice A",
    visibility: "broadcast",
    scope_student_id: null,
    body: "Root thread body",
    created_at: new Date().toISOString(),
    deleted_at: null,
    comments: [],
    ...overrides,
  };
}

describe("ThreadView", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;

  const users = [
    { id: 1, username: "alice", display_name: "Alice A", role: "coach", archived: false },
    { id: 2, username: "bob", display_name: "Bob B", role: "student", archived: false },
  ];

  beforeEach(() => {
    // Stub all fetches: return user list for /api/admin/users, empty for threads
    fetchSpy = vi.spyOn(window, "fetch").mockImplementation((input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
      if (url.includes("/api/admin/users")) {
        return Promise.resolve(
          new Response(JSON.stringify(users), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  test("renders a thread's root body and one reply's body", async () => {
    const comment = buildComment({ id: 1, author_id: 2, body: "Great technique!" });
    const thread = buildThread({ author_id: 1, body: "Root thread body", comments: [comment] });

    renderWithProviders(
      <ThreadView thread={thread} anchorKind="technique" anchorId={99} />,
      { user: buildUser({ id: 1, role: "coach" }) },
    );

    // Root body is visible immediately (static render, no async needed)
    expect(screen.getByText("Root thread body")).toBeInTheDocument();
    // Reply body
    expect(screen.getByText("Great technique!")).toBeInTheDocument();
    // Author names come from the payload, not a client-side user lookup
    expect(screen.getByText("Alice A")).toBeInTheDocument();
    expect(screen.getByText("Bob B")).toBeInTheDocument();
  });

  test("renders tombstone text when thread body is null", async () => {
    const thread = buildThread({ body: null });

    renderWithProviders(
      <ThreadView thread={thread} anchorKind="technique" anchorId={99} />,
      { user: buildUser({ id: 1, role: "coach" }) },
    );

    expect(screen.getByText("thread removed")).toBeInTheDocument();
  });

  test("renders tombstone text when comment body is null", async () => {
    const comment = buildComment({ body: null });
    const thread = buildThread({ comments: [comment] });

    renderWithProviders(
      <ThreadView thread={thread} anchorKind="technique" anchorId={99} />,
      { user: buildUser({ id: 1, role: "coach" }) },
    );

    expect(screen.getByText("comment removed")).toBeInTheDocument();
  });

  test("shows delete button for the thread author", () => {
    const thread = buildThread({ author_id: 1 });

    renderWithProviders(
      <ThreadView thread={thread} anchorKind="technique" anchorId={99} />,
      { user: buildUser({ id: 1, role: "student" }) },
    );

    expect(
      screen.getByRole("button", { name: /delete thread/i }),
    ).toBeInTheDocument();
  });

  test("shows delete button for non-student viewers (coach/admin)", () => {
    const thread = buildThread({ author_id: 2 });

    renderWithProviders(
      <ThreadView thread={thread} anchorKind="technique" anchorId={99} />,
      { user: buildUser({ id: 1, role: "coach" }) },
    );

    expect(
      screen.getByRole("button", { name: /delete thread/i }),
    ).toBeInTheDocument();
  });

  test("hides delete button when student is not the thread author", () => {
    const thread = buildThread({ author_id: 2 });

    renderWithProviders(
      <ThreadView thread={thread} anchorKind="technique" anchorId={99} />,
      { user: buildUser({ id: 1, role: "student" }) },
    );

    expect(
      screen.queryByRole("button", { name: /delete thread/i }),
    ).toBeNull();
  });

  test("reply composer is rendered", () => {
    const thread = buildThread();

    renderWithProviders(
      <ThreadView thread={thread} anchorKind="technique" anchorId={99} />,
      { user: buildUser({ id: 1, role: "student" }) },
    );

    expect(
      screen.getByPlaceholderText("Write a reply…"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /reply/i }),
    ).toBeInTheDocument();
  });
});
