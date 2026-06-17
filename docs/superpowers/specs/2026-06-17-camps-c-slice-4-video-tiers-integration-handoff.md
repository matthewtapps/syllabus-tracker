# Camps Epic C — Slice 4 (video-tiers-dependent) — integration spec + handoff

**Date:** 2026-06-17
**Status:** BLOCKED on external in-flight branches. NOT implemented. This is an evidence-based integration plan + handoff, written after a feasibility probe.
**Covers:** scoped camp techniques (CC-009/010/011/012/014), per-camp video visibility (CC-015), CC-018 upload-scope choice.

## Why this is deferred (not built)

Slice 4's three features hard-depend on two **independent, still-open** PRs:
- **PR #74 `feat/syllabus-modification-ux`** — adds `techniques.is_global` (the library-membership / scoped-technique foundation). Scoped camp techniques = non-global techniques owned by a camp, so they need `is_global`.
- **PR #75 `feat/video-tiers-propagation`** — adds the unified `video_visibility_overrides(scope_kind, scope_id, video_id, visible, …)` table + the single resolver shared by list + playback guard, migrating the legacy per-student/syllabus visibility tables. Per-camp video visibility (CC-015) = one more `scope_kind='camp'` rung in that resolver. CC-018's scope choice also leans on the tier model.

Neither is merged to `main`; **#75 does not include #74** (they are independent off `main`). So Slice 4 needs a 4-way integration: `main` + the camps line (#76→#77→#78) + #74 + #75.

### Feasibility probe (2026-06-17, on a throwaway `scratch/s4-merge-probe`)
- Merging **#74** into the camps line (`feat/camps-footage-nextcamp`) was **textually clean per git, but the result does not compile/test**: the `config/schema.sql` auto-merge silently dropped `techniques.is_global` while #74's `query!` macros reference it → runtime `no such column: t.is_global` (5 errors). The `techniques`-table region needs **manual schema reconciliation**, not a trust-the-auto-merge.
- **#75** was not even attempted on top, because it edits the exact core files the camps work heavily modified — `crates/syllabus-tracker/src/db/videos.rs` (the `VideoParent` enum + every parent-column SQL site), the `videos` table `parent_kind` CHECK in `config/schema.sql` (camps added `'camp'`/`'match'` branches; #75 adds `'syllabus_technique'`/`'student_syllabus_technique'` and reworks the per-branch constraints), plus `videos/processor.rs`, `videos/routes.rs`, `main.rs`. These are semantic conflicts in the core video model that require understanding #75's *final* resolver design.

Conclusion: forcing this merge autonomously, while #74/#75 are unmerged and may still change, risks corrupting the carefully-built video model and producing a tree the #75 author cannot reconcile. **Do Slice 4 only after #74 and #75 land on `main`** (or are frozen), then branch off `main` with all three lines present.

## Integration order (when unblocked)
1. Land #74 and #75 on `main` (or rebase the camps PRs #76/#77/#78 onto them and merge), so `main` has: `is_global`, the unified `video_visibility_overrides` + resolver, AND the camps/competitions/matches model.
2. Branch `feat/camps-scoped-visibility` off the integrated `main`.
3. Reconcile the `videos` `parent_kind` CHECK so it carries ALL parent kinds: `technique, student_profile, thread, loose, camp, match, syllabus_technique, student_syllabus_technique` — each branch asserting its own id non-null and all siblings (incl. `camp_id`/`match_id`) null. The camps work's per-branch `AND camp_id IS NULL` / `AND match_id IS NULL` discipline must extend to #75's new branches and vice versa.

## Feature designs (build on the merged base)

### Scoped camp techniques (CC-009/010/011/012/014) — needs `is_global`
- A camp-scoped technique = a row in `techniques` with `is_global = 0`, owned by a camp. Add `scoped_camp_id INTEGER REFERENCES camps(id)` to `techniques` (nullable; set when `is_global=0` and the technique was created inside a camp), OR reuse #74's scoping column if it already models "owned by X". Reconcile with #74's `is_global` semantics — do NOT invent a parallel scope flag if #74 already has one.
- CC-009: create-in-camp → global (is_global=1 + camp_technique row). CC-010: create-in-camp → scoped (is_global=0 + scoped_camp_id + camp_technique row); must NOT appear in the global library list (the library query already filters is_global=1 once #74 lands). CC-012: a `/scoped-techniques` coach view (GET techniques where is_global=0) badged by student/camp. CC-011: promote scoped→global with a granular content picker. CC-014: add-to-camp picker surfaces similar scoped techniques from other students with copy/promote actions.
- The camp add-technique flow (Slice 1) + create-camp-technique need a scope radio (global vs scoped) at creation, per the concepts doc (explicit choice, no silent default).

### Per-camp video visibility (CC-015) — needs #75's unified resolver
- The seam already exists: `effective_camp_video_visible(video, viewer)` in `db/videos.rs` (added in Slice 1.5 A3) currently only checks global hide. Once #75's `video_visibility_overrides` resolver lands, add `scope_kind='camp'` (scope_id = camp_id) as a precedence rung and route the camp video read through #75's shared resolver instead of the standalone helper. A coach hides a library video within one camp without affecting other contexts.
- The camp belongs to one student, so the camp scope is naturally per-student — no extra student dimension needed.

### CC-018 — upload-scope choice on a camp technique
- When uploading a video to a camp technique whose technique is GLOBAL, offer "this camp only" vs "promote to the global technique" (flip `parent_kind` technique vs camp). When the parent technique is scoped (is_global=0), hide the choice (nothing global to promote to). Uses the promote-in-place rule (flip parent_kind, preserve video.id, delete now-meaningless lower override rows) from the video-tiers spec.

## What's already in place to make this smooth
- `effective_camp_video_visible` resolver seam (Slice 1.5).
- Camp/match video ownership tiers (`parent_kind='camp'`/`'match'`) already mirror #75's typed-column polymorphic pattern, so adding camp/match as resolver inputs is consistent.
- The camps schema's per-branch `… IS NULL` CHECK discipline is the same pattern #75 uses, so reconciling the combined CHECK is mechanical (union of branches) once both are present.

## Handoff
Resume when #74 + #75 are merged/frozen. Start at "Integration order" step 1. Estimated: 1 reconcile task (schema + videos.rs CHECK/VideoParent union) + 1 per feature (scoped techniques, per-camp visibility, CC-018), each with the usual implement→review cycle.
