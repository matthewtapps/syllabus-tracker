/**
 * sillybus-video-worker — Cloudflare Worker + Container
 *
 * Exposes:
 *   POST /jobs  — enqueue endpoint (app POSTs here via VIDEO_ENQUEUE_URL)
 *   queue()     — Queue consumer; fetches each job into a VideoContainer
 *
 * VideoContainer — DurableObject backed container. Runs transcode-server in
 * sync mode (default, TRANSCODE_SERVER_ASYNC not set). The queue consumer
 * awaits the container fetch; a non-2xx response causes the message to retry
 * via Queue dead-letter after max_retries attempts.
 *
 * Container env vars (S3_*, VIDEO_CALLBACK_SECRET) are forwarded from the
 * Worker env to the container process via the `envVars` property on the
 * Container class. This is the documented @cloudflare/containers mechanism:
 * `envVars` is merged into the container's process environment at start time.
 */

import { Container, getContainer } from "@cloudflare/containers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of ProcessJob sent by the app's CloudflareProcessor. */
interface ProcessJob {
  video_id: number;
  source_key: string;
  callback_url: string;
}

/** Worker environment bindings — all must be declared in wrangler.jsonc. */
interface Env {
  // Queue binding (producer + consumer on sillybus-video-jobs)
  QUEUE: Queue<ProcessJob>;

  // Durable Object binding for the VideoContainer class
  VIDEO_CONTAINER: DurableObjectNamespace<VideoContainer>;

  // Bearer token checked on POST /jobs
  ENQUEUE_TOKEN: string;

  // Passed through to the container process via envVars
  VIDEO_CALLBACK_SECRET: string;
  S3_ENDPOINT: string;
  S3_REGION: string;
  S3_BUCKET: string;
  S3_ACCESS_KEY: string;
  S3_SECRET_KEY: string;
  S3_FORCE_PATH_STYLE: string;
  S3_PUBLIC_ENDPOINT: string;
}

// ---------------------------------------------------------------------------
// VideoContainer — the Cloudflare Container DurableObject
// ---------------------------------------------------------------------------

/**
 * VideoContainer wraps transcode-server running on port 8080.
 *
 * `envVars` is set in the constructor from the Worker env so that the
 * container process receives the S3 credentials and callback secret.
 * The `defaultPort` matches `PORT` default in transcode-server (8080).
 * `sleepAfter` lets CF reclaim idle containers after 5 minutes.
 */
export class VideoContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "5m";

  constructor(ctx: DurableObjectState<Env>, env: Env) {
    super(ctx, env);

    // Forward all secrets and S3 config from the Worker env into the container
    // process environment. transcode-server reads these directly via std::env.
    this.envVars = {
      VIDEO_CALLBACK_SECRET: env.VIDEO_CALLBACK_SECRET,
      S3_ENDPOINT: env.S3_ENDPOINT,
      S3_REGION: env.S3_REGION,
      S3_BUCKET: env.S3_BUCKET,
      S3_ACCESS_KEY: env.S3_ACCESS_KEY,
      S3_SECRET_KEY: env.S3_SECRET_KEY,
      S3_FORCE_PATH_STYLE: env.S3_FORCE_PATH_STYLE,
      S3_PUBLIC_ENDPOINT: env.S3_PUBLIC_ENDPOINT,
    };
  }
}

// ---------------------------------------------------------------------------
// Worker fetch handler — POST /jobs enqueue endpoint
// ---------------------------------------------------------------------------

async function fetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method !== "POST" || url.pathname !== "/jobs") {
    return new Response("not found", { status: 404 });
  }

  // Bearer token check
  const auth = request.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ") || auth.slice(7) !== env.ENQUEUE_TOKEN) {
    return new Response("unauthorized", { status: 401 });
  }

  // Parse and validate the job body
  let job: ProcessJob;
  try {
    const body = await request.json<ProcessJob>();
    if (
      typeof body.video_id !== "number" ||
      typeof body.source_key !== "string" ||
      typeof body.callback_url !== "string"
    ) {
      throw new Error("missing required fields");
    }
    job = body;
  } catch (e) {
    return new Response(`bad request: ${e}`, { status: 400 });
  }

  // Enqueue for async processing via the queue consumer
  await env.QUEUE.send(job);

  return new Response("accepted", { status: 202 });
}

// ---------------------------------------------------------------------------
// Worker queue consumer — fetches each job into the container
// ---------------------------------------------------------------------------

/**
 * Per queue message:
 *  1. Resolve a VideoContainer instance keyed by video_id so concurrent
 *     jobs for different videos get independent containers.
 *  2. POST the job JSON into the container on its /jobs path.
 *     transcode-server runs video-worker synchronously and returns 200
 *     (success) or 500 (nonzero exit). We await the full response.
 *  3. On non-2xx, throw so the Queue retries the message. After
 *     max_retries (3) the message is dead-lettered.
 *  4. On 2xx, ack the message.
 *
 * Note: HMAC signing is NOT done here. The container (video-worker) already
 * POSTs a signed ProcessingResult callback to the app on its own. The
 * app also has a stuck-row sweeper as a backstop for any missed callbacks.
 */
async function queue(
  batch: MessageBatch<ProcessJob>,
  env: Env
): Promise<void> {
  for (const message of batch.messages) {
    const job = message.body;

    // Use a per-video-id container so jobs don't share state.
    const containerStub = getContainer(
      env.VIDEO_CONTAINER,
      `video-${job.video_id}`
    );

    let resp: Response;
    try {
      resp = await containerStub.fetch(
        new Request("https://container/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(job),
        })
      );
    } catch (e) {
      // Network-level error fetching into the container; retry via Queue.
      console.error(
        `[queue] fetch error for video_id=${job.video_id}: ${e}`
      );
      message.retry();
      continue;
    }

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => "(no body)");
      console.error(
        `[queue] container returned ${resp.status} for video_id=${job.video_id}: ${errBody}`
      );
      // Non-2xx: retry. Queue will dead-letter after max_retries.
      message.retry();
      continue;
    }

    message.ack();
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export default { fetch, queue };
