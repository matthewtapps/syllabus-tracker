import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  PlayerControllerProvider,
  usePlayerController,
  type PlayerRegistration,
} from "./player-context";

function Probe() {
  const c = usePlayerController();
  return (
    <div>
      <span data-testid="time">{c.currentTime}</span>
      <span data-testid="canSeek">{String(c.canSeek)}</span>
      <button onClick={() => c.seekTo(42)}>seek</button>
    </div>
  );
}

function FullscreenProbe() {
  const c = usePlayerController();
  return (
    <button type="button" onClick={c.exitFullscreen}>
      {c.isFullscreen ? "fs-on" : "fs-off"}
    </button>
  );
}

describe("PlayerController", () => {
  it("defaults to inert (no seek capability) until a seek handle registers", () => {
    render(<PlayerControllerProvider><Probe /></PlayerControllerProvider>);
    expect(screen.getByTestId("canSeek").textContent).toBe("false");
    expect(screen.getByTestId("time").textContent).toBe("0");
  });

  it("routes seekTo to the registered handle and exposes reported time", async () => {
    const seekSpy = vi.fn();
    render(
      <PlayerControllerProvider
        onReady={(register) => {
          register.registerSeek(seekSpy);
          register.reportProgress(42, 100);
        }}
      >
        <Probe />
      </PlayerControllerProvider>,
    );
    expect(screen.getByTestId("time").textContent).toBe("42");
    expect(screen.getByTestId("canSeek").textContent).toBe("true");
    await userEvent.click(screen.getByText("seek"));
    expect(seekSpy).toHaveBeenCalledWith(42);
  });
});

describe("PlayerControllerProvider fullscreen channel", () => {
  it("reflects reported fullscreen state and forwards exitFullscreen", async () => {
    let reg: PlayerRegistration | null = null;
    const exit = vi.fn();

    render(
      <PlayerControllerProvider onReady={(r) => { reg = r; }}>
        <FullscreenProbe />
      </PlayerControllerProvider>,
    );

    // Registered exit fn is invoked when the controller asks to exit.
    act(() => reg!.registerExitFullscreen(exit));
    expect(screen.getByRole("button").textContent).toBe("fs-off");

    act(() => reg!.reportFullscreen(true));
    expect(screen.getByRole("button").textContent).toBe("fs-on");

    act(() => screen.getByRole("button").click());
    expect(exit).toHaveBeenCalledTimes(1);
  });
});
