import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlayerControllerProvider, usePlayerController } from "./player-context";

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
