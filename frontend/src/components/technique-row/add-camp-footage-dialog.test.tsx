import { afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { AddCampFootageDialog } from "./add-camp-footage-dialog";
import { buildUser, renderWithProviders } from "@/test/render";
import type { Video } from "@/lib/api";

function buildVideo(overrides: Partial<Video> = {}): Video {
  return {
    id: 1,
    parent_kind: "camp",
    technique_id: null,
    student_id: null,
    thread_id: null,
    camp_id: 7,
    title: "Round 1 footage",
    position: 0,
    kind: "native",
    processing_status: "ready",
    uploaded_by_id: 2,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    hidden_at: null,
    ...overrides,
  };
}

// Stub window.fetch: GET camp videos returns the given list; POST attach
// records the request and returns 204.
function stubApi(videos: Video[]) {
  const posts: { url: string; body: unknown }[] = [];
  const spy = vi.spyOn(window, "fetch").mockImplementation((input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    if (url.endsWith("/api/camps/7/videos")) {
      return Promise.resolve(
        new Response(JSON.stringify({ videos }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    if (url.includes("/techniques/42/videos")) {
      posts.push({ url, body: JSON.parse(String(init?.body ?? "null")) });
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  });
  return { posts, spy };
}

describe("AddCampFootageDialog", () => {
  let stub: ReturnType<typeof stubApi> | null = null;

  afterEach(() => {
    stub?.spy.mockRestore();
  });

  function renderDialog(videos: Video[]) {
    stub = stubApi(videos);
    const onOpenChange = vi.fn();
    renderWithProviders(
      <AddCampFootageDialog
        open
        onOpenChange={onOpenChange}
        campId={7}
        techniqueId={42}
        techniqueName="Armbar"
      />,
      { user: buildUser({ role: "coach" }) },
    );
    return { onOpenChange };
  }

  test("shows an empty-state hint when the camp has no footage", async () => {
    renderDialog([]);
    await waitFor(() =>
      expect(screen.getByText(/upload footage to this camp first/i)).toBeInTheDocument(),
    );
  });

  test("attaches the selected footage with the chosen scope and closes", async () => {
    const { onOpenChange } = renderDialog([buildVideo({ id: 9 })]);

    const row = await screen.findByText("Round 1 footage");
    fireEvent.click(row);

    fireEvent.click(screen.getByText("Global"));
    fireEvent.click(screen.getByRole("button", { name: /add footage/i }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(stub?.posts).toHaveLength(1);
    expect(stub?.posts[0].body).toEqual({ video_id: 9, scope: "global" });
  });
});
