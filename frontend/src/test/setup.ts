import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Vitest 4 browser mode doesn't auto-cleanup the DOM between tests, so the
// previous render leaks into the next test's screen queries. Force the same
// teardown JSDOM users get for free.
afterEach(() => {
  cleanup();
});
