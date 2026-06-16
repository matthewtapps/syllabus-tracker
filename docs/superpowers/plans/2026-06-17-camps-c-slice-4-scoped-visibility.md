# Camps C-Slice 4 — scoped techniques + per-camp video visibility + CC-018 — plan

> Branch `feat/camps-scoped-visibility` off `feat/camps-footage-nextcamp` (#78), which is now rebased onto #75 (video-tiers) → #74 (is_global). So the base HAS `techniques.is_global` and the unified `video_visibility_overrides` + `effective_video_visible` resolver. Each task: subagent implement → review → fix. Gate: `nix develop .#ci --command just verify`. No em-dashes, no `any`. `just sqlx-prepare` (never bare). Spec: `docs/superpowers/specs/2026-06-16-camps-epic-c-competitions-matches-footage-design.md` (C-Slice 4) + `2026-06-17-camps-c-slice-4-video-tiers-integration-handoff.md`.

## Base facts (verified on the rebased branch)
- `techniques.is_global INTEGER NOT NULL DEFAULT 1` exists (#74). The global library list filters `is_global = 1` (confirm in `db/techniques.rs`).
- `video_visibility_overrides(scope_kind IN ('student','syllabus','assignment'), scope_id, video_id, visible, set_by_id, set_at)` + `effective_video_visible(pool, video_id, assignment_id)` resolver (#75).
- Camps left a seam: `effective_camp_video_visible(deleted, hidden)` in `db/videos.rs` (currently global-hide only) + `list_videos_for_camp`.

---

### S4-1. Per-camp video visibility (CC-015)
- Schema: add `'camp'` to the `video_visibility_overrides.scope_kind` CHECK.
- `db/videos.rs`: replace the stub `effective_camp_video_visible` with a real resolver that, for a camp video read, applies precedence: `deleted > video.hidden_at(global) > camp-scope override (scope_kind='camp', scope_id=camp_id)`. Update `list_videos_for_camp` to LEFT JOIN `video_visibility_overrides` on `(scope_kind='camp', scope_id=camp_id, video_id)` and apply `visible`. A coach hiding a LIBRARY video within a camp = an override row `visible=0`. (Camp-owned videos are visible by default; the override lets a coach hide specific videos within the camp context, per CC-015 "for this comp, don't watch that no-gi variation".)
- Routes: `POST /api/camps/<id>/videos/<video_id>/visibility` `{visible}` (ManageCamps) → upsert/delete the camp-scope override. Mirror the existing syllabus visibility route (`api_set_video_student_visibility` analog in videos/routes.rs).
- Frontend: on the camp video list (and/or camp technique videos), a coach "hide in this camp" toggle per video; reads/writes the override. Reuse the existing visibility-control component pattern from the syllabus surface.
- Tests: hide a video in a camp → it drops from the camp video list for the student but remains in library/other contexts; coach still sees it badged.

### S4-2. Scoped camp techniques — create + exclude + display (CC-009/010)
- Schema: add `scoped_camp_id INTEGER REFERENCES camps(id)` to `techniques` (nullable; set when `is_global=0` and created inside a camp). A scoped technique: `is_global=0`, `scoped_camp_id=<camp>`.
- `db/techniques.rs` / `db/camps.rs`: a create-technique-in-camp fn taking a `global: bool` choice (CC-009 global vs CC-010 scoped). Global → `is_global=1` + camp_technique row. Scoped → `is_global=0` + `scoped_camp_id` + camp_technique row. The global library list already excludes `is_global=0`; confirm scoped techniques don't leak into library/assignment pickers (audit `is_global` filters).
- Camp add-technique flow (the existing picker on the camp detail page): add a "create new" path with the explicit global-vs-scoped radio (per concepts doc, no silent default).
- Routes: extend `POST /api/camps/<id>/techniques` or a new `POST /api/camps/<id>/techniques/create` `{name, description, scope: 'global'|'scoped'}`.
- Frontend: the camp add-technique dialog gains a "Create new technique" mode with the scope radio.
- Tests: create scoped → not in global library list, present in the camp; create global → in library + camp.

### S4-3. Scoped-technique management — promote / scoped view / copy / picker suggestions (CC-011/012/014)
- `/scoped-techniques` coach view: `GET /api/techniques?scope=scoped` (is_global=0), badged by student/camp. Filter/sort (CC-012/013).
- Promote scoped→global (CC-011): flip `is_global=1`, clear `scoped_camp_id`; granular content (videos/notes) come along (for Slice 4 core: flip the flag; granular per-content picker is a follow-up).
- Add-to-camp picker surfaces matching scoped techniques from other students with copy/promote actions (CC-014).
- This task is the largest; may be split or partially deferred. Ship the scoped-techniques VIEW + basic promote first.

### S4-4. CC-018 upload-scope choice
- Uploading a video to a camp technique whose technique is GLOBAL: offer "this camp only" vs "promote to the global technique" (a camp-owned video vs flip parent to the global technique). When the parent technique is scoped (is_global=0), hide the choice. Uses the promote-in-place rule (flip parent_kind, preserve video.id, delete now-meaningless lower override rows).

### S4-5. Tests + verify + PR
- `just verify` green. Push; PR `feat/camps-scoped-visibility` base `feat/camps-footage-nextcamp` (top of the stack). Body: scoped techniques + per-camp visibility + CC-018; note any CC-011/012/014/018 granular parts deferred.

## Sequencing
S4-1 (per-camp visibility — cleanest, uses #75 resolver + existing seam) → S4-2 (scoped technique create/exclude/display — the core) → S4-3 (management; partially deferrable) → S4-4 (CC-018) → S4-5. Ship S4-1 + S4-2 as the solid core; S4-3/S4-4 as runway allows or documented follow-ups.
