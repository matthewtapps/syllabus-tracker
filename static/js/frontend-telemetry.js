import { getWebAutoInstrumentations } from "https://cdn.jsdelivr.net/npm/@opentelemetry/auto-instrumentations-web/+esm";
import { ZoneContextManager } from "https://cdn.jsdelivr.net/npm/@opentelemetry/context-zone/+esm";
import { OTLPTraceExporter } from "https://cdn.jsdelivr.net/npm/@opentelemetry/exporter-trace-otlp-http/+esm";
import {
  resourceFromAttributes,
  envDetector,
  processDetector,
} from "https://cdn.jsdelivr.net/npm/@opentelemetry/resources/+esm";
import {
  WebTracerProvider,
  BatchSpanProcessor,
} from "https://cdn.jsdelivr.net/npm/@opentelemetry/sdk-trace-web/+esm";
import { SemanticResourceAttributes } from "https://cdn.jsdelivr.net/npm/@opentelemetry/semantic-conventions/+esm";
import { registerInstrumentations } from "https://cdn.jsdelivr.net/npm/@opentelemetry/instrumentation/+esm";

const exporter = new OTLPTraceExporter({
  url: "https://api.honeycomb.io/v1/traces",
  headers: {
    "x-honeycomb-team": window.apiKey,
  },
});

const provider = new WebTracerProvider({
  spanProcessors: [new BatchSpanProcessor(exporter)],
  resource: resourceFromAttributes({
    [SemanticResourceAttributes.SERVICE_NAME]: "syllabus-tracker-frontend",
    "session.id": getOrCreateSessionId(),
  }),
  resourceDetectors: [envDetector, processDetector],
});

provider.register({
  contextManager: new ZoneContextManager(),
});

registerInstrumentations({
  instrumentations: [getWebAutoInstrumentations()],
});

document.addEventListener("DOMContentLoaded", function () {
  const tracer = provider.getTracer("forms");

  const forms = document.querySelectorAll("form");

  forms.forEach((form) => {
    form.addEventListener("submit", async function (event) {
      // Don't intercept forms with specific data-no-trace attribute
      if (form.hasAttribute("data-no-trace")) {
        return true;
      }

      event.preventDefault();

      // Get form details for span attributes
      const formId = form.id || "unnamed-form";
      const formAction = form.action || window.location.href;
      const formMethod = form.method || "get";

      tracer.startActiveSpan(`form_submit_${formId}`, async (span) => {
        span.setAttribute("form.action", formAction);
        span.setAttribute("form.method", formMethod);
        span.setAttribute("form.id", formId);

        try {
          const formData = new FormData(form);

          const traceparent = `00-${span.spanContext().traceId}-${span.spanContext().spanId}-01`;

          const headers = {
            traceparent,
          };

          span.end();

          await provider.forceFlush();

          const response = await fetch(formAction, {
            method: formMethod,
            body: formData,
            headers: headers,
            redirect: "follow",
          });

          if (response.redirected) {
            // If the response is a redirect, follow it
            window.location.href = response.url;
          } else {
            // Otherwise, replace the current page with the response
            const html = await response.text();
            document.open();
            document.write(html);
            document.close();
          }
        } catch (error) {
          console.error("Form submission error:", error);
          span.recordException(error);
          span.end();
          await provider.forceFlush();
          form.submit(); // Fallback to normal submission
        }
      });
    });
  });
});

function setCookie(name, value, minutes) {
  const expires = new Date();
  expires.setTime(expires.getTime() + minutes * 60 * 1000);
  document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/;SameSite=Lax`;
}

function getCookie(name) {
  const nameEQ = name + "=";
  const ca = document.cookie.split(";");
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i].trim();
    if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
  }
  return null;
}

function getOrCreateSessionId() {
  let sessionId = getCookie("otel_session_id");

  if (!sessionId) {
    sessionId =
      "session_" +
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15);

    setCookie("otel_session_id", sessionId, 5);
  }

  return sessionId;
}
