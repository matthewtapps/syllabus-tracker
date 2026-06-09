#!/usr/bin/env node
// Drives a real Chromium against the local dev stack for visual review
// of a UI change. Designed for ad-hoc per-PR use, not automated tests.
//
// Usage:
//   PLAYWRIGHT_BROWSERS_PATH=$(nix-build '<nixpkgs>' -A playwright-driver.browsers --no-out-link) \
//     node frontend/scripts/manual-verify.mjs <scenario>
//
// Scenarios are exported below. Pass `--help` to see the list.
//
// Why this file exists:
//   We're on NixOS. Playwright's default browser bundle doesn't run
//   because of dynamic-linker issues; the Nix-provided browsers do.
//   PLAYWRIGHT_BROWSERS_PATH points playwright at the Nix derivation.
//
// Screenshots land in frontend/scripts/screenshots/<scenario>/.

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_ROOT = join(__dirname, "screenshots");
const BASE_URL = process.env.BASE_URL ?? "http://localhost:5173";
const API_URL = process.env.API_URL ?? "http://localhost:8000";

const SCENARIOS = {
  "pr03-rank": pr03Rank,
  "pr04-footage-submitter": pr04FootageSubmitter,
  "pr06-library-access": pr06LibraryAccess,
};

async function main() {
  const scenarioName = process.argv[2];
  if (!scenarioName || scenarioName === "--help") {
    console.log("scenarios:");
    for (const k of Object.keys(SCENARIOS)) console.log("  " + k);
    process.exit(scenarioName ? 0 : 1);
  }
  const scenario = SCENARIOS[scenarioName];
  if (!scenario) {
    console.error("unknown scenario: " + scenarioName);
    process.exit(1);
  }
  const outDir = join(SCREENSHOTS_ROOT, scenarioName);
  await mkdir(outDir, { recursive: true });

  // 390x844 is the iPhone 14 viewport. Mobile-first review default.
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  try {
    await scenario({ page, outDir });
    console.log("screenshots in: " + outDir);
  } finally {
    await browser.close();
  }
}

async function loginAs(page, { username, password }) {
  // Use the API directly to set the session cookie; the login page UI
  // is already covered by the existing app and we want to focus on the
  // post-login surfaces here.
  const res = await page.request.post(API_URL + "/api/login", {
    data: { username, password },
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok()) throw new Error("login failed: " + res.status());
}

async function shot(page, outDir, name) {
  await page.screenshot({ path: join(outDir, name + ".png"), fullPage: false });
}

// ===========================================================
// PR 3 scenario: rank strip + edit dialog on a student profile
// ===========================================================
async function pr03Rank({ page, outDir }) {
  await loginAs(page, { username: "demo_coach", password: "password" });

  // demo_alex (id=3) was seeded with a rank.
  await page.goto(BASE_URL + "/student/3");
  await page.waitForLoadState("networkidle");
  await shot(page, outDir, "01-coach-view-with-rank");

  // Open the edit dialog.
  await page.getByRole("button", { name: "Edit rank" }).click();
  await page.waitForSelector('[role="dialog"]');
  await shot(page, outDir, "02-coach-edit-dialog");

  // Pick a new belt + stripes value and save.
  await page.locator('button[role="combobox"]').click();
  await page.getByRole("option", { name: "Black" }).click();
  await page.locator('input[type="number"]').fill("3");
  await page.locator('input[type="date"]').fill("2026-06-08");
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForSelector('[role="dialog"]', { state: "detached" });
  await shot(page, outDir, "03-coach-after-save");

  // Now check the student's own view (login as alex, demo password).
  await page.request.post(API_URL + "/api/logout");
  await loginAs(page, { username: "demo_alex", password: "demo" });
  await page.goto(BASE_URL + "/student/3");
  await page.waitForLoadState("networkidle");
  await shot(page, outDir, "04-student-own-view");

  // Empty-state coach view for a student who has no rank.
  await page.request.post(API_URL + "/api/logout");
  await loginAs(page, { username: "demo_coach", password: "password" });
  // Jordan (the "pending approval" demo) was intentionally left rank-less.
  // Look up his id at runtime via /api/students.
  const studentsRes = await page.request.get(API_URL + "/api/students", {
    headers: { "Content-Type": "application/json" },
  });
  const students = await studentsRes.json();
  const jordan = students.find((s) => s.username === "demo_jordan");
  if (jordan) {
    await page.goto(BASE_URL + "/student/" + jordan.id);
    await page.waitForLoadState("networkidle");
    await shot(page, outDir, "05-coach-empty-state");
  }
}

// ===========================================================
// PR 4 scenario: FootageSubmitter promote/revoke + badge
// ===========================================================
async function pr04FootageSubmitter({ page, outDir }) {
  await loginAs(page, { username: "demo_coach", password: "password" });

  // Reset demo_alex to a plain Student so the "grant" path is reachable
  // on a fresh run.
  await page.request.post(API_URL + "/api/student/3/footage-submitter", {
    data: { enabled: false },
    headers: { "Content-Type": "application/json" },
  });

  await page.goto(BASE_URL + "/student/3");
  await page.waitForLoadState("networkidle");
  await shot(page, outDir, "01-coach-before-grant");

  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Grant Footage Submitter" }).click();
  await page.waitForTimeout(500);
  await shot(page, outDir, "02-coach-after-grant");

  await page.getByRole("button", { name: "More actions" }).click();
  await page.waitForSelector('[role="menu"]');
  await shot(page, outDir, "03-coach-menu-after-grant");
  await page.keyboard.press("Escape");

  // Login as the now-promoted student to confirm /api/me carries
  // SubmitFootage and the badge renders.
  await page.request.post(API_URL + "/api/logout");
  await loginAs(page, { username: "demo_alex", password: "demo" });
  await page.goto(BASE_URL + "/student/3");
  await page.waitForLoadState("networkidle");
  await shot(page, outDir, "04-student-own-view-with-badge");
}

// ===========================================================
// PR 6 scenario: students browsing the library (read-only)
// ===========================================================
async function pr06LibraryAccess({ page, outDir }) {
  // Coach view first so we have a reference point.
  await loginAs(page, { username: "demo_coach", password: "password" });
  await page.goto(BASE_URL + "/library");
  await page.waitForLoadState("networkidle");
  await shot(page, outDir, "01-coach-library");

  // Coach view of one expanded technique row -- captures edit/upload
  // affordances that should disappear for students.
  await page.locator("ul li button").first().click();
  await page.waitForTimeout(400);
  await shot(page, outDir, "02-coach-expanded");

  await page.request.post(API_URL + "/api/logout");
  await loginAs(page, { username: "demo_alex", password: "demo" });
  await page.goto(BASE_URL + "/library");
  await page.waitForLoadState("networkidle");
  await shot(page, outDir, "03-student-library");

  await page.locator("ul li button").first().click();
  await page.waitForTimeout(400);
  await shot(page, outDir, "04-student-expanded");

  // Collections page sanity-check from the student side.
  await page.goto(BASE_URL + "/collections");
  await page.waitForLoadState("networkidle");
  await shot(page, outDir, "05-student-collections");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
