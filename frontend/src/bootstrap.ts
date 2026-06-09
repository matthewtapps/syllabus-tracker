declare global {
  interface ImportMetaEnv {
    VITE_HONEYCOMB_API_KEY: string;
    VITE_API_URL: string;
    VITE_ENVIRONMENT: string;
    VITE_APP_NAME: string;
  }

  interface Window {
    apiKey?: string;
  }
}

const envKey = import.meta.env.VITE_HONEYCOMB_API_KEY;
if (!envKey) {
  // Public browser ingest key, intentionally embedded (see frontend/Dockerfile
  // for the rationale). Falling back here keeps local dev ergonomic, but
  // production should always inject the env var so misconfigured deploys
  // surface as a console warning instead of silently using the dev key.
  console.warn(
    "[telemetry] VITE_HONEYCOMB_API_KEY not set; using public dev fallback. Set the env var in production.",
  );
}
const apiKey =
  envKey || "hcaik_01kqnsdc1zzhhsjg2wtg39zcpbrptm9re8fe4nsbyxqtfvkyrkkanhe5s7";
window.apiKey = apiKey;

import { initTelemetry } from "./lib/telemetry";
import { installAuthRedirect } from "./lib/auth-redirect";

installAuthRedirect();
initTelemetry();
