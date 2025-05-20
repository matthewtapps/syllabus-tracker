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

const apiKey =
  import.meta.env.VITE_HONEYCOMB_API_KEY ||
  "hcaik_01jvp2z2gwqffmtv456vvej5ta606mb1beakaetx2kqg6shdakch8333an";
window.apiKey = apiKey;

import { initTelemetry } from "./lib/telemetry";

initTelemetry();
