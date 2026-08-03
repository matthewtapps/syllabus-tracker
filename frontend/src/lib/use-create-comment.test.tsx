/**
 * useCreateComment optimistic-write tests (browser project).
 *
 * A thread lives in two cache shapes: the anchor's list, and the single thread a
 * by-id surface reads (a camp's thread page). The optimistic insert for a video
 * reply has to land in BOTH, or the same reply appears instantly on one surface
 * and only after a refetch on the other.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCreateComment } from "./mutations";
import { qk } from "./query-keys";
import type { ThreadView } from "./api";

const THREAD_ID = 99;
const CAMP_ID = 3;

function baseThread(): ThreadView {
  return {
    id: THREAD_ID,
    anchor_kind: "camp",
    author_id: 2,
    author_name: "Coach Lee",
    visibility: "private",
    scope_student_id: 4,
    video_ts_seconds: null,
    body: "Keep the elbow tight.",
    video: null,
    created_at: new Date().toISOString(),
    deleted_at: null,
    comments: [],
  };
}

function setup() {
  const client = new QueryClient({
    defaultOptions: {
      // gcTime must not be 0: nothing observes these seeded entries, so a zero
      // gc window collects them before the mutation can touch them.
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  const listKey = qk.threads("camp", CAMP_ID);
  const byIdKey = qk.thread(THREAD_ID);
  client.setQueryData<ThreadView[]>(listKey, [baseThread()]);
  client.setQueryData<ThreadView>(byIdKey, baseThread());

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useCreateComment("camp", CAMP_ID), { wrapper });
  return { client, listKey, byIdKey, result };
}

const videoReply = {
  threadId: THREAD_ID,
  body: "",
  videoId: 55,
  authorId: 2,
  authorName: "Coach Lee",
};

describe("useCreateComment optimistic write", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;
  afterEach(() => fetchSpy?.mockRestore());

  test("lands the pending video reply in both the anchor list and the by-id thread", async () => {
    // The request never settles, so what the test observes is purely the
    // optimistic state rather than a refetch.
    fetchSpy = vi.spyOn(window, "fetch").mockImplementation(() => new Promise(() => {}));

    const { client, listKey, byIdKey, result } = setup();
    result.current.mutate(videoReply);

    await waitFor(() => {
      expect(client.getQueryData<ThreadView>(byIdKey)?.comments).toHaveLength(1);
    });

    const fromList = client.getQueryData<ThreadView[]>(listKey)?.[0].comments ?? [];
    const fromById = client.getQueryData<ThreadView>(byIdKey)?.comments ?? [];
    expect(fromList).toHaveLength(1);
    expect(fromList[0].video?.processing_status).toBe("processing");
    expect(fromById[0].video?.processing_status).toBe("processing");
    expect(fromById[0].id).toBe(fromList[0].id);
  });

  test("rolls both back when the post fails", async () => {
    fetchSpy = vi.spyOn(window, "fetch").mockImplementation(() =>
      Promise.resolve(new Response("nope", { status: 500 })),
    );

    const { client, listKey, byIdKey, result } = setup();
    result.current.mutate(videoReply);

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // A failed upload must not leave a phantom reply on either surface.
    expect(client.getQueryData<ThreadView[]>(listKey)?.[0].comments).toHaveLength(0);
    expect(client.getQueryData<ThreadView>(byIdKey)?.comments).toHaveLength(0);
  });
});
