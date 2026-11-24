import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// SMOKE_REAL_DATA=1 (prod, or a fork of it) skips every write and any role
// without its own SMOKE_*_USER credentials.
const realData = process.env.SMOKE_REAL_DATA === "1";
const coach = {
  username: process.env.SMOKE_COACH_USER ?? "demo_coach",
  password: process.env.SMOKE_COACH_PASSWORD ?? "password",
};
const student = {
  username: process.env.SMOKE_STUDENT_USER ?? "demo_alex",
  password: process.env.SMOKE_STUDENT_PASSWORD ?? "demo",
};
const admin = {
  username: process.env.SMOKE_ADMIN_USER ?? "admin",
  password: process.env.SMOKE_ADMIN_PASSWORD ?? "demo",
};

// The forms lib/dates.ts parses: naive UTC, RFC 3339 with an offset, or a date.
const TIMESTAMP_FORMS = [
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/,
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
  /^\d{4}-\d{2}-\d{2}$/,
];
const LOOKS_LIKE_DATE = /^\d{4}-\d{2}-\d{2}/;

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function* timestamps(value: Json, path = ""): Generator<[string, string]> {
  if (typeof value === "string") {
    if (LOOKS_LIKE_DATE.test(value)) yield [path, value];
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      yield* timestamps(child, `${path}.${key}`);
    }
  }
}

function badTimestamp(value: string): boolean {
  if (!TIMESTAMP_FORMS.some((form) => form.test(value))) return true;
  const iso = /[ T]/.test(value) && !/(Z|[+-]\d{2}:\d{2})$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const year = new Date(iso).getUTCFullYear();
  return !(year >= 2000 && year <= 2100);
}

// Records server errors, page errors and unparseable timestamps for one page.
function watch(page: Page) {
  const problems: string[] = [];
  const pending: Promise<void>[] = [];
  page.on("pageerror", (err) => problems.push(`page error: ${err.message}`));
  page.on("response", (res) => {
    const url = new URL(res.url());
    if (!url.pathname.startsWith("/api/")) return;
    const route = `${res.request().method()} ${url.pathname}`;
    if (res.status() >= 500) problems.push(`${res.status()} ${route}`);
    if (!(res.headers()["content-type"] ?? "").includes("application/json")) return;
    pending.push(
      res.json().then(
        (body: Json) => {
          for (const [path, value] of timestamps(body)) {
            if (badTimestamp(value)) problems.push(`timestamp ${route} ${path}=${value}`);
          }
        },
        () => {},
      ),
    );
  });
  return async () => {
    await Promise.all(pending);
    expect(problems, problems.join("\n")).toEqual([]);
  };
}

async function logIn(page: Page, user: { username: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel(/username/i).fill(user.username);
  await page.getByLabel(/password/i).fill(user.password);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL(/\/dashboard/);
}

async function visit(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Session lost" })).toHaveCount(0);
  await expect(page.locator("main")).not.toBeEmpty();
}

test("coach pages load", async ({ page }) => {
  const check = watch(page);
  await logIn(page, coach);
  for (const path of ["/dashboard", "/dashboard/classic", "/students", "/library", "/syllabi", "/profile"]) {
    await visit(page, path);
  }

  await visit(page, "/students");
  const href = await page.locator('a[href^="/student/"]').first().getAttribute("href");
  const studentId = href?.match(/\/student\/(\d+)/)?.[1];
  expect(studentId, "a student link on /students").toBeTruthy();
  for (const path of [`/student/${studentId}`, `/student/${studentId}/syllabi`, `/student/${studentId}/pinned`]) {
    await visit(page, path);
  }
  await visit(page, `/student/${studentId}/syllabi`);
  const syllabus = page.locator(`a[href^="/student/${studentId}/syllabi/"]`).first();
  if (await syllabus.count()) await visit(page, (await syllabus.getAttribute("href"))!);

  await visit(page, "/syllabi");
  const template = page.locator('a[href^="/syllabi/"]').first();
  if (await template.count()) await visit(page, (await template.getAttribute("href"))!);
  await check();
});

test("student pages load", async ({ page }) => {
  test.skip(realData && !process.env.SMOKE_STUDENT_USER, "no student account");
  const check = watch(page);
  await logIn(page, student);
  const me = await (await page.request.get("/api/me")).json();
  for (const path of ["/dashboard", "/library", "/profile", `/student/${me.id}/syllabi`, `/student/${me.id}/pinned`]) {
    await visit(page, path);
  }
  await check();
});

test("admin page loads", async ({ page }) => {
  test.skip(realData && !process.env.SMOKE_ADMIN_USER, "no admin account");
  const check = watch(page);
  await logIn(page, admin);
  await visit(page, "/admin");
  await check();
});

test("coach uploads, plays and comments on a video", async ({ page }) => {
  test.skip(realData, "writes data");
  const check = watch(page);
  await logIn(page, coach);

  const techniques = await (await page.request.get("/api/techniques")).json();
  const technique = techniques[0];
  const title = `Smoke clip ${Date.now()}`;
  const upload = await page.request.post(`/api/techniques/${technique.id}/videos/upload`, {
    multipart: {
      title,
      file: {
        name: "clip.mp4",
        mimeType: "video/mp4",
        buffer: readFileSync(new URL("./fixtures/clip.mp4", import.meta.url)),
      },
    },
  });
  expect(upload.ok(), await upload.text()).toBeTruthy();
  const { video_id } = await upload.json();
  await expect
    .poll(
      async () => {
        const { videos } = await (await page.request.get(`/api/techniques/${technique.id}/videos`)).json();
        return videos.find((v: { id: number }) => v.id === video_id)?.processing_status;
      },
      { timeout: 60_000 },
    )
    .toBe("ready");

  await visit(page, "/library");
  await page.getByText(technique.name).first().click();
  await page.getByText(title).first().click();
  const video = page.locator("video").first();
  await expect(video).toBeVisible();
  await page.waitForFunction(() => (document.querySelector("video")?.readyState ?? 0) >= 2);

  const box = (await video.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 3);
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime)).toBeGreaterThan(0.5);
  await page.getByRole("button", { name: /pause/i }).first().click();
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.paused)).toBe(true);

  const slider = page.getByTestId("time-slider");
  const track = (await slider.boundingBox())!;
  await page.mouse.click(track.x + track.width * 0.75, track.y + track.height / 2);
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime / el.duration))
    .toBeGreaterThan(0.6);

  await page.getByRole("button", { name: /comment at/i }).click();
  const body = `Smoke comment ${Date.now()}`;
  await page.getByPlaceholder(/what did you notice/i).fill(body);
  await page.getByRole("button", { name: "Post" }).click();
  await expect(page.getByRole("paragraph").filter({ hasText: body })).toBeVisible();
  await check();
});

test("timestamp check accepts what lib/dates parses and nothing else", () => {
  for (const ok of ["2026-11-21T10:00:00Z", "2026-11-21T10:00:00.120+00:00", "2026-11-18 09:42:45.720859320", "2026-11-21"]) {
    expect(badTimestamp(ok), ok).toBe(false);
  }
  for (const bad of ["2026-11-21 10:00:00+00:00", "2026-11-21T10:00", "21/11/2026", "1970-01-01T00:00:00Z"]) {
    expect(badTimestamp(bad), bad).toBe(true);
  }
});
