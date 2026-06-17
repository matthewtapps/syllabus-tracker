import { afterEach, describe, expect, test } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePointerEventsWatchdog } from "./use-pointer-events-watchdog";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  document.body.style.pointerEvents = "";
  document.body.innerHTML = "";
});

describe("usePointerEventsWatchdog", () => {
  test("clears a stuck pointer-events lock on Back when no overlay is open", async () => {
    renderHook(() => usePointerEventsWatchdog());
    document.body.style.pointerEvents = "none";

    window.dispatchEvent(new PopStateEvent("popstate"));
    await tick();

    expect(document.body.style.pointerEvents).toBe("");
  });

  test("leaves the lock in place while an overlay is still open", async () => {
    renderHook(() => usePointerEventsWatchdog());
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("data-state", "open");
    document.body.appendChild(dialog);
    document.body.style.pointerEvents = "none";

    window.dispatchEvent(new PopStateEvent("popstate"));
    await tick();

    expect(document.body.style.pointerEvents).toBe("none");
  });

  test("is a no-op when nothing is locked", async () => {
    renderHook(() => usePointerEventsWatchdog());

    window.dispatchEvent(new PopStateEvent("popstate"));
    await tick();

    expect(document.body.style.pointerEvents).toBe("");
  });
});
