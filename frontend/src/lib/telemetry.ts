import {
  context,
  SpanStatusCode,
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
      "deployment.environment.name": import.meta.env.VITE_ENVIRONMENT || "unknown",
      "app.name": import.meta.env.VITE_APP_NAME || "syllabus-tracker",
      "session.id": getOrCreateSessionId(),
    }),
  });

  provider.register({
    contextManager: new ZoneContextManager(),
  });

  // Only propagate W3C trace context to our own backend (same-origin `/api`),
  // so browser spans link to the backend trace. Never propagate to third
  // parties; explicitly ignore the Honeycomb export endpoint so the exporter's
  // own POSTs aren't traced (which would feed back on itself).
  const apiTraceUrls = [new RegExp(`${window.location.origin}/api`)];
  const honeycombUrls = [/api\.honeycomb\.io/];

  registerInstrumentations({
    instrumentations: [
      getWebAutoInstrumentations({
        "@opentelemetry/instrumentation-fetch": {
          propagateTraceHeaderCorsUrls: apiTraceUrls,
          ignoreUrls: honeycombUrls,
          clearTimingResources: true,
        },
        "@opentelemetry/instrumentation-xml-http-request": {
          propagateTraceHeaderCorsUrls: apiTraceUrls,
          ignoreUrls: honeycombUrls,
        },
      }),
    ],
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
 * Record a route change event
 */
export function recordRouteChange(path: string, previousPath?: string): void {
  const currentTracer = getTracer("recordRouteChange");
  const span = currentTracer.startSpan("route_change");

  // Wide event: load this client-side navigation up with cheap context so the
  // frontend dataset is queryable by route, session, env and viewport.
  span.setAttribute("app.route", path);
  if (previousPath) {
    span.setAttribute("app.previous_route", previousPath);
  }
  span.setAttribute("session.id", getOrCreateSessionId());
  if (document.referrer) {
    span.setAttribute("app.referrer", document.referrer);
  }
  span.setAttribute("browser.viewport.width", window.innerWidth);
  span.setAttribute("browser.viewport.height", window.innerHeight);
  span.setAttribute("browser.language", navigator.language);

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
