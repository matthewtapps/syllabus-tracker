import path from "path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";

// Separate from vite.config.ts so the PWA plugin and bundle visualizer stay
// out of the test run. Aliases mirror vite.config.ts so component code that
// imports from "@/..." resolves identically under test.
//
// Two projects:
//  - "node":    pure-function tests (no DOM) run in Node via Vite transform.
//               Files must end in .unit.test.ts to opt into this project.
//  - "browser": component/integration tests run in Chromium via Playwright.
//                Everything else (*.test.ts, *.test.tsx) lands here.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    projects: [
      {
        // Node project: pure TS unit tests, no browser needed.
        plugins: [react()],
        resolve: {
          alias: { "@": path.resolve(__dirname, "./src") },
        },
        test: {
          name: "node",
          include: ["src/**/*.unit.test.{ts,tsx}"],
          setupFiles: ["./src/test/setup.ts"],
          environment: "node",
          browser: { enabled: false },
        },
      },
      {
        // Browser project: component and integration tests via Playwright.
        plugins: [react()],
        resolve: {
          alias: { "@": path.resolve(__dirname, "./src") },
        },
        test: {
          name: "browser",
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: ["src/**/*.unit.test.{ts,tsx}"],
          setupFiles: ["./src/test/setup.ts"],
          css: true,
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
