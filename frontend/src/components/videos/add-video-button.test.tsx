/**
 * AddVideoButton tests (browser project, runs in Chromium on CI).
 *
 * Stubs window.fetch (not vi.spyOn on the ESM api module) per the project
 * pattern for browser tests. Uses renderWithProviders + buildUser.
 */
import { describe, expect, test, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders, buildUser } from "@/test/render";
import { AddVideoButton } from "./add-video-button";

/** Answers the navigator's browse calls with one camp clip, and records the
 *  reference POST the button makes. */
function stubFetch() {
  const stub = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ reference_id: 9 }) });
    }
    const params = new URLSearchParams(url.split("?")[1] ?? "");
    const body = params.get("parent_id")
      ? {
          kind: "videos",
          videos: [
            { id: 42, title: "Drill footage", provenance: "camp - Camp A", source: "camp" },
          ],
        }
      : { kind: "parents", parents: [{ id: 7, name: "Camp A", video_count: 1 }] };
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  });
  vi.stubGlobal("fetch", stub);
  return stub;
}

/** Opens the sheet and picks the one existing clip the stub offers. */
async function pickExistingClip() {
  fireEvent.click(screen.getByRole("button", { name: /Add video/ }));
  fireEvent.click(screen.getByRole("button", { name: "Choose from Sillybus" }));
  fireEvent.click(await screen.findByRole("button", { name: /Camps/ }));
  fireEvent.click(await screen.findByRole("button", { name: /Camp A/ }));
  fireEvent.click(await screen.findByRole("button", { name: /Drill footage/ }));
  await waitFor(() => {
    expect(screen.getByLabelText("Title")).toBeTruthy();
  });
}

/** The body of the reference POST the stub recorded. */
function referencePost(stub: ReturnType<typeof stubFetch>) {
  const call = stub.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
  expect(call).toBeTruthy();
  return {
    url: call![0] as string,
    body: JSON.parse((call![1] as RequestInit).body as string) as Record<string, unknown>,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AddVideoButton, referencing a clip onto a student's syllabus", () => {
  test("scopes the reference to the student when the scope switch is off", async () => {
    const stub = stubFetch();
    renderWithProviders(
      <AddVideoButton
        techniqueId={1}
        studentSyllabus={{ studentId: 3, syllabusId: 4, sstId: 55 }}
        onAdded={() => {}}
      />,
      { user: buildUser({ id: 2, role: "coach" }) },
    );

    await pickExistingClip();
    fireEvent.click(screen.getByLabelText("Also add to global technique library"));
    fireEvent.click(screen.getByRole("button", { name: "Add video" }));

    await waitFor(() => {
      const { url, body } = referencePost(stub);
      expect(url).toContain("/api/techniques/1/videos/references");
      expect(body.video_id).toBe(42);
      expect(body.parent_kind).toBe("student_syllabus_technique");
      expect(body.parent_id).toBe(55);
    });
  });

  test("leaves the reference on the technique when the switch stays on", async () => {
    const stub = stubFetch();
    renderWithProviders(
      <AddVideoButton
        techniqueId={1}
        studentSyllabus={{ studentId: 3, syllabusId: 4, sstId: 55 }}
        onAdded={() => {}}
      />,
      { user: buildUser({ id: 2, role: "coach" }) },
    );

    await pickExistingClip();
    fireEvent.click(screen.getByRole("button", { name: "Publish to all students" }));

    await waitFor(() => {
      const { body } = referencePost(stub);
      expect(body.parent_kind).toBeUndefined();
    });
  });
});
