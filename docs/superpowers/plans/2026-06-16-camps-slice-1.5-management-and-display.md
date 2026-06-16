# Camps Slice 1.5 — management UI + display completion — plan

> Completes the coach workflow + display gaps left by Slice 1 (PR #76). Same branch `feat/camps-slice-1`, same PR. Each task: subagent implement → spec review → quality review → fix. Gate: `nix develop .#ci --command just verify` + pre-commit hook. No em-dashes, no `any`. Stay on branch; no stash.

**Goal:** make camps an end-to-end coach workflow (add techniques, archive, see camp-owned videos) and finish the display/deep-link polish.

**Builds on:** `docs/superpowers/specs/2026-06-16-camps-slice-1-design.md`. These items were the design's deferred bullets, not new design.

---

## A — finish the coach workflow

### A1. Add-technique picker on the camp detail page
- **Reuse** the `AddTechniqueDialog` pattern in `frontend/src/app/syllabi/[id]/page.tsx` (uses `useLibraryTechniques` + search/tag filter + multi-select). Adapt to camps: on confirm, call `useAddCampTechnique(campId)` for each selected technique (or extend the hook to accept a list — prefer per-id calls reusing the existing single-add endpoint, awaited together).
- Coach-only "Add techniques" button on the camp detail page techniques section header.
- After add, invalidate `qk.camp(campId)` (the hook already does) so the list refreshes.
- Exclude techniques already in the camp from the picker (the dialog filters by what's present, like the syllabus one).
- Test: a `.test.tsx` is optional; rely on tsc/lint + the existing detail render test. If quick, add a unit-ish test for the "already in camp" filter.

### A2. Archive button on the camp detail page
- Coach-only "Archive camp" button (e.g. in the header, `variant="outline"` or a small menu). Confirm dialog ("Archive this camp? It stays referenceable but drops out of active views.").
- `useArchiveCamp(studentId)` — note it needs `studentId` for list invalidation; the camp detail has `camp.student_id`. On success, toast + either navigate back to `/student/<studentId>/camps` or stay and show the Archived badge (prefer navigate back).
- Hide the Archive button when `camp.archived_at` is already set.

### A3. Camp-owned video display + coach upload on the detail page
- **Backend read-model:** add `camp_id: Option<i64>` to `DbVideo` and `Video` (`crates/syllabus-tracker/src/models.rs`), to the `From<DbVideo> for Video` impl, and to EVERY `DbVideo`-building SELECT in `db/videos.rs` (search for the `query_as!`/column lists that build `DbVideo`; `thread_id` is the sibling to mirror). Regenerate `.sqlx`.
- **Backend list endpoint:** add a camp-video list fn (e.g. `list_videos_for_camp(pool, camp_id)`), routed through ONE small `effective_camp_video_visible` helper (Approach A: `deleted_at IS NULL AND hidden_at IS NULL`, coaches see hidden badged) so the future `video_visibility_overrides` scope='camp' rung slots in later. Add `GET /api/camps/<id>/videos` (read: camp student or coach).
- **Frontend:** `Video` type gains `camp_id`. A camp-videos section on the detail page using the existing `VideoList`/video player components (reuse `components/videos`), with the coach `AddVideoButton`/upload pointed at the camp upload route `POST /api/camps/<id>/videos/upload` (exists). Honour the `?focus=...&video=` deep-link to the camp video.
- Keep this scoped: camp-owned videos are a flat list on the camp (not per-technique). The per-camp-technique video upload (CC-018) stays out (needs scope choice / is_global).

### A4. Populate tags + video_count on camp techniques
- Backend `list_camp_techniques` (or the camp-detail technique query): also return `tags` and `video_count` for each technique, reusing the library-row subqueries (tag join + alive-video count). Extend the `CampTechnique` Rust type accordingly; regen `.sqlx`.
- Frontend `CampTechnique` type gains `tags`/`video_count`; `toCampLibraryShape` populates them instead of zeroing. Removes the empty tags block + "0 videos" badge.
- Leave collection_count/student_count zeroed (not shown on camp/pinned surfaces).

## B — display + deep-link polish

### B1. Activity-feed camp chip
- `frontend/src/components/activity-feed-list.tsx`: give `surface.kind === "camp"` its own icon (e.g. `Dumbbell`) instead of falling to `Library`. Optionally a dynamic label: thread `camp_name` onto `ActivityRow` (backend feed SELECTs join `camps.name`) so the chip reads the camp name; if that's too broad, keep the static "Camp" label and just fix the icon. Prefer: fix icon now; add `camp_name` only if cheap.

### B2. Camp detail expanded-row → URL writeback
- Use `useListUrlState` (the hook behind `useTechniqueListNav`) so opening/closing a technique row writes `?focus=` to the URL, matching the library/syllabus pages. Replace the local `openValue` useState with the URL-backed state. Keep deep-link IN working.

### B3. Camp discussion consumes `?thread=<id>`
- The camp discussion section renders an inline `ThreadView` list; make it honour the `?thread=<id>` query param (scroll to + highlight that thread), mirroring the `discussion-block.tsx` thread-focus logic. Extract/reuse that scroll-highlight rather than reimplement if practical.

---

## Sequencing
A3 and A4 are backend+frontend (regen sqlx). A1/A2/B1/B2/B3 are frontend-mostly. Do A3 + A4 first (they touch the read model + payload other tasks display), then A1, A2, then B1-B3. Each task commits separately; push to PR #76 after the batch is green.

## Out of scope (tracked, not here)
Scoped camp techniques (CC-010, needs `is_global` from PR #74), per-camp video visibility (CC-015, needs unified overrides from PR #75), and all of epic C (competitions/matches/footage/next-camp) — separate branch/PR.
