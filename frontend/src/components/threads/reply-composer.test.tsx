import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReplyComposer } from "./reply-composer";
import { buildUser, renderWithProviders } from "@/test/render";
import type { VideoAttachment } from "./reply-composer";

function stubFetch(overrides: Record<string, unknown> = {}) {
  return vi.spyOn(window, "fetch").mockImplementation((input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    if (url.includes("/api/videos/browse")) {
      return Promise.resolve(
        new Response(
          JSON.stringify(
            overrides.browse ?? { kind: "parents", parents: [] },
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify(overrides.default ?? {}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
}

describe("ReplyComposer – source picker", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    fetchSpy = stubFetch();
  });
  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  test("all four sources render for a camp surface with scopeStudentId", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    renderWithProviders(
      <ReplyComposer
        anchorKind="camp"
        anchorId={1}
        pending={false}
        scopeStudentId={42}
        onSubmit={onSubmit}
      />,
      { user: buildUser({ id: 1, role: "student" }) },
    );

    await user.click(screen.getByRole("button", { name: /attach video/i }));

    expect(screen.getByText("Record now")).toBeInTheDocument();
    expect(screen.getByText("Choose from device")).toBeInTheDocument();
    expect(screen.getByText("Paste a link")).toBeInTheDocument();
    expect(screen.getByText("Choose from Sillybus")).toBeInTheDocument();
  });

  test("a coach can still browse with no student in context", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    renderWithProviders(
      <ReplyComposer
        anchorKind="camp"
        anchorId={1}
        pending={false}
        onSubmit={onSubmit}
      />,
      { user: buildUser({ id: 1, role: "coach" }) },
    );

    await user.click(screen.getByRole("button", { name: /attach video/i }));

    expect(screen.getByText("Record now")).toBeInTheDocument();
    expect(screen.getByText("Choose from Sillybus")).toBeInTheDocument();
  });

  test("a student gets no studentless browse", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    renderWithProviders(
      <ReplyComposer
        anchorKind="camp"
        anchorId={1}
        pending={false}
        onSubmit={onSubmit}
      />,
      { user: buildUser({ id: 1, role: "student" }) },
    );

    await user.click(screen.getByRole("button", { name: /attach video/i }));

    expect(screen.getByText("Record now")).toBeInTheDocument();
    expect(screen.queryByText("Choose from Sillybus")).toBeNull();
  });

  test("attach button is hidden for non-camp student surfaces", () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    renderWithProviders(
      <ReplyComposer
        anchorKind="technique"
        anchorId={1}
        pending={false}
        onSubmit={onSubmit}
      />,
      { user: buildUser({ id: 2, role: "student" }) },
    );

    expect(screen.queryByRole("button", { name: /attach video/i })).toBeNull();
  });
});

describe("ReplyComposer – Sillybus navigator picks a reference draft", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    fetchSpy = stubFetch({
      browse: {
        kind: "videos",
        videos: [{ id: 99, title: "Hip escape drill", provenance: "library" }],
      },
    });
  });
  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  test("picking a navigator video sets a reference draft and shows it", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    renderWithProviders(
      <ReplyComposer
        anchorKind="camp"
        anchorId={1}
        pending={false}
        scopeStudentId={42}
        onSubmit={onSubmit}
      />,
      { user: buildUser({ id: 1, role: "student" }) },
    );

    // Open source picker
    await user.click(screen.getByRole("button", { name: /attach video/i }));
    // Open Sillybus navigator
    await user.click(screen.getByText("Choose from Sillybus"));
    // The navigator fetches sources; navigate to search (which fetches videos)
    const searchInput = await screen.findByPlaceholderText(
      "Search videos…",
      undefined,
      { timeout: 3000 },
    );
    await user.type(searchInput, "hip");
    // Wait for debounce + fetch to resolve and video to appear
    const linkBtn = await screen.findByRole("button", { name: /hip escape drill/i });
    await user.click(linkBtn);

    // Draft preview should now show "Reference video attached"
    expect(screen.getByText("Reference video attached")).toBeInTheDocument();
  });
});

describe("ReplyComposer – thread-starter title requirement", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    fetchSpy = stubFetch({
      browse: {
        kind: "videos",
        // No title: the row's display falls back to the provenance string.
        // Use a provenance that can't collide with a source button label
        // ("Other camps" etc.) so the Link button query is unambiguous.
        videos: [{ id: 7, provenance: "Untitled match clip" }],
      },
    });
  });
  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  test("send is blocked until a title is entered when requireVideoTitle and video has no title", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    renderWithProviders(
      <ReplyComposer
        anchorKind="camp"
        anchorId={1}
        pending={false}
        requireVideoTitle
        scopeStudentId={42}
        onSubmit={onSubmit}
      />,
      { user: buildUser({ id: 1, role: "student" }) },
    );

    // Attach a reference video via the navigator
    await user.click(screen.getByRole("button", { name: /attach video/i }));
    await user.click(screen.getByText("Choose from Sillybus"));
    const searchInput = await screen.findByPlaceholderText(
      "Search videos…",
      undefined,
      { timeout: 3000 },
    );
    await user.type(searchInput, "something");
    // The video has no title; its row shows the provenance fallback.
    const linkBtn = await screen.findByRole("button", {
      name: /untitled match clip/i,
    });
    await user.click(linkBtn);

    // Draft appears; title input should be required
    expect(screen.getByLabelText("Video title")).toBeInTheDocument();

    // Send is disabled
    const sendBtn = screen.getByRole("button", { name: "Reply" });
    expect(sendBtn).toBeDisabled();

    // Fill in a title — send becomes available
    await user.type(screen.getByLabelText("Video title"), "My drill");
    expect(sendBtn).not.toBeDisabled();

    // Submitting passes the attachment with isReference=true and the title
    await user.type(screen.getByPlaceholderText("Reply…"), "Check this out");
    await user.click(sendBtn);

    expect(onSubmit).toHaveBeenCalledWith(
      "Check this out",
      expect.objectContaining<Partial<VideoAttachment>>({
        videoId: 7,
        isReference: true,
        title: "My drill",
      }),
      null,
    );
  });
});
