# Camps Epic C — competitions, matches, footage review, next-camp — design

**Date:** 2026-06-16
**Status:** Design (autonomous). Builds on the shipped camps spine (PR #76, `feat/camps-slice-1`). Branch `feat/camps-comp-matches` forks off it.
**Sources:** `docs/product/ongoing-use-concepts.md` (Camps/Matches/Footage sections), `docs/product/ongoing-use-stories.csv` (CC-002..037), and the shipped `docs/superpowers/specs/2026-06-16-camps-slice-1-design.md`.

## Scope + decomposition

Epic C is large (~25 stories). It decomposes into three implementation slices, each its own plan; this branch implements **C-Slice 2** first.

- **C-Slice 2 — Competitions + Matches** (this branch/PR; fully unblocked): competition entity, registration, per-competition page, promote camp→competition camp, match logging, match video (`VideoParent::Match`), match→technique analysis, "my matches" aggregate view.
- **C-Slice 3 — Footage review + next-camp** (unblocked; next plan): technique-suggestion queue, student threads on own match footage, next-camp references (`references_camp_id`, seed-from-previous, footage-as-first-class), pinned→camp promotion.
- **C-Slice 4 — video-tiers-dependent** (blocked until `feat/video-tiers-propagation` (#75) + `feat/syllabus-modification-ux` (#74) merge into this line): scoped camp techniques (CC-009/010/011/012/014, needs `techniques.is_global`), per-camp video visibility (CC-015, needs the unified `video_visibility_overrides` resolver), CC-018 upload-scope choice. Merge those branches in before building this slice.

## Privacy stance (carried from the concepts doc)
No opponent information of any kind: a match is "won by armbar", never against whom or where. No new PII. Match logging is minimal.

---

## C-Slice 2 — data model

```sql
-- Gym-wide competition. Coach creates; students register.
CREATE TABLE competitions (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    date          DATE,                 -- nullable: TBD-date comps allowed
    created_by_id INTEGER NOT NULL REFERENCES users(id),
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- A (student, competition) enrolment. registered_by_id captures actor
-- (self vs coach). Soft-unregister via unregistered_at so a re-register keeps
-- match history (UNIQUE(student_id, competition_id) clears it, mirrors
-- syllabus_assignments).
CREATE TABLE competition_registrations (
    id              INTEGER PRIMARY KEY,
    student_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    competition_id  INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    registered_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    registered_by_id INTEGER REFERENCES users(id),
    unregistered_at TIMESTAMP,
    UNIQUE (student_id, competition_id)
);

-- camps gains the (already-reserved) competition link. A "competition camp"
-- is a camp with competition_id set. Promote = set it.
ALTER camps ADD competition_id INTEGER REFERENCES competitions(id);  -- declarative: add the nullable column to the camps CREATE TABLE.

-- A logged match within a registration. No opponent fields by design.
CREATE TABLE matches (
    id             INTEGER PRIMARY KEY,
    registration_id INTEGER NOT NULL REFERENCES competition_registrations(id) ON DELETE CASCADE,
    result         TEXT NOT NULL CHECK (result IN ('win','loss','draw')),
    method         TEXT CHECK (method IN ('submission','points','decision','dq','other')),
    method_detail  TEXT,                 -- free text e.g. "kimura from north-south"
    occurred_at    TIMESTAMP,            -- client-supplied, validated not-future
    created_by_id  INTEGER NOT NULL REFERENCES users(id),
    created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Many-to-many: attach (camp) techniques to a match as post-comp analysis.
-- Keyed by technique (the match's registration resolves the student/camp
-- context); a technique can link to many matches and vice versa.
CREATE TABLE match_techniques (
    match_id     INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    technique_id INTEGER NOT NULL REFERENCES techniques(id) ON DELETE CASCADE,
    added_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    added_by_id  INTEGER REFERENCES users(id),
    PRIMARY KEY (match_id, technique_id)
);
```

### Polymorphic extension (mirrors the camp pattern exactly)
- `videos.parent_kind` gains `'match'` + `match_id` column + CHECK branch + `idx_videos_match`; `VideoParent::Match(i64)` arm (existence check: match exists). All existing branches gain `AND match_id IS NULL` (and the camp branch too).
- `threads.anchor_kind` already has `'video'`/`'video_timestamp'` which cover threads on match videos (CC-023/032) — no new thread anchor needed. (A thread on a match itself, not a video, is not required by the stories; skip.)
- `activity`: add `match_id` + `competition_id` ref columns (`ON DELETE SET NULL`) + indexes; new verbs `competition_created`, `student_registered`, `camp_promoted_to_competition`, `match_logged`, `match_technique_linked`. Carry `context_kind='match'` / `'competition'` where the feed should deep-link there. Match/registration activity sets `target_student_id = registration.student_id` so the per-viewer feed scoping applies (same as camps).

### Authorization
- New `Permission::ManageCompetitions` (coach+admin) for competition create + registering others + per-comp admin. Reuse `ManageCamps` for promote-camp-to-competition.
- **Match logging** is the relationship-derived footage model in action: a match belongs to a registration → its student. **Coach OR the registration's own student** may create/edit/delete matches and upload match video on their own registration (concepts doc + CC-020/021 say students self-record). This is the first place the relationship-derived footage authz (specced in Slice 1 §4) is actually wired for students.
- Student self-register (CC-005); coach register/unregister others (CC-006) via `ManageCompetitions`.

### Backend routes
- `POST /api/competitions` (ManageCompetitions), `GET /api/competitions`, `GET /api/competitions/<id>` (+ roster, CC-007), `PUT /api/competitions/<id>`.
- `POST /api/competitions/<id>/register` (student self), `POST /api/competitions/<id>/register/<student_id>` (coach), `DELETE …/register/<student_id>` (coach unregister).
- `PUT /api/camps/<id>` extended (or `POST /api/camps/<id>/promote`) to set `competition_id` (CC-002/003), ManageCamps.
- `POST /api/registrations/<id>/matches` (coach or own student), `GET /api/registrations/<id>/matches`, `PUT/DELETE /api/matches/<id>`.
- `POST /api/matches/<id>/videos/upload` (`VideoParent::Match`, coach or own student); `GET /api/matches/<id>/videos`.
- `POST /api/matches/<id>/techniques` + `DELETE …/techniques/<tid>` (CC-022, coach).
- `GET /api/students/<id>/matches` ("my matches" aggregate, CC-031).

### Frontend
- `/competitions` list + `/competitions/<id>` page (roster + per-student camp links) — coach surface.
- Student registration affordance (register button on a competition; coach register-others on the roster page).
- Promote-camp-to-competition control on the camp detail page (pick/create a competition).
- Match logging UI on the camp detail page (competition camps) + match cards (result/method/detail), match video upload, link-techniques control.
- **"My matches"** tab/route on the student profile (`/student/<id>/matches`): reverse-chron matches across all registrations with result/method, camp link, video playback, existing threads.

### Tests + delivery
Backend `src/test/competitions.rs` + extend `camps.rs`/`videos.rs`. Frontend `.test.tsx` (CI). Gate `just verify`. Stay on `feat/camps-comp-matches`; PR targets `main` (stacked on #76 until it merges; rebase after).

---

## C-Slice 3 — footage review + next-camp (design outline; own plan)
- `technique_suggestions(id, student_id, technique_id, anchor_video_id, anchor_seconds, status, created_at, decided_by_id, decided_at, replacement_technique_id)`; coach queue on the dashboard; approve→`add_camp_technique` into a chosen camp (CC-033/034).
- Student threads on own match footage: already works via `video_timestamp` anchor + existing route (student private-scoped). Surface a "flag this moment" affordance on the my-matches playback (CC-032).
- Next-camp: `camps.references_camp_id` (add nullable FK); new-camp "seed from previous camp" picker linking historical matches/threads/techniques (`camp_referenced_matches`, `camp_referenced_threads`, `camp_technique_referenced_videos` link tables) — link, not copy (CC-030/035/036).
- Pinned→camp promotion (CC-037): `add_camp_technique` from a pinned technique, linking its thread/notes context.

## C-Slice 4 — video-tiers-dependent (blocked; own plan after merge)
- Merge `feat/video-tiers-propagation` (+ its base `feat/syllabus-modification-ux`) into this line.
- Scoped camp techniques on `is_global=false` owned by a camp (CC-009/010/011/012/014).
- Per-camp video visibility as `video_visibility_overrides scope_kind='camp'` (CC-015) — the resolver seam (`effective_camp_video_visible`) already exists from Slice 1.5 A3.
- CC-018 upload-scope choice (camp vs global technique).

## Resolved decisions (autonomous)
- Matches are keyed to a **registration**, not directly to a camp: a student can compete without a camp, and one competition camp maps to one registration. Match→camp link is via `registration → (student, competition) → camp.competition_id`.
- No opponent data, ever.
- Student self-recording of matches + match footage is the first wired use of relationship-derived footage authz.
- `competition_id` on camps is the promote mechanism (no separate "competition camp" table).
- Match analysis links plain `technique_id` (not a camp_technique surrogate) — simplest, and a technique's camp context is recoverable via the registration.
