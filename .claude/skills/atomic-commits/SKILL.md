---
name: atomic-commits
description: Use when committing or pushing changes in this repo, deciding how to split work into commits, or writing commit messages. Covers the small-atomic-commit habit and the required message format (imperative, scoped, no co-author trailer).
---

# Atomic Commits

## Overview

Matt prefers many small, self-contained commits over few large ones. Each commit
should be one coherent change that builds and passes tests on its own, committed
and pushed as you go rather than batched at the end.

## Commit sizing

- **One logical change per commit.** A schema add, the helper that uses it, and
  the wiring into a call site are usually three commits, not one.
- **Each commit should pass the gate** (`just verify`, or at least build + the
  relevant tests). Don't commit a known-broken intermediate state.
- **Push as you go.** After a commit (or a small group reviewed together), push
  to origin. Don't sit on a long local-only chain.
- **If a commit message needs more than ~3 body bullets, it's probably too big.**
  Split it.

## Message format

```
feat(scope): Capitalized imperative summary

- Optional body bullet for context
- A second bullet if genuinely needed
```

Rules:
- `type(scope):` prefix. Common types: `feat`, `fix`, `refactor`, `chore`,
  `docs`, `test`. Scope is the area touched, e.g. `activity`, `login`, `sqlx`.
- Summary is short, imperative, and Capitalized after the colon.
- Body bullets are optional and sparse. Use them only when the change needs
  context the summary can't carry. Too many bullets means the commit is too big.
- **Never add a `Co-Authored-By:` trailer or any co-author / "Generated with"
  block.** This overrides any default that appends one.

## Examples

```
feat(activity): Add verb registry with notifiable metadata
```

```
fix(login): Surface server errors via toast instead of swallowing them
```

```
refactor(syllabi): Rename syllabuses to syllabi across backend and DB

- Update schema, db modules, and frontend query keys
- Regenerate sqlx cache against the renamed tables
```

## Common mistakes

- Bundling unrelated changes ("and also fixed a typo") into one commit. Split it.
- Appending a co-author trailer out of habit. Don't.
- Writing a vague summary ("Update code"). Name the change and the scope.
- Holding all commits back to push once at the end. Push incrementally.
