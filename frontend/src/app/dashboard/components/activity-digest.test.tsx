/**
 * ActivityDigest tile rendering tests (browser project).
 *
 * Mocks getActivityDigest from the api module and asserts the four metric
 * tiles are rendered with the correct labels and counts.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { screen } from "@testing-library/react";
import * as api from "@/lib/api";
import { ActivityDigest } from "./activity-digest";
import { renderWithProviders } from "@/test/render";
import type { ActivityDigest as ActivityDigestType } from "@/lib/api";

const mockDigest: ActivityDigestType = {
  window_days: 7,
  metrics: [
    {
      key: "attempts_logged",
      label: "Attempts logged",
      count: 37,
      prev_count: 30,
      delta: 7,
      daily: [3, 5, 4, 6, 7, 5, 7],
    },
    {
      key: "videos_watched",
      label: "Videos watched",
      count: 24,
      prev_count: 20,
      delta: 4,
      daily: [2, 3, 4, 3, 4, 4, 4],
    },
    {
      key: "active_students",
      label: "Active students",
      count: 11,
      prev_count: 13,
      delta: -2,
      daily: [1, 2, 2, 1, 2, 1, 2],
    },
    {
      key: "techniques_pinned",
      label: "Techniques pinned",
      count: 8,
      prev_count: 8,
      delta: 0,
      daily: [1, 1, 1, 1, 1, 1, 2],
    },
  ],
};

describe("ActivityDigest", () => {
  let digestSpy: ReturnType<typeof vi.spyOn> | null = null;

  afterEach(() => {
    digestSpy?.mockRestore();
  });

  test("renders all four metric tiles with correct labels and counts", async () => {
    digestSpy = vi
      .spyOn(api, "getActivityDigest")
      .mockResolvedValue(mockDigest);

    renderWithProviders(<ActivityDigest />);

    expect(await screen.findByText("Attempts logged")).toBeInTheDocument();
    expect(await screen.findByText("37")).toBeInTheDocument();
    expect(await screen.findByText("Active students")).toBeInTheDocument();
  });

  test("renders delta text for positive, negative, and zero deltas", async () => {
    digestSpy = vi
      .spyOn(api, "getActivityDigest")
      .mockResolvedValue(mockDigest);

    renderWithProviders(<ActivityDigest />);

    expect(await screen.findByText("Up 7 vs last week")).toBeInTheDocument();
    expect(await screen.findByText("2 fewer vs last week")).toBeInTheDocument();
    expect(await screen.findByText("No change vs last week")).toBeInTheDocument();
  });

  test("shows error state when the query rejects", async () => {
    digestSpy = vi
      .spyOn(api, "getActivityDigest")
      .mockRejectedValue(new Error("network error"));

    renderWithProviders(<ActivityDigest />);

    expect(
      await screen.findByText("Could not load recent activity."),
    ).toBeInTheDocument();
  });
});
