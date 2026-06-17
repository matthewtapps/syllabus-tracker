# Camps C-Slice 2 — competitions + matches — plan

> Branch `feat/camps-comp-matches` (off `feat/camps-slice-1`). Each task: subagent implement → review → fix. Gate: `nix develop .#ci --command just verify` + pre-commit hook. No em-dashes, no `any`. Sqlx: declarative schema in `config/schema.sql`; regen via `just sqlx-prepare` (never bare). Tests: module `test_utils`, `#[rocket::async_test]`. Mirror the camps Slice 1 patterns throughout (they are the template).

**Spec:** `docs/superpowers/specs/2026-06-16-camps-epic-c-competitions-matches-footage-design.md` (C-Slice 2 sections).

---

### S2-1. Schema + permissions + migration test
- `config/schema.sql`: add `competitions`, `competition_registrations`, `matches`, `match_techniques` (per spec). Add `competition_id INTEGER REFERENCES competitions(id)` column to the `camps` CREATE TABLE (nullable; declarative migrator adds it). Add `'match'` to `videos.parent_kind` CHECK + `match_id INTEGER REFERENCES matches(id) ON DELETE CASCADE` + a CHECK branch `(parent_kind='match' AND match_id IS NOT NULL AND <all others NULL>)`; add `AND match_id IS NULL` to EVERY existing video branch (technique/student_profile/thread/loose/camp); `idx_videos_match`. Add `match_id` + `competition_id` ref columns to `activity` (`ON DELETE SET NULL`) + indexes.
- `auth/permissions.rs`: add `Permission::ManageCompetitions` to enum + COACH set.
- Test (`src/test/competitions.rs`, new; register in `test/mod.rs`): migrate; assert the 4 tables exist, `camps.competition_id` / `videos.match_id` / `activity.match_id` columns exist, and a `parent_kind='match'` video + a match row insert satisfy the CHECKs.
- Note: `matches` is a reserved-ish word in some SQL dialects but fine in SQLite; quote if the migrator complains.

### S2-2. VideoParent::Match
- `db/videos.rs`: add `VideoParent::Match(i64)` arm — `ParentColumns.match_id` field, `columns()` arms (add `match_id: None` to all existing incl camp, `Some(id)` for Match), `validate_parent` (match exists), and thread `match_id` through EVERY parent-column SQL site (`next_video_position`, both INSERTs, `list_videos_for_parent_global_visible`) + add `match_id AS "match_id?: i64"` to every `DbVideo` SELECT + `DbVideo`/`Video`/`From` (mirror how `camp_id` was added in Slice 1.5 A3). `list_videos_for_match(pool, match_id)` via the same alive+not-hidden predicate. Regen sqlx. Test: create_processing_video with `VideoParent::Match`.

### S2-3. db/competitions.rs
- `create_competition`, `get_competition`, `list_competitions`, `update_competition`; `register_student` (self or coach; clears `unregistered_at` on re-register), `unregister_student`, `list_registrations_for_competition` (roster, joins student + their competition-camp if any), `get_registration`, `registration_for(student, competition)`; `promote_camp_to_competition(camp_id, competition_id)` (sets `camps.competition_id`). Activity emission: `competition_created`, `student_registered`, `camp_promoted_to_competition` (target_student = the student where applicable). Types `Competition`, `Registration`, `RegistrationRosterRow`. Follow `db/camps.rs` structure exactly (tx + emit + NotFound handling + rows_affected guards on no-op).

### S2-4. db/matches.rs
- `Match` type (+ enums `MatchResult`, `MatchMethod` as string-mapped like other enums in the crate). `create_match`, `get_match`, `list_matches_for_registration`, `update_match`, `delete_match`; `link_match_technique`/`unlink_match_technique`/`list_match_techniques`; `list_matches_for_student` (aggregate across registrations, CC-031, returns match + competition name + camp link). Activity: `match_logged`, `match_technique_linked` (target_student = registration.student). `occurred_at` validated not-future at the handler. Authz helper `can_manage_match(actor, registration_student_id) = is_coach || actor == registration_student_id` (relationship-derived footage authz). Follow db/camps.rs patterns.

### S2-5. Routes + mount + match video upload
- `competitions/` module (routes per spec): competitions CRUD + register/unregister + roster; matches routes (create/list/update/delete + link/unlink technique + list-match-videos + my-matches). Gate competition admin by `ManageCompetitions`; gate match CRUD + match video upload by `can_manage_match` (coach or own student); promote-camp by `ManageCamps`. Map `AppError::NotFound`→404 (see camps/routes.rs). Add `api_match_video_upload` to videos/routes.rs (`VideoParent::Match`, gated by can_manage_match — needs the registration's student id; fetch it). Register modules in lib.rs; mount all routes in main.rs.
- Read auth: a student sees their own registrations/matches; coaches see all. Competition list/detail readable by any authed user (gym-wide); roster student-camp links coach-only detail.

### S2-6. Activity read + deep-link unions
- `activity.rs`: 5 new verbs (`competition_created`, `student_registered`, `camp_promoted_to_competition`, `match_logged`, `match_technique_linked`) — add to enum/ALL (bump count)/as_str/notifiable (registered+logged notifiable; technique_linked maybe; created is gym-wide—decide: keep non-target gym events out of student feeds by leaving target_student_id NULL for `competition_created`)/coalesces (non-coalescing)/primary_entity (new EntityKind::Match, EntityKind::Competition → None in find_coalesce_target). `NewActivity.match_id`/`.competition_id` fields + builders + emit INSERT + primary_entity_id.
- `activity_read.rs`: `ActivityRow.match_id`/`competition_id` + EVERY feed SELECT (student, coach, dashboard) + constructors.
- Frontend deep-links: `EntityRef` gains `{type:"competition"|"match"}`; `ViewContext` gains `{kind:"competition";competition}` → `/competitions/<id>` and `{kind:"match";student;match}` → `/student/<id>/matches?focus=match:<id>` (or the my-matches surface). `rowToViewContext` maps `context_kind='competition'|'match'`. `activity-line.ts describe()` arms for the 5 verbs. Unit tests in `view-context.unit.test.ts`/`activity-line.unit.test.ts`.

### S2-7. Frontend api + hooks
- `api.ts`: types `Competition`, `Registration`, `Match` (+result/method unions), `RosterRow`; fetchers for all S2-5 routes (throw Response on !ok). `query-keys.ts` + `queries.ts` (`useCompetitions`, `useCompetition`, `useRegistrationMatches`, `useStudentMatches`, `useMatchVideos`) + `mutations.ts` (`useCreateCompetition`, `useRegister`/`useUnregister`, `usePromoteCampToCompetition`, `useLogMatch`/`useUpdateMatch`/`useDeleteMatch`, `useLinkMatchTechnique`/`useUnlink`, `useUploadMatchVideo`). Match invalidation keys correctly.

### S2-8. Competitions list + detail (roster) pages
- `/competitions` (`app/competitions/page.tsx`): coach list + create dialog (reuse the create-dialog pattern). `/competitions/<id>` (`app/competitions/[id]/page.tsx`): name/date header, roster (registered students + quick link into each student's competition camp), coach register-others control. Student-facing: a register/unregister button. Routes in App.tsx (RequireAuth). Nav entry for coaches if there's a nav component (check navbar).

### S2-9. Promote + match logging on camp detail
- Camp detail page: if camp has no `competition_id`, a coach "Link to competition" control (pick existing / create) → `usePromoteCampToCompetition`. If it has one, show the competition name/date + a Matches section.
- Matches section (competition camps): list match cards (result/method/detail/occurred_at), "Log match" dialog (result W/L/D, method, detail, date) gated to coach or the camp's own student, match video upload (reuse the camp-video-list upload pattern pointed at the match route), and a coach "link techniques" control (CC-022) using the camp's techniques.

### S2-10. My matches view
- `/student/<id>/matches` (`app/student-matches/page.tsx`) + profile hub link "My matches" (Dumbbell or a medal icon). Reverse-chron matches across registrations: result/method, competition name, camp link, video playback (reuse video components), and existing threads on the footage (the `video_timestamp` thread surface). Auth: own student or coach. Honour `?focus=match:<id>`.

### S2-11. Tests + verify + PR
- Backend: `competitions.rs` tests (competition CRUD, register self vs coach, match CRUD authz: coach + own student can, other student 403; match video parent; match_techniques; my-matches aggregate). Frontend `.test.tsx` for the roster + my-matches pages (stub fetch). `just verify` green. Push; open PR targeting `main` (note it stacks on #76). PR body: what shipped + that Slices 3/4 follow.

## Sequencing
S2-1 → S2-2 → S2-3 → S2-4 → S2-5 → S2-6 (backend+FE unions) → S2-7 → S2-8/9/10 (FE pages) → S2-11. Commit per task; push after backend (S2-1..6) green, again after FE.
