# Camps — Slice 1 (generic camp spine) — design

**Date:** 2026-06-16
**Status:** Design approved; ready for `writing-plans`.
**Scope:** Generic camp only (no competition, no matches). First slice of the Camps/Competition epic (`docs/product/ongoing-use-stories.csv`, CC-*).
**Related:** `docs/product/ongoing-use-concepts.md` (Camps section); `../sillybus/docs/superpowers/specs/2026-06-16-video-tiers-and-propagation-design.md` (the video-ownership + single-resolver paradigm this slice must stay compatible with).

## Why this slice

A **camp** is the doc's central new concept: a stretch of intentional work between a coach and one student, with techniques, videos, and discussion attached. The polymorphic video parent (`videos.parent_kind`) and the threads anchor system were built anticipating exactly this (`db/videos.rs:14` already names "Camp and match parents"). This slice lands the generic-camp spine by extending those existing typed-column patterns, reusing the technique-row, thread, and video components, and adding no new UI primitives.

It is deliberately the smallest standalone-shippable unit: picking library techniques, camp-owned videos with global-hide visibility only, camp discussion threads, and archive. None of it depends on the in-flight video-tiers subsystem or the technique-snapshot (`is_global`) work — the coupling is forward-design only.

## Decisions locked during brainstorming

1. **Spec scope:** generic-camp Slice 1 only. Competitions, matches, scoped techniques, camp video visibility overrides, and the next-camp flow are named out-of-scope dependencies, not designed here.
2. **Permissions:** coach-only writes via a new `Permission::ManageCamps`. No blanket `SubmitFootage` flag.
3. **Footage authorization is relationship-derived** (see §4), replacing the CSV's flat `Permission::SubmitFootage` (CC-025). Slice 1 enforces only the coach branch.
4. **Video ownership = Approach A:** camp is a new owning tier (`parent_kind='camp'`), global-hide visibility only, no per-camp override rows. Forward-compatible with the future unified `video_visibility_overrides` resolver via a `scope_kind='camp'` seam.

## 1. Data model

Two new tables.

```sql
CREATE TABLE IF NOT EXISTS camps (
    id             INTEGER PRIMARY KEY,
    student_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    coach_id       INTEGER NOT NULL REFERENCES users (id),
    name           TEXT NOT NULL,
    description    TEXT,
    created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    archived_at    TIMESTAMP,
    archived_by_id INTEGER REFERENCES users (id)
    -- Intentionally NO competition_id and NO references_camp_id this slice.
    -- Both are nullable columns the declarative migrator can add later with
    -- zero rebuild cost when Slice 2 (competitions) / CC-030 (next-camp
    -- origin) arrive. Adding them now would be unused YAGNI surface.
);
CREATE INDEX IF NOT EXISTS idx_camps_student ON camps (student_id) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS camp_techniques (
    camp_id      INTEGER NOT NULL REFERENCES camps (id) ON DELETE CASCADE,
    technique_id INTEGER NOT NULL REFERENCES techniques (id) ON DELETE CASCADE,
    position     INTEGER NOT NULL DEFAULT 0,
    added_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    added_by_id  INTEGER REFERENCES users (id),
    PRIMARY KEY (camp_id, technique_id)
);
CREATE INDEX IF NOT EXISTS idx_camp_techniques_position ON camp_techniques (camp_id, position);
```

`camp_techniques` is membership, not a snapshot copy: it references existing global library techniques (CC-008). This is consistent with the video-tiers paradigm's "no live inheritance for techniques" and with CC-035/CC-037's "link, not copy" rule for cross-camp references.

## 2. Polymorphic-parent extension

The cheap, pre-designed seam. Each change mirrors an existing typed-column pattern exactly.

### videos
- `parent_kind` CHECK gains `'camp'`.
- New column `camp_id INTEGER REFERENCES camps (id) ON DELETE CASCADE`.
- New CHECK branch:
  `(parent_kind='camp' AND camp_id IS NOT NULL AND technique_id IS NULL AND student_id IS NULL AND thread_id IS NULL)`.
- `db/videos.rs`: add `VideoParent::Camp(i64)` arm — `ParentColumns` mapping, existence check (`SELECT 1 FROM camps WHERE id = ?`).
- `CREATE INDEX idx_videos_camp ON videos (camp_id) WHERE deleted_at IS NULL`.

### threads
- `anchor_kind` CHECK gains `'camp'`.
- New column `camp_id INTEGER REFERENCES camps (id) ON DELETE CASCADE`.
- New CHECK branch:
  `(anchor_kind='camp' AND camp_id IS NOT NULL AND student_id IS NULL AND technique_id IS NULL AND video_id IS NULL AND video_ts_seconds IS NULL AND sst_id IS NULL)`.
- `AnchorKind::Camp` + `validate_anchor` existence check.
- **Visibility falls out for free:** the existing `threads` CHECK forces `visibility='private'` for any `anchor_kind` not in `('technique','video','video_timestamp')`. `camp` is not in that set, so camp threads are necessarily private and require `scope_student_id`. The create route sets `scope_student_id = camp.student_id`, giving "visible to that student + all coaches" with no new visibility logic (matches CC-023/024 and the concepts doc's "comments on a camp thread: visible to that student and to any coach").
- `CREATE INDEX idx_threads_camp ON threads (camp_id) WHERE deleted_at IS NULL`.

### activity
- New ref column `camp_id INTEGER REFERENCES camps (id) ON DELETE SET NULL` + `idx_activity_camp`.
- New verbs: `camp_created`, `camp_technique_added`, `camp_archived`.
- `video_added` and `thread_comment_posted` emitted in a camp context carry `context_kind='camp'` and `camp_id`.
- **Every camp activity row sets `target_student_id = camp.student_id`** and `actor_user_id` = the acting coach.

These two columns are what make camp activity respect viewer context and deep-link correctly — see §2a. This is not new infrastructure; it is the same wiring syllabus activity already uses.

## 2a. Activity: viewer context + deep-linking (mirrors syllabus)

Camp activity must behave exactly like syllabus activity on two axes: **who sees it** and **where a click lands**. Both reuse existing seams; the requirement is to populate and extend them, not invent new ones.

### Who sees it (viewer scoping)
The feed predicate already scopes per viewer (`db/activity_read.rs:510`): a student sees rows where `target_student_id = self`; a coach/admin sees all (minus their own actions). Because every camp row sets `target_student_id = camp.student_id` (§2), camp activity is **automatically** visible only to that camp's student + coaches — the same scoping as the camp thread (`scope_student_id`, §2) and as syllabus activity. No new visibility branch is added; the requirement is purely that the emit path sets `target_student_id`.

### Where a click lands (typed deep-linking)
Deep links are typed, never inferred from which FK is non-null (`docs/superpowers/specs/2026-06-11-activity-deep-linking-and-dashboard-uplift-design.md`). Camp rows join that model by extending the two closed unions and the resolver:

- **`EntityRef`** (`frontend/src/lib/entity-ref.ts`): add `{ type: "camp"; id: number }` + its `ENTITY_TYPE_LOOKUP` entry (the lookup is exhaustively keyed, so omitting it is a compile error).
- **`ViewContext`** (`frontend/src/lib/view-context.ts`): add a `{ kind: "camp"; camp: EntityRef; video?: EntityRef }` arm. The `viewContextHref` switch then fails to compile until the camp route is added: `/camps/<id>?focus=<token>` (`&video=<id>` when a video is in context), matching the `library`/`syllabus` arms.
- **`rowToViewContext`** (`view-context.ts`): when `context_kind === 'camp'` and `camp_id` is present, build the camp `ViewContext`. The three new verbs (`camp_created`, `camp_technique_added`, `camp_archived`) resolve to the camp surface focused on the camp (or the camp technique); camp-context `video_added` / `thread_comment_posted` resolve to the camp focused on the video/thread. `ViewContextRow` gains a `camp_id` field.
- **`activity-line.ts` `describe()`**: add arms for the three new verbs; the camp-context `video_added` / `thread_comment_posted` arms reuse `rowToViewContext` exactly like their syllabus counterparts (including the `&thread=` suffix path already present for `thread_comment_posted`).
- **`ActivityRow`** (backend `api.rs` serializer + the frontend row type): add `camp_id`, alongside the existing `syllabus_id` / `sst_id` / `technique_id` / `video_id` columns.

### The landing surface consumes `focus`
The camp detail page (`app/camps/[id]/page.tsx`, §6) must parse the `focus=<type>:<id>` token and expand/scroll/highlight the targeted camp technique or video, the same contract the student-syllabus and library pages already honour. A camp link that lands on the page but doesn't focus its subject is a bug, not a nice-to-have.

## 3. Ownership + visibility (Approach A)

Camp videos are owned at exactly one tier: `parent_kind='camp'`. This obeys the video-tiers spec's "a video is owned at exactly one tier" rule.

- **Read filter (Slice 1):** `deleted_at IS NULL AND hidden_at IS NULL`. Coaches still see globally-hidden videos, badged "Hidden", as everywhere else.
- **No per-camp override rows exist in Slice 1.** CC-015 (per-camp video visibility) is deferred to the video-tiers subsystem.
- **Single resolver entry point:** camp video reads route through one small helper, `effective_camp_video_visible(video, viewer)`, even though today it only checks global hide. This keeps the future override rung in one place.

### Forward-compatibility seam (not built now)
When the unified `video_visibility_overrides(scope_kind, scope_id, video_id, visible, ...)` table from the video-tiers spec lands, camp visibility becomes one more `scope_kind='camp'` (`scope_id = camp_id`) rung in that spec's shared precedence ladder. Because Slice 1 writes **zero** override rows and reads through the single helper, there is nothing to migrate and one function to extend. Slice 1 must not build a parallel `camp_video_visibility` table (explicitly rejected: it would recreate the divergent-read-path problem the video-tiers spec exists to kill).

### Promote rule (stated for later slices, not built now)
Promoting a camp-owned video up to its global technique (CC-018) = **flip `parent_kind` in place**, preserving `video.id` so watch history/aggregates stay intact, and delete any now-meaningless lower-scope override rows in the same transaction. This is the video-tiers spec's promote rule; later camp slices follow it verbatim. Slice 1 does not implement promotion — camp videos stay camp-owned.

## 4. Footage authorization model

Replaces the CSV's flat `Permission::SubmitFootage` (CC-025) with relationship-derived authorization. Rationale: the storage/abuse concern the concepts doc raises is specifically the *unscoped* direct-to-profile upload; scoped uploads are self-limiting because a coach created the relationship.

`can_attach_video(actor, target)`:
- **coach** ⇒ has `Permission::ManageCamps` (camp target) / existing upload perms (other targets).
- **student** ⇒ one of:
  - `target = camp` AND `camp.student_id == actor` (assigned the camp ⇒ may submit to it).
  - `target = syllabus / sst` AND the student has an active assignment for it.
  - `target = own profile` AND the student holds the residual one-off **profile-submit gate** — the only case needing an explicit grant, because there is no assignment relationship to lean on.

So `SubmitFootage` does not vanish; it *shrinks* to mean only "may upload directly to own profile."

**Slice 1 enforcement:** only the coach branch is wired for camp uploads. The student branches and the profile gate are specified here so later slices implement them consistently, but are flagged **not-built** in Slice 1.

## 5. Backend

New `camps/` route module + `db/camps.rs`, following the existing `threads/` and `syllabi/` module shape. All write routes gated by `Permission::ManageCamps`.

| Method + path | Story | Auth |
|---|---|---|
| `POST /api/camps` (`{student_id, name, description}`) | CC-001 | ManageCamps |
| `GET /api/camps?student_id=` | CC-027/028 (list) | coach: any; student: self only |
| `GET /api/camps/<id>` | — | coach: any; student: own camp only |
| `PUT /api/camps/<id>` (`{name, description}`) | CC-001 | ManageCamps |
| `POST /api/camps/<id>/archive` | CC-029 | ManageCamps |
| `POST /api/camps/<id>/techniques` (`{technique_id}`) | CC-008 | ManageCamps |
| `DELETE /api/camps/<id>/techniques/<tid>` | CC-008 | ManageCamps |
| `POST /api/camps/<id>/videos` | CC-016 | ManageCamps (coach branch only this slice) |

- Camp video upload reuses the existing upload pipeline with `VideoParent::Camp`.
- Camp discussion uses the **existing** `/threads` + `/threads/<id>/comments` routes with `anchor_kind=camp`; the thread-create path sets `scope_student_id = camp.student_id` (§2).
- Read authorization: a student may read only camps where `camp.student_id == self`; a coach reads all (`ViewAllStudents`).

### Permission
Add `Permission::ManageCamps` to the enum (`auth/permissions.rs`), granted to `COACH_PERMISSIONS` (and inherited by admin).

## 6. Frontend

Reuses existing components; no new primitives.

- `app/camps/[id]/page.tsx` — camp detail: header (name, description, student, archived badge), camp-techniques list (reuse `components/technique-row/`), camp videos (reuse `components/videos/` player/grid), camp discussion (reuse `components/threads/thread-view` with `anchor_kind=camp`). **Consumes the `focus=<type>:<id>` token** (expand/scroll/highlight) per §2a, same contract as the syllabus/library pages.
- Deep-link plumbing: extend `EntityRef`, `ViewContext` + `viewContextHref`, `rowToViewContext`/`ViewContextRow`, and `activity-line.ts` for camp (§2a).
- `app/student-camps/page.tsx` — a student's camps, active and archived sections.
- **Camps tab** added to `app/student-profile/page.tsx`, alongside Activity / Syllabi / Pinned.
- Coach affordances: create-camp dialog, add-technique via the existing library technique picker, video upload via the existing upload flow.

## 7. Out of scope (named dependencies)

Not designed here; each gets its own later slice/spec:

- **Competitions, registrations, matches, match analysis** (CC-002..007, CC-020..022) — Slice 2.
- **Scoped camp techniques** (CC-009/010/011/012) — depend on the technique-snapshot branch landing `techniques.is_global`; a camp-scoped technique = a non-global technique owned by a camp.
- **Per-camp video visibility** (CC-015) — depends on the unified `video_visibility_overrides` table + shared resolver from the video-tiers spec.
- **CC-018 upload scope radio**, **student footage upload + profile-submit gate**, **CC-030 next-camp origin link**, **CC-035/036 cross-camp references**, **rank (CX-001/002)**, **notifications, @-mentions, reactions** — later.

## 8. Testing + delivery

- Backend: `crates/syllabus-tracker/src/test/camps.rs`, mirroring `test/threads.rs` and `test/videos.rs` (creation, technique add/remove, video attach via `VideoParent::Camp`, camp thread scoping, archive, student/coach read auth). Include an **activity-emission test**: camp verbs land with `target_student_id = camp.student_id` + `context_kind='camp'` + `camp_id`, and the camp's student sees the row in their feed while another student does not (mirror `test/activity.rs`).
- Frontend deep-link tests: `rowToViewContext` resolves camp rows to `/camps/<id>?focus=…` and `parseFocusToken`/`viewContextHref` round-trip the `camp` `EntityRef` (extend the existing `view-context`/`activity-line` unit tests).
- Frontend: `.test.tsx` runs in Chromium (CI only). Stub `window.fetch`; use `renderWithProviders` + `buildUser` (do not `vi.spyOn` ESM exports).
- Migration: extend `config/schema.sql` + the declarative migration engine; the migrator tolerates pre-existing FK dirt and only fails on violations a migration introduces.
- Gate: offline build (`SQLX_OFFLINE`) + `nix develop .#ci` lint/test. `sqlx-check` is intentionally dropped from CI. Regenerate query cache via `nix develop .#ci --command just sqlx-prepare` (never bare `cargo sqlx prepare` on the seeded dev DB).
- Branch off `main` after verifying base vs `origin/main` (main takes PRs again as of 2026-06-16).

## Open items for the plan

1. Whether camp video upload should be blocked on archived camps (lean: yes, reject uploads to `archived_at IS NOT NULL`) — decide in the plan.
2. Camp-technique ordering UX (drag-reorder vs append-only) — append-only acceptable for Slice 1; reorder can follow.
3. Whether the Camps tab shows a coach a per-student create entry point or routes through a roster-level "new camp" action — UI placement, plan-time call.
