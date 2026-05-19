declare global {
  interface ImportMetaEnv {
    VITE_HONEYCOMB_API_KEY: string;
    VITE_API_URL: string;
    VITE_ENVIRONMENT: string;
    VITE_APP_NAME: string;
    VITE_OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?: string;
  }

  interface Window {
    apiKey?: string;
  }
}

const apiKey =
  import.meta.env.VITE_HONEYCOMB_API_KEY ||
  "hcaik_01kqnsdc1zzhhsjg2wtg39zcpbrptm9re8fe4nsbyxqtfvkyrkkanhe5s7";
window.apiKey = apiKey;

import { initTelemetry } from "./lib/telemetry";

initTelemetry();
