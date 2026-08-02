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
import type { BrowseSource } from "@/lib/api";

const CAMP_PARENT = { id: 7, name: "Camp A", video_count: 1 };

/** Answers the navigator's browse calls with one camp holding one clip. */
function stubBrowseFetch(source: BrowseSource) {
  const stub = vi.fn().mockImplementation((url: string) => {
    const params = new URLSearchParams(url.split("?")[1] ?? "");
    const body = params.get("parent_id")
      ? {
          kind: "videos",
          videos: [
            {
              id: 42,
              title: "Drill footage",
              provenance: `${source} - Camp A`,
              source,
            },
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

/** Drives the sheet from its first step to the confirm step with an existing
 *  clip picked, which is the only route a reference can be created by. */
async function pickExistingClip(onConfirm: (s: VideoSource, d: VideoDetails) => Promise<void>) {
  renderWithProviders(<Harness onConfirm={onConfirm} />, {
    user: buildUser({ id: 2, role: "coach" }),
  });

  fireEvent.click(screen.getByRole("button", { name: "Choose from Sillybus" }));

  const camps = await screen.findByRole("button", { name: /Camps/ });
  fireEvent.click(camps);

  const parent = await screen.findByRole("button", { name: /Camp A/ });
  fireEvent.click(parent);

  const clip = await screen.findByRole("button", { name: /Drill footage/ });
  fireEvent.click(clip);

  await waitFor(() => {
    expect(screen.getByLabelText("Title")).toBeTruthy();
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AddOrSelectVideoSheet, picking a clip that already exists", () => {
  test("lands on the confirm step", async () => {
    stubBrowseFetch("camp");
    await pickExistingClip(async () => {});

    expect(screen.getByLabelText("Title")).toBeTruthy();
  });

  test("warns before publishing a clip that lives on one student's camp", async () => {
    stubBrowseFetch("camp");
    await pickExistingClip(async () => {});

    expect(screen.getByText(/shows it to every student/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publish to all students" })).toBeTruthy();
  });

  test("says nothing about publishing a clip already in the library", async () => {
    stubBrowseFetch("library");
    await pickExistingClip(async () => {});

    expect(screen.queryByText(/shows it to every student/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Add video" })).toBeTruthy();
  });

  test("turning the scope switch off keeps the clip on this student only", async () => {
    stubBrowseFetch("camp");
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    await pickExistingClip(onConfirm);

    fireEvent.click(screen.getByLabelText("Also add to global technique library"));

    await waitFor(() => {
      expect(screen.queryByText(/shows it to every student/i)).toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Add video" }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "existing" }),
        expect.objectContaining({ alsoGlobal: false }),
      );
    });
  });
});
