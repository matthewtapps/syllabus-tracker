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

// Create a custom exporter that uses the Beacon API for more reliable delivery
class BeaconOTLPTraceExporter extends OTLPTraceExporter {
  constructor(config) {
    super(config);
    this.beaconUrl = config.url;
    this.beaconHeaders = config.headers;
  }

  // Override send method to attempt Beacon API as fallback
  send(items, onSuccess, onError) {
    // Store serialized spans for potential beacon use
    const jsonData = this.serialize(items);

    // Try standard XHR/fetch first
    super.send(items, onSuccess, (error) => {
      // If standard export fails, try sendBeacon as fallback
      console.log("Falling back to sendBeacon for telemetry export");
      const blob = new Blob([jsonData], { type: "application/json" });
      const beaconSuccess = navigator.sendBeacon(this.beaconUrl, blob);

      if (beaconSuccess) {
        onSuccess();
      } else {
        onError(error);
      }
    });
  }
}

// Initialize the exporter with beacon fallback support
const exporter = new BeaconOTLPTraceExporter({
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

let flushSuccess = false;

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

      const formId = form.id || "unnamed-form";
      const formAction = form.action || window.location.href;
      const formMethod = form.method || "get";

      const formSpan = tracer.startSpan(`form_submit_${formId}`);
      formSpan.setAttribute("form.action", formAction);
      formSpan.setAttribute("form.method", formMethod);
      formSpan.setAttribute("form.id", formId);

      let response = null;

      try {
        const formData = new FormData(form);

        const traceparent = `00-${formSpan.spanContext().traceId}-${formSpan.spanContext().spanId}-01`;
        const headers = { traceparent };

        const fetchSpan = tracer.startSpan("fetch_request", {
          parent: formSpan,
          attributes: {
            "http.url": formAction,
            "http.method": formMethod,
          },
        });

        try {
          response = await fetch(formAction, {
            method: formMethod,
            body: formData,
            headers: headers,
            redirect: "follow",
          });

          fetchSpan.setAttribute("http.status_code", response.status);
          fetchSpan.setAttribute("http.redirected", response.redirected);

          fetchSpan.end();
        } catch (error) {
          fetchSpan.recordException(error);
          fetchSpan.end();
          throw error;
        }

        formSpan.end();

        await flushTelemetryBeforeNavigation();

        if (response && response.redirected) {
          window.location.href = response.url;
        } else if (response) {
          const html = await response.text();
          document.open();
          document.write(html);
          document.close();
        }
      } catch (error) {
        console.error("Form submission error:", error);

        // Record error and end span
        formSpan.recordException(error);
        formSpan.end();

        // Try to flush telemetry
        await flushTelemetryBeforeNavigation();

        // Fallback to normal form submission
        form.submit();
      }
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

async function flushTelemetryBeforeNavigation() {
  try {
    await provider.forceFlush();
    flushSuccess = true;
    return true;
  } catch (e) {
    return false;
  }
}
