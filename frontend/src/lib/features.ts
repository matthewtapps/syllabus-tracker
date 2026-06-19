/**
 * Build-time feature gates.
 *
 * Camps are an in-progress epic. They ship to staging
 * (and local dev) so the work can be reviewed, but stay hidden on production
 * until the epic lands. `VITE_ENVIRONMENT` is a per-build arg: `production` on
 * the prod deploy, `staging` on the staging sibling, `development` / `pr-check`
 * elsewhere (see frontend/Dockerfile + the deploy workflows). Gating on
 * "not production" keeps the feature visible everywhere except prod.
 *
 * This is resolved at build time, so flipping production means changing this
 * gate (or the build env) and redeploying, not a live toggle.
 */
export const campsUiEnabled = import.meta.env.VITE_ENVIRONMENT !== "production";
