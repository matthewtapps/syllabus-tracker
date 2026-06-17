# Camps C-Slice 3 — footage review + next-camp + pinned→camp — plan

> Branch `feat/camps-footage-nextcamp` (off `feat/camps-comp-matches`). Each task: subagent implement → review → fix. Gate: `nix develop .#ci --command just verify` + pre-commit hook. No em-dashes, no `any`. Declarative schema in `config/schema.sql`; `just sqlx-prepare` (never bare). Mirror the camps/competitions patterns. Spec: `docs/superpowers/specs/2026-06-16-camps-epic-c-competitions-matches-footage-design.md` (C-Slice 3 section).

---

### S3-1. Technique-suggestion queue — schema + db + activity (CC-033/034)
- `config/schema.sql`: `technique_suggestions(id, student_id FK users, technique_id FK techniques, anchor_video_id FK videos NULL, anchor_seconds INTEGER NULL, status TEXT CHECK IN ('pending','approved','replaced','dismissed') DEFAULT 'pending', created_at, decided_by_id NULL, decided_at NULL, replacement_technique_id NULL FK techniques, decided_camp_id NULL FK camps)`. Index on `(status, created_at)` and `(student_id)`.
- `activity`: new verbs `technique_suggested`, `suggestion_decided` (add to Verb enum + ALL count + as_str + notifiable + coalesces=false + primary_entity → reuse EntityKind::Technique). No new ref column needed (use technique_id + target_student_id + payload for status). Add a `suggestion_id`? Prefer payload_json `{suggestion_id, status, ...}` to avoid a new activity column; technique_id carries the deep-link.
- `db/suggestions.rs`: `create_suggestion(student_id, technique_id, anchor_video_id, anchor_seconds)` (student action; emit `technique_suggested` target_student=student); `list_pending_suggestions()` (coach queue, join student + technique names + anchor video); `list_suggestions_for_student(student_id)`; `decide_suggestion(id, decider_id, decision: approve{camp_id}|replace{technique_id, camp_id}|dismiss)` → set status + decided_*; on approve/replace, call `db::camps::add_camp_technique(chosen_camp, technique_or_replacement, decider)`; emit `suggestion_decided`. Mirror db/camps.rs structure.
- Tests: create suggestion; list pending; approve adds to camp + sets status; replace uses replacement technique; dismiss; emits.

### S3-2. Suggestion routes + coach-queue surfacing
- Routes (new `suggestions/` module or fold into competitions/matches — keep cohesive; suggestions are footage-review so a `suggestions` module is fine): `POST /api/suggestions` {technique_id, anchor_video_id?, anchor_seconds?} (any student, for themselves — student_id=user.id); `GET /api/suggestions/pending` (coach, ManageCamps); `GET /api/students/<id>/suggestions` (own or coach); `POST /api/suggestions/<id>/decide` {decision, camp_id?, replacement_technique_id?} (coach, ManageCamps). Mount.
- Coach dashboard: the suggestion queue should surface alongside existing coach dashboard queues (reset requests / pending approvals). Find the coach dashboard queue component; add a "Technique suggestions" section reading `GET /api/suggestions/pending` with approve/replace/dismiss actions (approve/replace need a camp picker for that student). If the dashboard queue area is complex, a dedicated `/suggestions` coach page is an acceptable alternative — but prefer integrating into the dashboard.

### S3-3. Flag-a-moment on my-matches footage (CC-032)
- The video player already supports timestamp threads (`video_timestamp` anchor) and students can create private-scoped threads on videos via the existing thread route. On the my-matches playback (and match video playback generally), surface:
  (a) a "flag this moment" affordance that starts a `video_timestamp` thread at the current playback time (student-initiated, scoped to self) — likely already available via the video viewer's comment UI; verify and ensure it's reachable for the student on their OWN match footage. If the viewer already exposes timestamp-thread creation, this is mostly wiring/verification + a test.
  (b) a "suggest a technique" affordance from the footage that opens a library-technique picker → `POST /api/suggestions` with anchor_video_id + anchor_seconds (ties S3-1/2 to the footage moment).
- Frontend api/hooks for suggestions: `useCreateSuggestion`, `usePendingSuggestions`, `useDecideSuggestion`, `useStudentSuggestions`.

### S3-4. Next-camp references (CC-030/035/036)
- `config/schema.sql`: `camps.references_camp_id INTEGER REFERENCES camps(id)` (nullable; "builds on" origin). Link tables: `camp_referenced_matches(camp_id, match_id, PK both)`, `camp_referenced_threads(camp_id, thread_id, PK both)`, `camp_technique_referenced_videos(camp_id, technique_id, video_id, PK all three)` (footage-as-first-class on a camp technique). All link, not copy.
- `db/camps.rs`: extend `create_camp` (or a new fn) to accept `references_camp_id` + lists of referenced match/thread ids to link; `list_camp_references(camp_id)` returning the referenced matches/threads/videos. `add_camp` payload/route extended.
- Camp creation UI (the create-camp dialog on the student profile): add an optional "Seed from previous camp" picker — pick a prior (archived or active) camp of the same student; optionally select which of its matches/threads/techniques to reference. Keep the picker lean: at minimum reference the previous camp (`references_camp_id`) + show "builds on <previous camp>" on the new camp detail with a link. Referencing specific matches/threads/videos can be a follow-up if the picker balloons — but wire references_camp_id + the "builds on" link end to end.
- Camp detail: show "Builds on <previous camp>" link when references_camp_id set; a "Referenced footage/matches" section listing linked items (read-only links into their original context).

### S3-5. Pinned→camp promotion (CC-037)
- Coach action: promote a student's pinned technique into one of their camps. `db`: a fn `promote_pinned_to_camp(student_id, technique_id, camp_id, by_id)` = `add_camp_technique(camp_id, technique_id, by_id)` (notes are already shared by (student, technique); thread/comment linking is a design question — default link, but for Slice 3 just add the technique to the camp; the shared (student,technique) notes surface automatically). Optionally auto-unpin (coach's choice) — default keep pinned.
- Route `POST /api/students/<id>/pinned/<technique_id>/promote` {camp_id} (ManageCamps). UI: on the student pinned page (`app/student-pinned/page.tsx`), a coach-only "Add to camp" action per pinned technique → camp picker (the student's camps) → promote.

### S3-6. Tests + verify + PR
- Backend tests for suggestions + references + pinned-promote. Frontend page/flow tests where practical. `just verify` green. Push; open PR targeting main (stacked on #76/#77). PR body: footage-review + next-camp + pinned→camp; note Slice 4 (video-tiers-dependent) remains.

## Sequencing
S3-1 → S3-2 (suggestions backend+coach queue) → S3-3 (footage affordances + FE suggestion hooks) → S3-4 (next-camp) → S3-5 (pinned→camp) → S3-6. Commit per task.

## Scope discipline
If a piece balloons (e.g. the seed-from-previous picker with granular match/thread selection, or deep dashboard-queue integration), ship the core (references_camp_id + builds-on link; suggestion create+decide+queue) and leave the granular extras as documented follow-ups rather than half-building. Prefer working end-to-end slices over breadth.
