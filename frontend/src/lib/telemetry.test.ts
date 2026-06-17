import { describe, it, expect } from "vitest";
import { context, trace } from "@opentelemetry/api";
import { runInFormSpan } from "./telemetry";

describe("runInFormSpan", () => {
  it("makes the form span the active span while the callback runs", async () => {
    let active: string | undefined;
    await runInFormSpan(
      { formId: "upload-video", action: "/api/videos", method: "post" },
      async () => {
        const span = trace.getSpan(context.active());
        active = span && span.isRecording() ? "recording" : undefined;
      },
    );
    expect(active).toBe("recording");
  });

  it("returns the callback's resolved value", async () => {
    const out = await runInFormSpan(
      { formId: "f", action: "/api/x", method: "post" },
      async () => 42,
    );
    expect(out).toBe(42);
  });
});
