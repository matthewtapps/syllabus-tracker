# Threads & Comments — design spec

Status: approved design, pre-implementation
Date: 2026-06-12
Supersedes: the thread/comment schema and feed-integration approach described in
`docs/product/implementation-plan.md` milestones M13–M16 (see "Relationship to the
committed plan" below). All other aspects of M13–M16 remain aligned.

## 1. Context and goal

Sillybus is moving from a finite "manifest" (assign a syllabus, mark techniques
green, graduate) to an ongoing-use "workspace". A core part of that is
**conversation**: threads and comments that attach to the things a coach and
student already work with.

This epic introduces a conversation primitive (a thread plus replies) that
attaches to every surface that exists today, renders into the existing activity
feed, and is designed so future surfaces (camps, matches, match videos) extend it
additively. It is **text-first**: video replies are deferred (see Out of scope).

Product framing: `docs/product/ongoing-use-concepts.md`. Stories: CX-006, CX-007,
CX-010, CX-022, SD-008, SD-010, SD-011, SD-012 (and forward-looking CC-023,
CC-024, CC-032).

### Scope of surfaces (Phase A)

Threads attach to all of: a student **profile**, a library **technique**, a
library **video** (whole), a library video **at a timestamp**, a **per-student
syllabus technique**, and a **pinned technique**. Future, designed-for but not
built: camps, matches, match videos.

## 2. How this design was reached

The design was triangulated across three independent inputs:

- an industry/reference-project survey (Discourse, Mastodon, Lemmy, GitLab notes,
  Rails `acts_as_commentable`, Django contenttypes, Forem);
- a codebase-grounded first-principles design (blind to the committed plan);
- the committed M13–M16 plan.

All three converged on: two tables, adjacency-list replies, a thread-level
`private | broadcast` visibility enum with replies inheriting, `video_timestamp`
as its own anchor kind with a separate seconds offset, and soft-delete that keeps
the row. Those are settled and not revisited here.

They diverged on one load-bearing decision — **how a thread stores what it is
anchored to** — resolved below in favour of typed columns.

## 3. Decisions and rationale

| # | Decision | Choice | Why |
|---|----------|--------|-----|
| D1 | Table shape | **Two tables**: `threads` + `thread_comments` | Unanimous across all three inputs. Splits the anchored root (carries anchor + visibility once) from lean replies. |
| D2 | Anchor storage | **Typed FK columns + `anchor_kind` enum** (not polymorphic `parent_kind`/`parent_id`) | The existing `activity` table and the frontend `view-context.ts`/`entity-ref.ts` deep-link layer are already typed, closed, compiler-checked unions. Threads integrate through both. Typed columns keep one uniform pattern, real FKs + `ON DELETE`, and sqlx compile-time join typing. Polymorphic is a dynamic-language pattern (Rails/Django/Laravel) that compensates for *absent* static typing; importing it into a Rust+sqlx+TS-discriminated-union stack throws away the stack's core guarantee. Our anchor kinds are a closed, developer-curated taxonomy (not user-generated), which is exactly where typed unions win. GitLab — the canonical polymorphic example — tells its own engineers not to use it. |
| D3 | Reply nesting | **Adjacency list** via `parent_comment_id`, rendered **flat (one level)** in Phase A | Unanimous. The column supports deeper nesting if the one-level rule later relaxes; depth is enforced in the handler, not the DDL. No materialized path / closure table (not needed; not portable to SQLite). |
| D4 | Visibility | Enum **on the thread** (`private` \| `broadcast`); replies inherit | Unanimous. `private` names a `scope_student_id` (visible to that student + all coaches). `broadcast` derives visibility from the parent entity's own ACL (no participant list). |
| D5 | Syllabus-context anchor | **`sst_id`** (a `student_syllabus_techniques` row) | A technique can belong to multiple syllabi assigned to one student, so `(student, technique)` is ambiguous; the SST row is the unique per-`(assignment, technique)` anchor and is already what `activity.sst_id` and `EntityRef.sst` use. |
| D6 | Video-thread visibility | **Global / library-scoped** (`videos.hidden_at IS NULL`) | The current `video_visible_to_student` predicate is context-blind (consults only the legacy per-student table, not the per-syllabus override the live read path uses). A thread is global to a video, so there is no single per-syllabus "can see" answer. Scoping video threads to global visibility sidesteps this and removes a Phase-A dependency on the F1/CX-019 refactor. |
| D7 | Feed mechanism | `activity` gains a typed `thread_id` column + `EntityKind::Thread` + a **non-coalescing** `ThreadCommentPosted` verb | Follows from D2 (typed). The 30s coalesce window would merge consecutive replies and drop payloads, so thread verbs opt out of coalescing. |
| D8 | Broadcast → feed | **Coach-feed-only** (no student-feed fanout) | Avoids the N-rows-per-comment write amplification all three inputs flagged. SD-012 is still satisfied: the broadcast renders on the parent's comment rail for every student who can see it. Student-facing pings are the notifications system's job (deferred). |
| D9 | Ancestry / contextual tile | **Resolve on read** by walking per-kind `parent_of` edges; nothing ancestral stored on `activity` | The full context chain (comment → timestamp → video → match → camp) is the resolved `context_path`, a bounded ~5-hop walk, trivial at gym scale, always correct, no denormalization rot. A denormalized root-container id is added later only when camps exist and container-scoped feed filtering (CX-004) needs it. |
| D10 | Shared vocabulary | One `EntityKind` (Rust) + `EntityRef` (TS) used by `activity`, `threads`, deep-links, and the `parent_of` ancestry graph | Makes "add an anchor kind" a single canonical definition the compiler fans out, keeping every static guarantee while reducing per-kind churn. |

## 4. Data model

`video_ts_seconds` is a plain integer offset (seconds into the video), **not** a
foreign key. The foreign-key anchor columns are `student_id`, `technique_id`,
`video_id`, `sst_id`.

```sql
CREATE TABLE IF NOT EXISTS threads (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body            TEXT NOT NULL,      -- the root post; thread_comments are replies only

    -- Closed anchor taxonomy. Extends to 'camp','match','match_video' later by
    -- adding a value + an FK column + a shape-CHECK arm, in lockstep with the
    -- shared EntityKind enum and the frontend EntityRef union (D2, D10).
    anchor_kind     TEXT NOT NULL CHECK (anchor_kind IN (
                        'student_profile','technique','video',
                        'video_timestamp','sst','pinned_technique')),

    -- Typed FK anchor columns. Exactly the columns for the anchor_kind are
    -- populated; the shape CHECK enforces it.
    student_id      INTEGER REFERENCES users(id)                       ON DELETE CASCADE,
    technique_id    INTEGER REFERENCES techniques(id)                  ON DELETE CASCADE,
    video_id        INTEGER REFERENCES videos(id)                      ON DELETE CASCADE,
    video_ts_seconds INTEGER,   -- NOT a FK; offset in seconds; set iff anchor_kind='video_timestamp'
    sst_id          INTEGER REFERENCES student_syllabus_techniques(id) ON DELETE CASCADE,

    -- Visibility lives on the thread; replies inherit (D4).
    visibility      TEXT NOT NULL DEFAULT 'broadcast'
                        CHECK (visibility IN ('broadcast','private')),
    scope_student_id INTEGER REFERENCES users(id) ON DELETE CASCADE,  -- set iff visibility='private'

    last_activity_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,    -- bumped on each reply
    deleted_at      TIMESTAMP,                                        -- soft-delete / moderation
    deleted_by_id   INTEGER REFERENCES users(id),

    -- Each anchor_kind populates exactly its columns.
    CHECK (
      (anchor_kind='student_profile'  AND student_id IS NOT NULL AND technique_id IS NULL AND video_id IS NULL AND video_ts_seconds IS NULL AND sst_id IS NULL) OR
      (anchor_kind='technique'        AND technique_id IS NOT NULL AND student_id IS NULL AND video_id IS NULL AND video_ts_seconds IS NULL AND sst_id IS NULL) OR
      (anchor_kind='video'            AND video_id IS NOT NULL AND video_ts_seconds IS NULL AND student_id IS NULL AND technique_id IS NULL AND sst_id IS NULL) OR
      (anchor_kind='video_timestamp'  AND video_id IS NOT NULL AND video_ts_seconds IS NOT NULL AND student_id IS NULL AND technique_id IS NULL AND sst_id IS NULL) OR
      (anchor_kind='sst'              AND sst_id IS NOT NULL AND student_id IS NULL AND technique_id IS NULL AND video_id IS NULL AND video_ts_seconds IS NULL) OR
      (anchor_kind='pinned_technique' AND student_id IS NOT NULL AND technique_id IS NOT NULL AND video_id IS NULL AND video_ts_seconds IS NULL AND sst_id IS NULL)
    ),
    -- Private names a subject; broadcast must not (D4).
    CHECK (
      (visibility='private'   AND scope_student_id IS NOT NULL) OR
      (visibility='broadcast' AND scope_student_id IS NULL)
    ),
    -- Broadcast is only legal on global (library) anchors; per-student anchors
    -- (profile / sst / pinned) are always private (D4, allow-matrix).
    CHECK (
      visibility='private'
      OR anchor_kind IN ('technique','video','video_timestamp')
    )
);

CREATE INDEX IF NOT EXISTS idx_threads_student   ON threads(student_id)   WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_threads_technique ON threads(technique_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_threads_video     ON threads(video_id)     WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_threads_sst       ON threads(sst_id)       WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_threads_scope     ON threads(scope_student_id) WHERE scope_student_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS thread_comments (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id         INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    -- NULL = top-level comment on the thread. Non-NULL = a reply. One level of
    -- nesting is enforced in the handler (a reply's parent must be top-level),
    -- not in DDL.
    parent_comment_id INTEGER REFERENCES thread_comments(id) ON DELETE CASCADE,
    author_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body              TEXT NOT NULL,
    created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    edited_at         TIMESTAMP,
    deleted_at        TIMESTAMP,                 -- soft-delete; read layer tombstones the body
    deleted_by_id     INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_thread_comments_thread ON thread_comments(thread_id, created_at);
```

### Anchor matrix

| Surface | `anchor_kind` | Populated columns |
|---|---|---|
| Profile Q&A | `student_profile` | `student_id` |
| Library / pinned technique (private) | `technique` | `technique_id` |
| Library video (whole) | `video` | `video_id` |
| Library video at a moment | `video_timestamp` | `video_id`, `video_ts_seconds` |
| Syllabus-context technique | `sst` | `sst_id` |
| Pinned technique | `pinned_technique` | `student_id`, `technique_id` |

`technique` (library/pinned context) and `sst` (syllabus context) are distinct
kinds on the same conceptual `(student, technique)`, so SD-008 (surface the
syllabus thread under the syllabus-context toggle when viewing the pinned
technique) is a join, not a collision: resolve the SSTs for `(student, technique)`
and fetch `sst`-anchored threads for those `sst_id`s.

### SST lifecycle notes (D5)

- SST rows are `ON DELETE CASCADE` from the assignment, so a hard assignment
  delete cascades its threads away (matching how `activity` already treats SST
  history). Unassign+reassign preserves the SST row, so threads survive that.
- An SST `hidden_at` (coach hides the technique for the student) does **not**
  hide its threads in Phase A. Revisit if it becomes a moderation concern.

## 5. Activity-feed integration

- Add `EntityKind::Thread` and an `activity.thread_id INTEGER REFERENCES
  threads(id) ON DELETE SET NULL` column (consistent with the other activity FK
  columns).
- Add `Verb::ThreadCommentPosted` (notifiable). Update the verb registry
  (`ALL`, `as_str`, `from_str_verb`, `notifiable`, `primary_entity`) and the
  registry tests in lockstep, the compiler and the exact-set test enforce this.
- **Disable coalescing for thread verbs** (D7): `emit` early-returns the plain
  INSERT for `EntityKind::Thread` rather than calling `find_coalesce_target`.
- Visibility allow-matrix: `broadcast` is legal only on the global anchors
  (`technique`, `video`, `video_timestamp`); the per-student anchors
  (`student_profile`, `sst`, `pinned_technique`) are always `private`. Enforced by
  the third CHECK in §4.
- Delivery onto the existing read model (`target_student_id` stamping):
  - **private thread** (any anchor) → one row, `target_student_id =
    scope_student_id`. Student sees it via the student-feed predicate; all coaches
    via the coach predicate.
  - **broadcast thread** (global anchor only) → coach-only row
    (`target_student_id = NULL`) per D8.
- `notifies()` / `unread_count` pick up the new notifiable verb automatically.
- Decide explicitly whether a comment is coach-dashboard engagement signal: add
  `ThreadCommentPosted` to the `dashboard_activity_feed` verb allow-list for
  profile/self-directed Q&A (recommended yes), otherwise it is silently excluded.

### Contextual ancestry (D9)

- Define `parent_of(EntityRef) -> Option<EntityRef>` per kind on the shared
  vocabulary: `video_timestamp`/`video` → the video's parent (via the M7/F2
  `videos.parent_kind`/`parent_id` edge); `sst` → its syllabus (+ student);
  `match` → camp; `camp` → student; `technique` → none (library root). The
  resolver abstracts over typed vs polymorphic storage, each edge returns an
  `EntityRef`.
- The feed's contextual tile = the leaf event plus the resolved
  `context_path: EntityRef[]` (walk `parent_of` from the anchor until `None`),
  rendered as a breadcrumb. This generalizes the shallow library/syllabus context
  chip that `view-context.ts` renders today.
- Resolution is server-side at feed read (bounded ~5 hops). No ancestral columns
  on `activity` in this epic.

## 6. Visibility and permissions

- Reuse the existing pure-role, gym-global model. "All coaches" is just
  `role != student`, so private ("one student + all coaches") needs no recipients
  table.
- **Posting** requires the same read the parent already gates on. For
  `student_profile`/`sst`/`pinned_technique`, the existing
  `user.id == student_id || has_permission(ViewAllStudents)` check. For
  `video`/`video_timestamp`, gate on **global** video visibility
  (`hidden_at IS NULL`) per D6.
- **Who creates what** (with the allow-matrix): on per-student anchors, a private
  thread's `scope_student_id` is that anchor's student. On global anchors, a
  `private` thread is student-authored with `scope_student_id = the author`
  (SD-010, a student's personal question); coaches contribute via a `broadcast`
  thread (SD-012) or by replying into an existing student thread (SD-011), not by
  creating top-level private threads scoped to someone else.
- **Read rule** (one composable `WHERE`, not per-row guards): a student sees a
  thread iff `visibility='broadcast'` (and they can see the parent) **or**
  `scope_student_id = viewer`; a coach sees all non-deleted threads on parents
  they can see.
- New `Permission::BroadcastLibraryComment` (Coach + Admin) required to set
  `visibility='broadcast'`.
- `Permission::ManageThreads` (Coach + Admin, per the committed plan's decision
  #14) to soft-delete others' content; authors may soft-delete their own.
  Soft-delete sets `deleted_at` and the read layer tombstones the body ("comment
  removed") so reply chains stay intact, matching the `videos.deleted_at`
  philosophy.

## 7. Frontend integration

- New backend module `crates/syllabus-tracker/src/threads/` (`mod.rs` +
  `routes.rs` returning `Vec<Route>`), mounted in `main.rs`, following the
  `videos/` pattern.
- `EntityRef` gains a `thread` (and optionally `comment`) member; the
  `Record<EntityType, true>` lookup makes omissions a compile error.
- `view-context.ts`: a thread is not its own page; it lives on a parent surface.
  Add an optional `thread?`/`comment?` to the existing arms plus a minimal
  profile arm; `viewContextHref` appends `?thread=<id>` (and `#comment-<id>`).
  Comment activity rows deep-link to the parent surface with the thread opened,
  using expand-in-place per the unified-row approach, not a separate route.
- `activity-line.ts`: a `thread_comment_posted` case → "commented on" + parent
  name + deep link. `ActivityRow` (both TS and the Rust mirror) gains
  `thread_id`. `rowToViewContext` reads the new column.
- `activity-feed-list.tsx`: a `MessageSquare` verb icon.
- `query-keys.ts`: `qk.threads(anchor)` / `qk.thread(id)`. Posting invalidates
  `qk.thread(id)`, `qk.activityFeed()`, `qk.activityUnreadCount()`.

## 8. Extensibility to camps / matches

Adding `camp` / `match` / `match_video` is a bounded, compiler-guided edit, the
same motion `activity` already performs:

1. New parent tables (`camps`, `matches`, `match_videos`) — independent prerequisite.
2. `threads.anchor_kind` CHECK gains values; add `camp_id` / `match_id` /
   `match_video_id` FK columns + shape-CHECK arms.
3. `activity` gains the corresponding columns where feed presence is wanted;
   `EntityKind` + `Verb::primary_entity` gain arms (registry tests force
   completeness).
4. Add `parent_of` edges for the new kinds (D9) so ancestry breadcrumbs extend
   automatically.
5. Frontend: `EntityRef` + `ViewContext` arms + `viewContextHref` route +
   `activity-line` case + verb icon. Each omission is a TypeScript compile error.

Unchanged by new kinds: `thread_comments`, the private/broadcast model, reply /
nesting logic, moderation, and the entire read/render pipeline.

## 9. Phasing (stacked PRs in this epic)

- **Phase A — the primitive.** Schema + `threads/` module + thread-auth rule +
  `BroadcastLibraryComment` + `ModerateComments`; thread/comment CRUD across all
  Phase-A surfaces; visibility read rule; soft-delete; non-coalescing feed
  emission + `activity.thread_id`/`EntityKind::Thread`; `parent_of` ancestry +
  contextual-tile rendering; SD-008 syllabus-context surfacing. Roughly 4–5 PRs
  (schema+module; profile+technique threads; video+timestamp; sst+pinned +
  syllabus-context; feed wiring + ancestry).
- **Phase B — @-mentions.** `comment_mentions(comment_id, mentioned_user_id)`
  table; interleaved tagged tokens in `thread_comments.body`
  (`@[technique:42]`, `@[video:91 t=42]`); categorized picker; inline card
  rendering; hidden-video unhide-before-publish prompt.
- **Phase C — social-tile feed.** Render thread/comment feed rows as
  native-context tiles (the contextual breadcrumb tile from D9, expanded to show
  the technique/video/thread in place), the social-media-style feed.

## 10. Constraints carried as first-class notes

- **Thread verbs are non-coalescing** (D7).
- **Video threads are global/library-scoped** (D6); do not scope per-syllabus.
- **Fanout volume is the scaling pressure point.** One activity row per recipient
  is fine for the targeted (one-student) cases this design uses. If broadcast or
  high-frequency commenting ever needs per-recipient delivery at scale, the fix is
  a recipients/notifications table, design around it, do not build it now.

## 11. Out of scope

- **Video replies** (text-first; `comments.video_id` reply path deferred until
  after the M7/F2 video-parent polymorphism lands).
- **Reactions** (phase-2).
- **The notifications system** (separate slice; M19-style). Broadcast
  student-facing pings depend on it.
- **Camp / match anchors** (designed for, not built).
- **Denormalized root-container id on `activity`** (added with camps, per D9).

## 12. Relationship to the committed plan

This supersedes two specifics of M13–M16 in `implementation-plan.md`:

- the **polymorphic** `threads(parent_kind, parent_id)` schema → replaced by typed
  anchor columns (D2);
- the **parent-item** feed integration → replaced by a first-class
  `activity.thread_id` + `EntityKind::Thread` (D7).

Everything else stays aligned with M13–M16: two tables, the `private | broadcast`
visibility enum, `video_timestamp` as its own kind with a seconds offset,
soft-delete with `deleted_at`/`deleted_by_id`, the `threads/` module,
`ManageThreads`/`BroadcastLibraryComment` permissions, and the broadcast =
coach-feed-only resolution (decision #5). `implementation-plan.md` M13–M16 should
be updated to point at this spec for the schema and feed-integration sections.

## 13. Testing

Per the repo convention, each endpoint-introducing PR adds 1–2 integration smoke
tests in `crates/syllabus-tracker/tests/` covering the happy path + the most
important permission denial. Specifically:

- a private thread is visible to its `scope_student_id` and to a coach, and **not**
  to a different student;
- a broadcast thread on a global anchor emits a coach-only feed row (no
  per-student fanout);
- two quick consecutive comments produce two feed rows (coalescing is off);
- a video thread respects global `hidden_at` and ignores per-syllabus overrides;
- posting on another student's profile is rejected;
- soft-deleting a comment tombstones the body but keeps replies resolvable.

Regenerate the `.sqlx` cache against a seeded DB after the schema lands (the cache
type_info is data-dependent; CI seeds before `prepare --check`).

## 14. UI design (shared-primitives pass)

Visual reference mockups: `2026-06-12-threads-comments-mocks.html` (open in a
browser). Surface-specific layout polish and the Phase-C social-tile feed are
designed just-in-time when their slices are built; this section fixes the shared
component and where it sits.

### Shared component

One thread component is reused on every surface: a **root post** (`StudentAvatar` ·
name · role `Badge` · `formatRelativeShort` time · body) with **replies indented
under a `border-l-2 border-border` connector**, and a **composer** (`Textarea` +
`Button`). It is visibly the same component everywhere; only the surrounding chrome,
the composer microcopy, and the visibility control change. This holds the unified
single-component principle the codebase already follows for `TechniqueRow` and
`ActivityFeedList`.

Built from existing primitives only (nothing invented):

- `StudentAvatar` (deterministic color-by-id) for every avatar; `size="sm"` in
  dense rows.
- Role `Badge`; relative time via `formatRelativeShort`, absolute via
  `formatAbsolute` in detailed views.
- Reply indentation and **expand-in-place** reuse the `ActivityFeedList` pattern:
  the `grid grid-rows-[0fr]→[1fr]` transition with members under
  `ml-4 border-l-2 border-border`.
- The **ancestry breadcrumb** (D9) is the existing muted context chip
  (`inline-flex items-center gap-1 text-xs text-muted-foreground` + icon) extended
  to multiple hops, composed with `ui/breadcrumb`.
- Composer: `Textarea` + `Button`. The coach broadcast control is a
  split-button (`Button` + `DropdownMenu`: "Reply privately" / "Broadcast"); the
  Broadcast item renders only when `hasPermission(user, 'BroadcastLibraryComment')`.
- Soft-delete renders a tombstone ("comment removed") in place of the body, keeping
  reply chains intact; delete is confirmed via `alert-dialog`.
- Four states handled per the design skill: loading (skeleton, reuse the
  `ActivityFeedList` pulse), empty ("No discussion yet. Start one."), error
  (`sonner` toast), success; the composer button disables while pending.

New component files under `frontend/src/components/threads/`:
`thread-view.tsx` (root + replies), `comment-item.tsx`, `thread-composer.tsx`, and
a thin per-surface wrapper where needed.

### Per-surface placement

1. **Technique** (`anchor_kind='technique'`/`pinned_technique`/`sst`): a new
   `discussion` `BlockId` in `TechniqueRow`'s `ExpandedPanel`, rendered after the
   notes blocks and gated by `block-visibility` per `(context.kind, role)`.
   Composer copy: "Ask about this technique." The `sst` (syllabus-context) thread
   surfaces here under the SD-008/SD-009 syllabus-context toggle.
2. **Profile** (`anchor_kind='student_profile'`): on the Activity tab, a "Start a
   thread with <student>" composer, with threads rendered as `ActivityFeedList`
   rows that expand in place to their replies. Content-anchored comments also bubble
   up as feed rows carrying their context chip (e.g. `🌐 Library`).
3. **Video** (`anchor_kind='video'`/`video_timestamp`): a comments rail in the
   video player panel; timestamp chips seek the player via the existing
   `player-events`. Coach composer uses the private/broadcast split-button.
4. **Camp (future)**: a camp-level discussion section plus match-video threads
   whose tile shows the resolved `parent_of` breadcrumb (`Camp › Match › video ·
   ts`). No new component, only new anchor kinds.

### Microcopy

Composer verbs are surface-specific and domain-worded ("Ask about this technique",
"Comment at 0:42", "Start a thread with Sam", "Reply"). Empty states name what is
missing and the CTA. Destructive actions are explicit ("Delete comment") and
confirmed.
