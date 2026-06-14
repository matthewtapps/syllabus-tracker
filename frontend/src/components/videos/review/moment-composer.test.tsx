import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MomentComposer } from "./moment-composer";

describe("MomentComposer", () => {
  it("collapsed shows the capture button with the current timestamp", () => {
    render(<MomentComposer currentTime={42} duration={60} canStamp onSubmit={vi.fn()} />);
    expect(screen.getByRole("button", { name: /comment at 0:42/i })).toBeTruthy();
  });

  it("posts a timestamped comment with the captured seconds", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<MomentComposer currentTime={42} duration={60} canStamp onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: /comment at 0:42/i }));
    await userEvent.type(screen.getByRole("textbox"), "hand too low");
    await userEvent.click(screen.getByRole("button", { name: /^post$/i }));
    expect(onSubmit).toHaveBeenCalledWith({ video_ts_seconds: 42, body: "hand too low" });
  });

  it("clear posts a whole-video comment (null seconds)", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<MomentComposer currentTime={42} duration={60} canStamp onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: /comment at 0:42/i }));
    await userEvent.click(screen.getByRole("button", { name: /whole video/i }));
    await userEvent.type(screen.getByRole("textbox"), "good rep");
    await userEvent.click(screen.getByRole("button", { name: /^post$/i }));
    expect(onSubmit).toHaveBeenCalledWith({ video_ts_seconds: null, body: "good rep" });
  });

  it("nudges the stamp by one second", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<MomentComposer currentTime={42} duration={60} canStamp onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: /comment at 0:42/i }));
    await userEvent.click(screen.getByRole("button", { name: /nudge forward/i }));
    await userEvent.type(screen.getByRole("textbox"), "x");
    await userEvent.click(screen.getByRole("button", { name: /^post$/i }));
    expect(onSubmit).toHaveBeenCalledWith({ video_ts_seconds: 43, body: "x" });
  });

  it("without canStamp, posts whole-video only (no capture button)", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<MomentComposer currentTime={0} duration={60} canStamp={false} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: /comment on video/i }));
    await userEvent.type(screen.getByRole("textbox"), "embed note");
    await userEvent.click(screen.getByRole("button", { name: /^post$/i }));
    expect(onSubmit).toHaveBeenCalledWith({ video_ts_seconds: null, body: "embed note" });
  });

  it("at the start, defaults to a whole-video comment", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<MomentComposer currentTime={0} duration={60} canStamp onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: /comment on video/i }));
    await userEvent.type(screen.getByRole("textbox"), "from the top");
    await userEvent.click(screen.getByRole("button", { name: /^post$/i }));
    expect(onSubmit).toHaveBeenCalledWith({ video_ts_seconds: null, body: "from the top" });
  });

  it("at the end, defaults to a whole-video comment", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<MomentComposer currentTime={60} duration={60} canStamp onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: /comment on video/i }));
    await userEvent.type(screen.getByRole("textbox"), "final note");
    await userEvent.click(screen.getByRole("button", { name: /^post$/i }));
    expect(onSubmit).toHaveBeenCalledWith({ video_ts_seconds: null, body: "final note" });
  });

  it("renders an inline action slot in the collapsed row", () => {
    render(
      <MomentComposer
        currentTime={42}
        duration={60}
        canStamp
        onSubmit={vi.fn()}
        actionSlot={<button type="button">Download video</button>}
      />,
    );
    expect(screen.getByRole("button", { name: /download video/i })).toBeTruthy();
  });
});
