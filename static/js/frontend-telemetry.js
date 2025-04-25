import { getWebAutoInstrumentations } from "https://cdn.jsdelivr.net/npm/@opentelemetry/auto-instrumentations-web@0.43.0/+esm";
import { HoneycombWebSDK } from "https://cdn.jsdelivr.net/npm/@honeycombio/opentelemetry-web@0.9.0/+esm";

const configDefaults = {
  ignoreNetworkEvents: true,
};

const sdk = new HoneycombWebSDK({
  debug: false,
  apiKey: window.apiKey, // Replace with your Honeycomb Ingest API Key.
  serviceName: "syllabus-tracker-frontend",
  instrumentations: [
    getWebAutoInstrumentations({
      "@opentelemetry/instrumentation-xml-http-request": configDefaults,
      "@opentelemetry/instrumentation-fetch": configDefaults,
      "@opentelemetry/instrumentation-document-load": configDefaults,
      "@opentelemetry/instrumentation-user-interaction": configDefaults,
    }),
  ],
});
sdk.start();
