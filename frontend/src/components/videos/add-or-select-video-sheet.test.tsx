/**
 * AddOrSelectVideoSheet tests (browser project, runs in Chromium on CI).
 *
 * Stubs window.fetch (not vi.spyOn on the ESM api module) per the project
 * pattern for browser tests. Uses renderWithProviders + buildUser.
 */
import { useState } from "react";
import { describe, expect, test, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders, buildUser } from "@/test/render";
import { AddOrSelectVideoSheet, type VideoSource, type VideoDetails } from "./add-or-select-video-sheet";

const CAMP_PARENT = { id: 7, name: "Camp A", video_count: 1 };

/** Answers the navigator's browse calls with one camp holding one clip. */
function stubBrowseFetch() {
  const stub = vi.fn().mockImplementation((url: string) => {
    const params = new URLSearchParams(url.split("?")[1] ?? "");
    const body = params.get("parent_id")
      ? {
          kind: "videos",
          videos: [
            { id: 42, title: "Drill footage", provenance: "camp - Camp A", source: "camp" },
          ],
        }
      : { kind: "parents", parents: [CAMP_PARENT] };
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  });
  vi.stubGlobal("fetch", stub);
  return stub;
}

/** Owns `open` the way every real caller does, so a stray close closes the
 *  flow here too rather than being swallowed by a no-op handler. */
function Harness({ onConfirm }: { onConfirm: (s: VideoSource, d: VideoDetails) => Promise<void> }) {
  const [open, setOpen] = useState(true);
  return (
    <AddOrSelectVideoSheet
      open={open}
      onOpenChange={setOpen}
      browseStudentId={3}
      titleMode="required"
      showScopeSwitch
      onConfirm={onConfirm}
    />
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AddOrSelectVideoSheet", () => {
  test("picking a clip that already exists lands on the confirm step", async () => {
    stubBrowseFetch();
    renderWithProviders(<Harness onConfirm={async () => {}} />, {
      user: buildUser({ id: 2, role: "coach" }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Choose from Sillybus" }));
    fireEvent.click(await screen.findByRole("button", { name: /Camps/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Camp A/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Drill footage/ }));

    await waitFor(() => {
      expect(screen.getByLabelText("Title")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "Add video" })).toBeTruthy();
  });
});
