import {
  context,
  SpanStatusCode,
  propagation,
  type Context,
  type Span,
  type Tracer,
  trace,
} from "@opentelemetry/api";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { getWebAutoInstrumentations } from "@opentelemetry/auto-instrumentations-web";
import { ZoneContextManager } from "@opentelemetry/context-zone";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-web";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

function getOrCreateSessionId(): string {
  const key = "otel_session_id";
  let sessionId = localStorage.getItem(key);

  if (!sessionId) {
    sessionId = `session_${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;
    localStorage.setItem(key, sessionId);
  }

  return sessionId;
}

function getTracer(name: string): Tracer {
  return trace.getTracer(name);
}

/**
 * Initialize the OpenTelemetry tracer
 */
export function initTelemetry(): void {
  const exporter = new OTLPTraceExporter({
    url: "https://api.honeycomb.io/v1/traces",
    headers: {
      "x-honeycomb-team": window.apiKey || "",
    },
  });

  const provider = new WebTracerProvider({
    spanProcessors: [new BatchSpanProcessor(exporter)],
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "syllabus-tracker-frontend",
      "session.id": getOrCreateSessionId(),
    }),
  });

  provider.register({
    contextManager: new ZoneContextManager(),
  });

  registerInstrumentations({
    instrumentations: [getWebAutoInstrumentations()],
  });
}

/**
 * Creates and runs a new span
 */
export function createSpan<T>(
  name: string,
  fn: (span: Span) => T | Promise<T>,
  options?: {
    attributes?: Record<string, string | number | boolean | string[]>;
    parent?: Context;
  },
): Promise<T> {
  const currentTracer = getTracer("createSpan");
  const parentContext = options?.parent || context.active();

  return context.with(parentContext, async () => {
    const span = currentTracer.startSpan(name, {
      attributes: options?.attributes,
    });

    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Enhanced fetch that propagates trace context
 */
export async function tracedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = input instanceof Request ? input.url : input.toString();

  return createSpan("fetch", async (span) => {
    span.setAttribute("http.url", url);
    span.setAttribute("http.method", init?.method || "GET");

    const headers = new Headers(init?.headers || {});
    const propagationContext = { traceparent: "" };

    propagation.inject(context.active(), propagationContext);

    if (propagationContext.traceparent) {
      headers.set("traceparent", propagationContext.traceparent);
    }

    const sessionId = getOrCreateSessionId();
    headers.set("x-session-id", sessionId);

    const response = await fetch(input, {
      ...init,
      headers,
    });

    span.setAttribute("http.status_code", response.status);
    span.setAttribute("http.status_text", response.statusText);

    if (!response.ok) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: `HTTP ${response.status}: ${response.statusText}`,
      });
    }

    return response;
  });
}

/**
 * Record a route change event
 */
export function recordRouteChange(path: string, previousPath?: string): void {
  const currentTracer = getTracer("recordRouteChange");
  const span = currentTracer.startSpan("route_change");

  span.setAttribute("app.route", path);
  if (previousPath) {
    span.setAttribute("app.previous_route", previousPath);
  }

  span.end();
}

/**
 * Record a form submission event
 */
export function recordFormSubmission(
  formId: string,
  action: string,
  method: string,
): Span {
  const currentTracer = getTracer("recordFormSubmission");
  const span = currentTracer.startSpan(`form_submit_${formId}`);

  span.setAttribute("form.action", action);
  span.setAttribute("form.method", method);
  span.setAttribute("form.id", formId);

  return span;
}
