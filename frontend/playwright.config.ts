import { defineConfig, devices } from "@playwright/test";

// Real student data must not end up in traces, screenshots or reports.
const realData = process.env.SMOKE_REAL_DATA === "1";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  retries: 0,
  workers: 1,
  reporter: realData
    ? "list"
    : [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: process.env.SMOKE_BASE_URL ?? "http://localhost:8080",
    trace: realData ? "off" : "retain-on-failure",
    screenshot: realData ? "off" : "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
