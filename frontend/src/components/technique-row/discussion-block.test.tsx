import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { DiscussionBlock } from "./discussion-block";
import { TechniqueRowContext } from "./technique-row-context";
import type { RowContext, TechniqueRowState } from "./technique-row-context";
import { buildTechnique } from "@/test/fixtures";
import { buildUser, renderWithProviders } from "@/test/render";
import type { LibraryTechniqueRow, User } from "@/lib/api";

// Capture every threads URL the block fetches so we can assert which anchor a
// given surface uses.
function stubThreads() {
  const urls: string[] = [];
  const spy = vi.spyOn(window, "fetch").mockImplementation((input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    if (url.includes("/api/threads")) urls.push(url);
    return Promise.resolve(
      new Response(JSON.stringify({ threads: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  return { urls, spy };
}

function renderBlock({
  technique,
  context,
  user,
}: {
  technique: LibraryTechniqueRow;
  context: RowContext;
  user: User;
}) {
  const value: TechniqueRowState = {
    context,
    technique,
    role: user.role,
    viewerIsOwner: false,
  };
  return renderWithProviders(
    <TechniqueRowContext.Provider value={value}>
      <DiscussionBlock />
    </TechniqueRowContext.Provider>,
    { user },
  );
}

describe("DiscussionBlock anchor selection", () => {
  let stub: ReturnType<typeof stubThreads> | null = null;

  beforeEach(() => {
    stub = stubThreads();
  });

  afterEach(() => {
    stub?.spy.mockRestore();
  });

  test("camp context fetches the camp_technique anchor scoped to the camp", async () => {
    const technique = buildTechnique({ id: 42 });
    renderBlock({
      technique,
      context: { kind: "camp", campId: 7, studentId: 3 },
      user: buildUser({ id: 9, role: "coach" }),
    });

    await waitFor(() =>
      expect(
        stub!.urls.some((u) =>
          u.includes("anchor_kind=camp_technique") &&
          u.includes("anchor_id=42") &&
          u.includes("camp_id=7"),
        ),
      ).toBe(true),
    );

    // The camp surface must never read the global-library technique conversation.
    expect(stub!.urls.some((u) => u.includes("anchor_kind=technique"))).toBe(false);
  });

  test("global-library context fetches the plain technique anchor (no camp_id)", async () => {
    const technique = buildTechnique({ id: 42 });
    renderBlock({
      technique,
      context: { kind: "global-library" },
      user: buildUser({ id: 9, role: "coach" }),
    });

    await waitFor(() =>
      expect(
        stub!.urls.some(
          (u) => u.includes("anchor_kind=technique") && u.includes("anchor_id=42"),
        ),
      ).toBe(true),
    );

    expect(stub!.urls.some((u) => u.includes("camp_technique"))).toBe(false);
    expect(stub!.urls.some((u) => u.includes("camp_id="))).toBe(false);
  });
});
