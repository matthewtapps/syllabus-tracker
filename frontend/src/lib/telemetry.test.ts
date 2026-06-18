import { beforeAll, describe, it, expect } from "vitest";
import { context, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  WebTracerProvider,
} from "@opentelemetry/sdk-trace-web";
import { runInFormSpan } from "./telemetry";

// A real provider so spans actually record and we can read parent/child
// linkage. Without one, the global no-op tracer returns non-recording spans
// (isRecording() === false, all-zero span ids) and the nesting can't be
// observed.
const exporter = new InMemorySpanExporter();

beforeAll(() => {
  const provider = new WebTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  provider.register();
});

describe("runInFormSpan", () => {
  it("makes the form span the parent of work started inside the callback", async () => {
    exporter.reset();

    await runInFormSpan(
      { formId: "upload-video", action: "/api/videos", method: "post" },
      async () => {
        // A child opened against the active context (as the fetch
        // auto-instrumentation would) must nest under the form span.
        const child = trace
          .getTracer("test")
          .startSpan("child", undefined, context.active());
        child.end();
      },
    );

    const spans = exporter.getFinishedSpans();
    const form = spans.find((s) => s.name === "form_submit_upload-video");
    const child = spans.find((s) => s.name === "child");

    expect(form).toBeDefined();
    expect(child).toBeDefined();
    expect(child?.parentSpanContext?.spanId).toBe(form?.spanContext().spanId);
  });

  it("returns the callback's resolved value", async () => {
    const out = await runInFormSpan(
      { formId: "f", action: "/api/x", method: "post" },
      async () => 42,
    );
    expect(out).toBe(42);
  });
});
