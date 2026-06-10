---
name: ci-and-staging-deploy
description: Use when opening a PR, checking whether CI passed, or deploying a branch to staging in this repo. Covers the GitHub Actions gates (deploy.yaml on PRs), the manual staging-sibling deploy (staging.yml), and the local verify gate.
---

# CI and Staging Deploy

## Overview

Two GitHub Actions workflows matter for day-to-day work: `deploy.yaml` runs the
correctness gate on every PR (and the full prod deploy on `main`), and
`staging.yml` deploys an arbitrary branch to a parallel "sibling" staging stack
on demand. Prod deploys are automatic on merge to `main`; staging is manual.

## Local gate (run before pushing)

`just verify` runs the same checks CI gates on: backend lint, backend test,
`cargo sqlx prepare --check`, frontend lint, frontend build, frontend test.
Any commit that touches `sqlx::query!` must include the regenerated `.sqlx/`
cache (`just sqlx-prepare`) or `sqlx-check` fails CI.

## CI on pull requests (`deploy.yaml`)

- Triggers: `push` to `main` (full deploy), `pull_request` (gate only),
  manual `workflow_dispatch`.
- On a PR, only the correctness jobs run (lint / test / sqlx-check). The
  deploy-only jobs are gated `if: github.event_name != 'pull_request'`, so a PR
  never touches prod infra. Opening the PR is how you exercise CI.
- Check a PR's checks:
  ```bash
  gh pr checks <pr-number> --watch
  gh run list --branch <branch> --limit 5
  gh run view <run-id> --log-failed   # inspect a failure
  ```

## Staging deploy (`staging.yml`, "Staging sibling")

Manual only, via `workflow_dispatch`. Builds backend + frontend images from a
named branch and deploys to https://staging.sillybus.app. Use it to inspect WIP
roadmap work before it merges.

Inputs:
- `branch` (required) - branch to build and deploy.
- `refresh_db` (default `false`) - wipe staging DB and re-fork from prod backups.
- `allow_destructive_migrations` (default `true`) - allow destructive schema
  migrations against the staged DB.

Trigger it:
```bash
gh workflow run staging.yml \
  -f branch=<branch> \
  -f refresh_db=false \
  -f allow_destructive_migrations=false
# then watch:
gh run list --workflow=staging.yml --limit 3
gh run watch <run-id>
```

Notes:
- For purely additive schema changes (new `CREATE TABLE / INDEX IF NOT EXISTS`),
  set `allow_destructive_migrations=false`. Only set it `true` when you
  knowingly drop or rewrite columns/tables and accept data loss on staging.
- The deploy wipes the `videos.*` tables after forking the DB so a staging
  viewer can't trigger playback against prod S3 objects.
- Concurrency group `staging-sibling` with `cancel-in-progress: false`: there is
  one staging stack, deploys run one at a time. Deploying the top branch of a
  stack covers the branches beneath it.

## Common mistakes

- Forgetting `just sqlx-prepare` after editing a query, then CI fails on
  `sqlx-check`. Regenerate and include `.sqlx/` in the same commit.
- Expecting a PR to deploy. PRs only gate; merging to `main` deploys prod.
- Triggering staging with `allow_destructive_migrations=true` for an additive
  change. Leave it `false` unless you mean it.
