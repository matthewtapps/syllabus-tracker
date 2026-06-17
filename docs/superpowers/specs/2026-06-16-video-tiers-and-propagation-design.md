# Syllabus customization: snapshot + reconcile, with minimal video inheritance — design

**Date:** 2026-06-16 (rewritten after clean-room review + paradigm decision)
**Status:** Design approved; **decoupled into its own subsystem** — the technique/snapshot work (plan Chunks A–D) ships first and independently; this video-tiers + cross-tier-propagation subsystem gets its own `writing-plans` cycle once the pinned items below are turned into tasks. See the Second-Review Addendum at the bottom for the authoritative resolved decisions (they supersede any conflicting text above).
**Supersedes:** the earlier live-inheritance draft of this file.
**Related plan:** `docs/superpowers/plans/2026-06-16-student-syllabus-modification-uplift.md`.

## Paradigm decision

After a clean-room review surfaced serious state-tangle risk, we rejected **live inheritance** (CSS/Figma-style override resolution at every tier) in favour of the paradigm the app already uses and the industry default for template→instance customization:

- **Techniques: snapshot + reconcile.** Assigning a syllabus *copies* its techniques into per-student rows (already true: `db/syllabi.rs:283`). A student's syllabus is an authoritative snapshot. Template changes reach students only via (a) an opt-in one-time **fan-out of adds** and (b) the explicit **diff/reconcile tool** (already exists). No live inheritance, no override resolution, no tri-state for techniques.
- **Videos: minimal single-table inheritance.** Videos are shared heavy assets and cannot be snapshot-copied per student. A video is **owned at exactly one tier**; lower tiers inherit it; a viewer can **hide an inherited video locally**. This is the *only* inheritance in the system: one ownership column, one override table, one resolution function.

Rationale: snapshot is simpler, maintainable, extensible, and—critically—*more intuitive and safer* (a later template edit must not silently rewrite a student a coach already tailored). It also matches the existing schema and the existing diff tool.

## Tiers

| Tier | Techniques | Videos |
|---|---|---|
| T1 Global / library | `techniques` (`is_global`) | video with `parent_kind='technique'` |
| T2 Syllabus template | `syllabus_techniques` (membership) | video with `parent_kind='syllabus_technique'` (NEW) |
| T3 Student assignment | `student_syllabus_techniques` (SST — authoritative snapshot) | video with `parent_kind='student_syllabus_technique'` (NEW) |

All three technique-tier tables already exist. No new tier table is needed (the "new table" instinct is satisfied by the single video-override table below, not a new tier).

## Techniques — snapshot model (mostly status quo; we *remove* planned complexity)

- A student's syllabus = its SST rows; the SST row is **authoritative** for that student.
- **Hide** at T3 = `student_syllabus_techniques.hidden_at` boolean. This is *correct*, not smelly: there is no parent to inherit from at read time, so there is nothing to be "override-aware" about. (The clean-room H1 concern only applied to live inheritance, which we are not doing.)
- **Add** at T3 = insert an SST row. "Add as hidden" = insert with `hidden_at` set. (Note: the current `add_technique_to_assignment` *clears* `hidden_at`; that must change to honour an explicit "add hidden".)
- **Template edits (T2):**
  - Add a technique to the template = insert `syllabus_techniques`. Optional **fan-out** switch (default ON, excludes graduated assignments): insert the missing SST rows into existing assignments. Fan-out **only adds missing rows; it never overwrites or un-hides an existing SST** — so it cannot clobber a coach's per-student customization.
  - Remove/hide at the template = surfaced in the diff tool for per-student reconcile; not auto-applied to existing snapshots.
- **Diff/reconcile tool** (exists, we extend it): compares each SST snapshot against the current template.
  - *ghost* = technique on the student but not in the template (student-only / custom add).
  - *missing* = technique in the template but absent or hidden on the student. **Required change:** split today's collapsed bucket (`sst.id IS NULL OR sst.hidden_at IS NOT NULL`, `student_syllabus_techniques.rs:585`) into **absent** vs **added-then-hidden**, so the two are distinguishable when reconciling.

No override tables, no resolution function, no cascade-timing problem for techniques.

## Videos — single-owner tier + one override table + one resolver

### Ownership
A video's `parent_kind` names its owning tier: `technique` (T1), `syllabus_technique` (T2), `student_syllabus_technique` (T3). T2/T3 are new `parent_kind` values with their typed columns + CHECK branches, mirroring the existing polymorphic pattern in `videos.rs`.

**Tier-2 anchor:** parent the T2 video by **(`syllabus_id`, `technique_id`)** columns on `videos` for the `syllabus_technique` kind (avoids adding a surrogate id to the composite-PK `syllabus_techniques` and the table rebuild that implies). Removing a technique from a syllabus must **soft-handle** any T2 videos (don't hard-cascade-delete them); reconcile/orphan policy defined in the plan. Per-syllabus duplication (same technique in two syllabi → a T2 video in only one) is *intended* — the coach added it to that syllabus.

### Visibility override — ONE table
Replace the ad-hoc set (`videos.hidden_at` for T1 global hide stays; **migrate** `student_syllabus_video_visibility` and fold in the legacy `video_student_visibility`) with one table:

```
video_visibility_overrides(
  scope_kind  TEXT CHECK (scope_kind IN ('syllabus','assignment')),
  scope_id    INTEGER NOT NULL,         -- syllabus_id  OR  syllabus_assignment_id
  video_id    INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  visible     BOOLEAN NOT NULL,         -- explicit show (1) or hide (0)
  set_by_id   INTEGER REFERENCES users(id),
  set_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (scope_kind, scope_id, video_id)
)
```
Presence of a row = explicit choice; absence = inherit. `assignment` scope covers per-student (an assignment *is* a (student, syllabus) pair). `syllabus` scope covers "hide this for the whole syllabus."

### One resolution function (used by BOTH list and playback guard)
`effective_video_visible(video, assignment) ->` precedence ladder:
1. `video.deleted_at` set → **hidden**
2. assignment-scope override exists → its `visible`
3. syllabus-scope override exists → its `visible`
4. owned in this viewer's scope chain (T1 technique, OR T2 of this syllabus, OR T3 of this assignment) → `video.hidden_at IS NULL`
5. otherwise → **not a candidate** (absent, different owner)

This ends the current divergence where the list query (`videos.rs:418`) and the playback guard (`videos.rs:544`) consult *different* tables.

### Per-syllabus video read
Candidate set = videos owned at T1(technique) ∪ T2(this syllabus, technique) ∪ T3(this assignment), then filtered by the resolver.

### Add a video, with scope switches
- Add at T3 (student): switches "Also add to syllabus" + "Also add to global technique", default ON (your spec). ON = own at the higher tier; OFF at a higher tier just means it stays owned lower. "Add as hidden to existing assignments" when adding higher with the down-switch off = own high + insert `visible=0` assignment-scope overrides for existing (non-graduated) assignments.
- Add at T2 / T1: the conditional up/down switches you specified; down-propagation that is "off" writes hide-overrides (so it's present-but-hidden, revealable), consistent with the technique fan-out's "adds only, never clobber" rule.

### Promote / re-parent / delete
- Promote a video up a tier = **flip `parent_kind` in place** (preserve `video.id` → watch history/aggregates intact) **and delete now-meaningless lower-scope override rows in the same transaction**.
- Soft-delete (`deleted_at`) unchanged; override rows `ON DELETE CASCADE` with the video.

## UX (unchanged from what you approved)
- **Sticky scope selector** (This student / This syllabus / Global), remembered per session, sets the tier quiet one-click edits act on.
- **Cascade switch(es)** under the selector when scope is above the student (fan-out adds / update-existing), default ON, graduated excluded.
- **Quiet one-click edits**; a row shows only the current context's state (no busy cross-tier pills).
- **On-demand cross-context control** in the expanded row when specifically sought.
- **Add = small scope-ladder popover** with the per-tier switches pre-set by scope.
- **Diff dialog = the reconcile surface**, now covering techniques *and* videos (stage-and-apply).

## Graduation
Point-in-time filter on fan-out/propagation only (`graduated_at IS NULL`). Reversible un-graduation does **not** retro-apply skipped changes; a re-activated student is reconciled via the diff tool. (Acceptable because techniques are snapshots and videos resolve live — a re-activated student immediately sees current inherited videos; only fanned-out technique adds need a diff pass.)

## Impact on the in-flight implementation plan
- **Chunk A (is_global) — keep.** It's library-membership (ownership), orthogonal to all this.
- **Chunk B (frontend plumbing, extract NewTechniqueForm, library button) — keep.**
- **Chunk C — keep C1/C2/C4; revise C3.** C3's standalone "add to global" switch is replaced by the scope-aware add (scope selector + popover). The student-only create backend stays.
- **Chunk D (technique tabs/ghost/sort/promote) — keep as planned.** Boolean `hidden_at` stays; no visibility refactor needed for techniques. 
- **Chunk E — rework** around: new video `parent_kind`s (T2 by (syllabus_id,technique_id), T3 by sst id), the single `video_visibility_overrides` table + resolver (migrating `student_syllabus_video_visibility`, folding in legacy `video_student_visibility`), the scope selector, the add switches, and the diff extension (techniques bucket split + video diff).

## Resolved decisions
- Snapshot + reconcile for techniques; minimal single-table inheritance for videos.
- Template edits: fan-out adds (opt-in, non-graduated, never overwrite); removals via diff.
- T2 videos are real content, anchored by (syllabus_id, technique_id), soft-handled on technique removal.
- Add-as-hidden kept — represented as `hidden_at` on a snapshot SST (techniques) or a `visible=0` override row (videos); both clean under this model.
- One video resolver shared by list + playback guard; legacy per-student video table folded in.

## Open items for planning
1. Exact migration of `student_syllabus_video_visibility` → `video_visibility_overrides` (assignment scope) and fold-in of `video_student_visibility`; backfill + cutover of the two read paths.
2. Orphan policy for T2 videos when a technique is removed from a syllabus (soft-delete vs reassign vs block).
3. `add_technique_to_assignment` change to honour explicit "add hidden" instead of always clearing `hidden_at`.
4. Diff `missing`-bucket split (absent vs added-hidden) + the new video diff rows/actions.
5. Whether the scope selector also appears on the syllabus-template editing view (likely yes, default "This syllabus").

---

## Second-Review Addendum (2026-06-16) — authoritative resolved decisions

A second clean-room review of the simplified design confirmed the technique/snapshot half is sound and flagged five video-side items. Resolutions:

1. **Decouple.** The technique work (Chunks A–D in the implementation plan) ships first as its own deliverable. This video subsystem is planned and built separately. Chunk E is REMOVED from the technique plan.

2. **Tier-2 video anchor = surrogate id.** Add `id INTEGER PRIMARY KEY` to `syllabus_techniques` (keep `(syllabus_id, technique_id)` as UNIQUE). T2 videos use a single-column parent (`parent_kind='syllabus_technique'`, `syllabus_technique_id`) — keeps `VideoParent`/`ParentColumns` uniform and gives a real FK so the orphan-on-removal case is enforceable by the DB (`ON DELETE` from the membership row), not by code convention. Accept the one-time table rebuild.

3. **Hiding a technique cascades to its inherited videos.** If a technique is hidden for a student (SST `hidden_at`), its inherited T1/T2 videos are neither listed nor directly playable for that student. The resolver therefore takes **SST/technique-in-assignment context**, and the playback guard must consult the owning technique's SST-hidden state.

4. **Visibility override table carries THREE scopes**, not two: `scope_kind ∈ {student, syllabus, assignment}`. `student` preserves the live per-student-global capability currently in `video_student_visibility` (used by library/pinned surfaces via `api_set_video_student_visibility` + `video-row.tsx`); `syllabus` and `assignment` replace `student_syllabus_video_visibility`. Both legacy tables migrate into this one. Migration must: map `(student,syllabus)→assignment_id` (total+unique via `syllabus_assignments`, but decide carry-vs-drop for soft-unassigned rows), and carry `video_student_visibility` rows as `student` scope (no fan-out, no loss).

5. **One resolver core, two entry points.** A single precedence ladder — `deleted > owning-SST-hidden > assignment override > syllabus override > student override > (owned-in-scope ? video.hidden_at IS NULL : not-a-candidate)` — exposed as: (a) a context-scoped list/`(video, sst)` path, and (b) a guard `video_visible_to_student_anywhere(video, student)` that returns true iff visible under *any* of the student's assignments (a global video is reachable from multiple syllabi). Both call the same core so the list and the guard can no longer diverge.

6. **Orphan enforcement point named:** `remove_technique_from_syllabus` (`db/syllabi.rs:325`) becomes video-aware — soft-handle or block when T2 videos exist on that `(syllabus, technique)`. The surrogate-id FK makes the DB-level guarantee possible.

7. **Hide provenance (technique diff, H4):** accepted as provenance-blind for v1 — `hidden_at` does not distinguish coach-hid / cascade-hid / added-as-hidden. Revisit only if the reconcile UI needs to explain *why* a row is hidden.

### Still to pin when this subsystem is planned
- Audit every existing `WHERE technique_id = ?` video query for T2/T3 leakage once `technique_id` is no longer T1-exclusive (notably the SST `video_count` subquery, `student_syllabus_techniques.rs:80`).
- Exact migration/backfill + cutover order for the two legacy visibility tables and the two read paths.
- Whether the scope selector also drives the syllabus-template editing view.
