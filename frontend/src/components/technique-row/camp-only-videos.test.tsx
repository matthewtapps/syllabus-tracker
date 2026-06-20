import { afterEach, describe, expect, test, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { VideosBlock } from "./videos-block";
import { TechniqueRowContext } from "./technique-row-context";
import type { RowContext, TechniqueRowState } from "./technique-row-context";
import { buildTechnique } from "@/test/fixtures";
import { buildUser, renderWithProviders } from "@/test/render";
import type { LibraryTechniqueRow, User, Video } from "@/lib/api";

function buildVideo(overrides: Partial<Video> = {}): Video {
  return {
    id: 1,
    parent_kind: "technique",
    technique_id: 42,
    student_id: null,
    thread_id: null,
    camp_id: null,
    title: "Reference clip",
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

// Stub window.fetch for the two video endpoints VideosBlock reads in a camp
// context: the global technique list and the camp-only technique list.
function stubVideos({
  global,
  campOnly,
}: {
  global: Video[];
  campOnly: Video[];
}) {
  const spy = vi.spyOn(window, "fetch").mockImplementation((input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    if (url.includes("/api/camps/7/techniques/42/videos")) {
      return Promise.resolve(
        new Response(JSON.stringify({ videos: campOnly }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    if (url.includes("/api/techniques/42/videos")) {
      return Promise.resolve(
        new Response(JSON.stringify({ videos: global }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  });
  return { spy };
}

function renderBlock({
  context,
  user,
}: {
  context: RowContext;
  user: User;
}) {
  const technique: LibraryTechniqueRow = buildTechnique({ id: 42 });
  const value: TechniqueRowState = {
    context,
    technique,
    role: user.role,
    viewerIsOwner: false,
  };
  return renderWithProviders(
    <TechniqueRowContext.Provider value={value}>
      <VideosBlock canManage={false} />
    </TechniqueRowContext.Provider>,
    { user },
  );
}

describe("VideosBlock camp-only section", () => {
  let stub: ReturnType<typeof stubVideos> | null = null;

  afterEach(() => {
    stub?.spy.mockRestore();
    stub = null;
  });

  test("renders a Camp only section with the camp-scoped clips", async () => {
    stub = stubVideos({
      global: [],
      campOnly: [buildVideo({ id: 9, title: "Camp drill clip" })],
    });
    renderBlock({
      context: { kind: "camp", campId: 7, studentId: 3 },
      user: buildUser({ id: 3, role: "student" }),
    });

    await waitFor(() =>
      expect(screen.getByText("Camp only")).toBeInTheDocument(),
    );
    expect(screen.getByText("Camp drill clip")).toBeInTheDocument();
  });

  test("renders no Camp only section when there are no camp-scoped clips", async () => {
    stub = stubVideos({ global: [buildVideo({ id: 1 })], campOnly: [] });
    renderBlock({
      context: { kind: "camp", campId: 7, studentId: 3 },
      user: buildUser({ id: 9, role: "coach" }),
    });

    // Wait for the camp-only fetch to resolve, then assert the section is absent.
    await waitFor(() => expect(window.fetch).toHaveBeenCalled());
    await Promise.resolve();
    expect(screen.queryByText("Camp only")).not.toBeInTheDocument();
  });

  test("does not render the Camp only section outside a camp context", async () => {
    stub = stubVideos({ global: [], campOnly: [buildVideo({ id: 9 })] });
    renderBlock({
      context: { kind: "global-library" },
      user: buildUser({ id: 9, role: "coach" }),
    });

    await waitFor(() => expect(window.fetch).toHaveBeenCalled());
    expect(screen.queryByText("Camp only")).not.toBeInTheDocument();
  });
});
