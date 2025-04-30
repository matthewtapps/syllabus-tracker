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

      const submitButton = getSubmitButton(form);
      if (submitButton) {
        setButtonLoading(submitButton, true);
      }

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

          if (submitButton) {
            setButtonLoading(submitButton, false);
          }
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

        formSpan.recordException(error);
        formSpan.end();

        await flushTelemetryBeforeNavigation();

        if (submitButton) {
          setButtonLoading(submitButton, false);
        }

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

function getSubmitButton(form) {
  let submitButton = form.querySelector('button[type="submit"]');

  if (!submitButton) {
    submitButton = form.querySelector('input[type="submit"]');
  }

  if (!submitButton) {
    const buttons = Array.from(form.querySelectorAll("button:not([type])"));
    if (buttons.length > 0) {
      submitButton = buttons[0]; // Use the first one
    }
  }

  if (!submitButton) {
    const buttons = Array.from(form.querySelectorAll("button"));
    if (buttons.length > 0) {
      submitButton = buttons[buttons.length - 1]; // Typically the last button is submit
    }
  }

  return submitButton;
}

function setButtonLoading(button, isLoading) {
  if (isLoading) {
    button.dataset.originalText = button.innerHTML;

    button.classList.add("btn-loading");
    button.innerHTML = '<span class="loading-spinner"></span>';
    button.disabled = true;
  } else {
    if (button.dataset.originalText) {
      button.innerHTML = button.dataset.originalText;
    }
    button.classList.remove("btn-loading");
    button.disabled = false;
  }
}
