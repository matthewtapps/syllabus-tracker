# Sillybus ongoing-use, implementation roadmap

## Context

Sillybus is shifting from a finite "manifest" (assign a syllabus, mark techniques green, graduate) to an ongoing-use "workspace" (camps, threads, videos, conversations) that a coach and student use week-to-week, independent of where the student sits on their syllabus.

The product framing lives in `docs/product/ongoing-use-concepts.md`. The full user-story list is in `docs/product/ongoing-use-stories.csv`. Engineering caveats and pending decisions are in `docs/product/ongoing-use-technical-notes.md`.

This document is the implementation roadmap. It groups the in-scope stories (v1 and v1-nice-to-have) into **26 milestones across 7 phases** (M7 split into M7 + M7.5; M17 split into M17a + M17b; M4.5 added by the 2026-06-09 amendment; M5 split into M5a / M5b / M5c by the same amendment). Each milestone is a coherent product step (typically 2-4 PRs) that leaves the app usable. OS-* stories are out of scope.

The roadmap is sequenced primarily by the natural build-up of the user stories, with technical foundations (video parent polymorphism, visibility model refactor) inserted at the point where they unblock the next batch of product work.

This is a living document. Re-read it before starting each milestone; mark milestones as `✅ shipped`, `🔄 in progress`, or leave them as planned.

---

## Status: shipped in 2026-06-09 / 2026-06-10 session

For posterity. PRs reference the GH numbers in this repo.

**Backend cutover / structural:**
- M4.5 backend rename — PR #16 ✅ merged-ready (collections → syllabuses for Rust types + API surface; SQL identifiers unchanged per decision #19).
- M4.5 frontend rename — PR #17 ✅
- M6 notes dual-read shim — PR #18 ✅
- M6 notes writer cutover — PR #19 ✅
- M7 video parent polymorphism schema — PR #23 ✅
- M7 videos.rs query cutover — PR #24 ✅

**Pinning + ongoing-use surfaces:**
- M6 pin/unpin endpoints + library "Pin to working list" — PR #20 ✅
- M6 Pinned tab content + Recently-working-on strip — PR #21 ✅
- M6 feed wiring for pins + SD-015 graduated read-only — PR #22 ✅

**IA reshape (this amendment's work):**
- Shared `LibraryTechniqueRow` component extraction + Pins lifted to its own page — PR #25 ✅
- This amendment with the rubber-duck review — PR #26 ✅
- M5b2' activity feed extraction (`/activity` + `/student/:id/activity`) — PR #27 ✅
- M5b3' drop the `<Tabs>` container; `/student/:id` redirects — PR #28 ✅
- M5b3 (kind filter chips, client-side filter, scope-shrunk per amendment) — PR #29 ✅
- Activity feed cards expand inline via `LibraryTechniqueExpandedBody` — PR #30 ✅
- Activity snippet on slim feed cards — PR #31 ✅
- Backend `?kinds=` filter on `/api/student/<id>/feed` — PR #32 ✅

**Not started yet (next session):**
- M5d (unified TechniqueRow base) — plan calls for ~4 PRs once the syllabus row's StatusToggle / NotesEditor / AttemptsList absorb into the shared base.
- M5b3 infrastructure (Framer Motion + cursor pagination + infinite scroll).
- M5c (atomic data-model cutover) — the biggest coordinated PR in the roadmap.
- M7.5 (loose uploads) — partial work stashed during PR #19 mid-stream after UX feedback redirected the session.
- M8 onward (camps, competitions, matches, threads, mentions, comments).

---

## Plan amendment: 2026-06-10 — Top-level pages + shared row component

> Captured after PR #25 shipped a shared `LibraryTechniqueRow` component and lifted Pins to its own page. Further product feedback during that session reshapes the IA the original [2026-06-09 amendment](#plan-amendment-2026-06-09--ia--data-model-reframe) sketched. **This amendment overrides** the M5b chip-filter framing and the "filter chips replace tabs" decision (#16) where they conflict.

### What changes

**The student-facing app is six top-level routes, not a tabbed profile.**

- `/dashboard` (existing) — coach/student landing
- `/syllabuses` and `/syllabuses/<id>` (existing, M4.5) — list + detail
- `/library` (existing) — the global technique library
- `/pins` (NEW, current user) + `/student/:id/pins` (NEW, coach view) — shipped in PR #25
- `/activity` (NEW, current user) + `/student/:id/activity` (NEW, coach view) — the activity feed
- `/student/:id/syllabus` (NEW) — the per-student syllabus content the 2026-06-09 amendment already moved out of the profile

Syllabuses / Library / Pins each render full technique details (expanded rows with notes, videos, syllabus context badges). Activity Feed renders activity-context snippets via a wrapper card concept (below). The previously-planned filter chips on the feed page (M5b3) cease to make sense as "Activity / Pinned / Camps switchers" because Pinned and Camps lift to their own routes; chips on the feed are reduced to **item-kind filters within the activity feed itself** (techniques / rank changes / threads / etc), not view switchers.

**`TechniqueRow` is the shared base; surfaces overlay context.**

- The component lives at `frontend/src/components/library-technique-row.tsx` (shipped in PR #25). It supports a list-mode expanded-in-place layout where the collapsed meta disappears on expand instead of repeating above the body.
- Library, Pins, and (followup) the Syllabus page all consume the same row. Surface-specific info (syllabus status badge on a pin, attempt-log surface on a syllabus row, etc.) overlays via the existing `badges` prop and a small number of new opt-in sections in the expanded body.
- The current `TechniqueRow` in `student-techniques/components/technique-row.tsx` (used by the syllabus tab) is a separate component with a different data shape (`Technique` = `StudentTechnique`). Consolidating into one shared base is a follow-up refactor (M5d below); the immediate work uses two adjacent components that follow the same UX pattern.

**Activity feed cards become `ActivityFeedItem` wrappers.**

- The activity feed is a list of cards. Each card = an `ActivityFeedItem` wrapper around one or more child component(s): a technique, a camp, a video, a thread.
- Children render in **slim mode** when nested inside a feed card: expanded by default, minimal chrome, focused on "the item plus the activity snippet that triggered the card." For a technique that's slim mode = technique name + relevant context (which syllabus / which video / which thread tripped it), NOT the full library expanded body.
- Example: "Student commented on this video on this technique" → one feed card showing the technique slim, the video open at the relevant moment, the thread underneath.
- This supersedes the M5b2 "FeedCard family" framing (per-kind card components) with a wrapper-plus-children model. M5b2's per-kind cards become **slim-mode renderers** for each item kind, composed inside `ActivityFeedItem`.

**The student profile page (`/student/:id`) goes away as a tab container.**

- Today: `/student/:id` is a 4-tab page (Activity / Syllabus / Pinned / Camps). Pinned already redirects to `/pins` (PR #25).
- Target: `/student/:id` redirects to `/student/:id/activity` (the new activity feed route). Coach navigation flows through that. Student rank header strip + footage badge etc. become a small wrapper component the activity / syllabus pages share, not a "profile page."

### What this does to existing milestones

- **M5a** (already shipped GH PRs #12+#13): the 4-tab scaffold is officially superseded by separate routes. The scaffold doesn't get removed until each tab lifts out. Order: Pinned (PR #25, ✅ shipped), Activity (M5b2'), Syllabus (M5b1 already plans this), then drop the tabs container.
- **M5b1**: Syllabus extraction unchanged in intent. Route name becomes `/student/:id/syllabus` (was that already).
- **M5b2** (FeedCard family): superseded — reshaped into the `ActivityFeedItem` wrapper + slim children model. Activity feed extraction (the new `/student/:id/activity` route) is the operative work; per-kind cards become slim-mode child components.
- **M5b3** (filter chips on feed): scope shrinks. Filter chips remain useful WITHIN the activity feed for kind filters, but they no longer replace "view-switching tabs" since pinned / camps are separate pages now.
- **M6 PR 4** (Pinned tab content + syllabus-context surfacing + profile header strip): ✅ shipped as PR #21 + lifted further to /pins in PR #25.
- **M18** (activity feed polish): kind-filter chips and unseen divider remain. Item-priority styling, free-text search remain.

### What stays unchanged

- M5c atomic data-model cutover stays as planned. The shape of `student_syllabuses` / `student_syllabus_techniques` doesn't change; only the surfaces that consume them flip from tabs to routes.
- M6's pin/unpin endpoints, `technique_notes` table, dual-read shim, writer cutover, graduated read-only — all shipped (PRs #18 / #19 / #20 / #21 / #22).
- M7 schema + videos.rs query cutover (PRs #23 / #24) — shipped.
- Pending decisions #17–#23 from the prior amendment stay valid except #22 (one card per (student, technique)) which now reads in the context of the `ActivityFeedItem` wrapper: one wrapper per (student, technique) event, child renderers may include multiple syllabuses' worth of badges inside the slim technique view.

### New pending decisions

| # | Decision | Pick | Why |
|---|---|---|---|
| 24 | Where the student rank / footage badge header lives once the profile-tabs container goes away | A small `<StudentHeaderStrip>` component the `/student/:id/activity` and `/student/:id/syllabus` pages both render at the top. Coach-only views (`/student/:id/pins` already does this) get the same component. | Avoids creating a fourth surface that's "just the profile header." Keeps the chrome where the user is actually working. |
| 25 | Default landing when navigating to `/student/:id` (legacy URL) | Redirect to `/student/:id/activity`. | Mirrors the user's mental model: "this person's recent activity" is the entry point. Coaches who want syllabus tap "Syllabus" from there. |
| 26 | Shared row component scope | Two adjacent components for now: `LibraryTechniqueRow` (used by library + pins + future activity-slim) and the existing syllabus-side `TechniqueRow` (used by syllabus page). M5d below introduces the unified base extraction. | The data shapes are genuinely different — `LibraryTechniqueRow` data has student / video counts; `StudentTechnique` has status / attempts / notes. Forcing one component to handle both now would require a normalized intermediate type AND porting the syllabus row's StatusToggle / NotesEditor / AttemptsList plumbing. Defer to a focused refactor. |
| 27 | Activity feed slim-mode renderer location | A new directory `frontend/src/components/feed/` with one file per kind (`technique-slim.tsx`, `rank-change-slim.tsx`, etc) plus `activity-feed-item.tsx` as the wrapper. Slim renderers compose the shared base row in a different mode rather than duplicating layout. | Keeps the activity feed's special-case rendering separated from the row component itself (which serves the full-detail surfaces). Each slim renderer is small (< 100 lines) and contains the activity-context formatting for its kind. |
| 28 | Filter-chip scope on the activity feed | Chips filter by item kind only (technique / rank_change / future kinds). They do NOT switch to other top-level routes. | Pinned / Camps / etc are their own pages now. Filtering the activity feed by what KIND of activity remains a useful concept. |

### What we add to the roadmap

A new sub-milestone M5d covers the cleanup pass:

- **M5b2'** (renamed from M5b2): Activity feed extraction to `/student/:id/activity` + `/activity` (own view). Use the existing `activity-feed.tsx` content lifted out of the profile tab. Each item becomes wrapped in an `ActivityFeedItem` card with the technique / rank slim-mode child renderer.
- **M5b3'**: drop the profile tabs container. `/student/:id` redirects to `/student/:id/activity`. Rank / footage strip becomes a shared `<StudentHeaderStrip>` component used by `/activity`, `/syllabus`, `/pins`, `/camps` (future) variants.
- **M5d** (NEW): Unified `TechniqueRow` base — focused refactor that merges the syllabus-side `TechniqueRow` and the library-side `LibraryTechniqueRow` into one base. Surfaces flip to it in one PR each.

These slot in before M5c (atomic data-model cutover). M5c is unaffected at the data layer; only the consumer rewrites in M5c change to target the new routes instead of the old tab content.

### Rubber-duck review (2026-06-10)

Senior-engineer pass before kickoff. The amendment is implementable but has a handful of technical gotchas worth naming:

**1. `StudentHeaderStrip` data source.**
Today the rank strip pulls fields from `useStudentTechniques(id).data.student`, which loads ALL the student's techniques as a side effect. With the syllabus / activity / pins each on its own route, having all three pages fetch `useStudentTechniques` just for the header is wasteful. Decision: extract a `useStudentProfile(id)` hook returning the minimal header fields (display name, rank, footage badge, graduated_at). The existing `users` endpoint likely has the data; verify the response shape and add the hook before M5b2' extracts the strip.

**2. Bottom nav slot pressure.**
After M5b2' lands Activity and PR #25 already added Pins, the student bottom nav balloons to: Dashboard / My techniques / Library / Pins / Activity / More. Six slots on a mobile bar is too many. The "My techniques" entry (which today points at `/student/<myId>` = the syllabus tab) becomes redundant once Syllabus is at `/student/<myId>/syllabus`. Decision: in M5b2', replace "My techniques" with "Activity" as the student's primary landing; "Syllabus" is reachable via Activity's "View syllabus" button and via Library → syllabus drill-in. Final student nav: Dashboard / Activity / Library / Pins / More.

**3. Legacy URL preservation.**
`/student/:id?focus=42&profile_tab=syllabus` URLs exist in coach bookmarks, M5a feed deep-links, and dashboard rows. The redirect from `/student/:id` to `/student/:id/activity` needs a sniff for legacy query params: if `profile_tab=syllabus` or `focus=` is present, redirect to `/student/:id/syllabus?focus=...` instead. Drop the `profile_tab` param after rewriting. Cover this in the M5b3' PR.

**4. `ActivityFeedItem` wrapper's child composition story.**
The amendment says "wrapper around one or more children." Today's feed kinds are `technique` and `rank_change` — each card has ONE child. Composite cards (technique + video + thread for "student commented on this video on this technique") only become possible when the backend feed item carries cross-references to videos / threads. That's M13 / M14 / M16 work. For M5b2', wrap one child per item; the API is the same, just nothing composes yet. Note the multi-child invariant in the wrapper component's prop type so future kinds slot in cleanly.

**5. Slim technique renderer vs library row reuse.**
Tempting: have `TechniqueSlim` BE `LibraryTechniqueRow` in a "slim" mode so the user sees one consistent visual treatment. Cost: forces the activity feed to fetch full `LibraryTechniqueRow` data for every technique item, which is N extra queries per feed. Decision: for M5b2', `TechniqueSlim` is a small purpose-built component that consumes feed item data only (technique_id / title / status / latest_activity_at). Visual style mirrors the library row's collapsed appearance. When M5d consolidates rows, slim mode becomes a prop on the unified base AND the activity feed query gets denormalized to carry the extra fields slim mode needs — that's the right time to optimize, not now.

**6. Profile-tabs deletion timing.**
M5b3' deletes the `<Tabs>` container. Files affected:
- `student-techniques/page.tsx` (~1000 lines today) shrinks to a redirect.
- `student-techniques/components/activity-feed.tsx` retires.
- `student-techniques/components/technique-filters.tsx` (syllabus-side filter chips) moves to the syllabus page during M5b1's syllabus extraction — NOT deleted here.
- `student-techniques/components/technique-row.tsx` stays (used by syllabus page) until M5d consolidates.

Order matters: lift activity (M5b2'), lift syllabus (M5b1, sequenced earlier), THEN delete tabs (M5b3'). If syllabus lift slips, M5b3' blocks.

**7. PR #25's `LibraryTechniqueRow` already lives at `components/library-technique-row.tsx`.**
The M5d consolidation lands the unified base at `components/technique-row.tsx`. That conflicts with the syllabus-side `student-techniques/components/technique-row.tsx`. Sequencing: M5d PR 1 lands the new base at a fresh path like `components/technique-row-base.tsx`, surfaces flip, then the legacy paths get deleted in the last PR of M5d. Or pick a different final name to avoid the path conflict entirely.

**8. `/student/:id/activity` permissions match `/student/:id/pins`.**
Already enforced in `student-pins/page.tsx`: own view always allowed; viewing others requires `isCoachOrAdmin(user)`. Mirror exactly. Don't introduce a new permission for activity-feed-viewing — the M5a feed endpoint's per-route guard is what backs this.

**9. `data-expanded={expanded}` styling in PR #25.**
The new `LibraryTechniqueRow` uses `data-[expanded=true]:border-l-primary data-[expanded=true]:bg-muted/20` for the expanded affordance. Tailwind's `data-[*=*]` selector requires the JIT compiler to see those classes statically — they are, so this works. Confirmed via PR #25's clean build, just noting it for anyone reviewing.

**10. Test coverage.**
The activity feed extraction touches the same UI tested implicitly via the dashboard / dot-tests in `test/api.rs`. None of those hit the activity feed surface directly. Manual verification on staging is the ground truth. If we want a feed regression test, add one in M5b2' alongside the new route.

No blocker found. Sequencing: M5b1 (syllabus extraction) → M5b2' (activity extraction) → M5b3' (delete tabs). M5d (unified row) is parallel-safe and can land any time after M5b2'.

---

## Plan amendment: 2026-06-09 — IA + data model reframe

After M5's first pieces shipped (GH PRs #12 + #13), product feedback redirected several of the foundational assumptions in this document. The changes below **override** the corresponding sections later on; treat this amendment as load-bearing.

### What changes

**Activity feed is the primary view.**

- `/student/<id>` IS the activity feed, not a tab on a syllabus-centric page. Layout becomes Twitter / Instagram-style: standalone cards, infinite scroll. The "connected list" shape M5's first cut shipped with is a transitional artifact and gets replaced.
- Activity / Pinned / Camps / etc. are **filter chips on the same feed surface**, not parallel tab content. Tapping a chip filters cards in place with a small fade animation. No view swap.

**Syllabus is its own page, not a tab.**

- Syllabus moves to `/student/<id>/syllabus`. The activity feed has a prominent "View syllabus" affordance at the top.
- A syllabus is its own entity (renamed from `collections`). The relationship "this student is doing this syllabus" lives in a new `student_syllabuses` table.
- A student can be doing **multiple syllabuses simultaneously** ("assigned syllabuses" list). The same technique in two of a student's syllabuses tracks **independently**.
- **Camps don't track RAG status** — that responsibility lives on the syllabus only. Camps own videos / notes / matches / footage review.

**Techniques are no longer "assigned" to students.**

- The library is the only source of techniques. Students self-browse everything visible and pin to a personal working-on list (M6).
- Existing `student_techniques` rows get migrated manually in production during the atomic cutover (M5c). Until that cutover, existing code keeps working against `student_techniques` unchanged.

### What this does to existing milestones

- **M5** (parallel tabs scaffold + activity feed v1) is **superseded**. It now ships in three pieces:
  - **M5a — Tabs scaffold + feed endpoint + v1 row layout** ✅ already shipped (GH PRs #12 + #13). The v1 row layout is a transitional artifact replaced in M5b.
  - **M5b — Activity feed as cards + filter chips + syllabus extraction to `/student/<id>/syllabus`**. The IA shift, layered on top of M5a. Existing `student_techniques` data still backs the syllabus.
  - **M5c — Atomic data-model cutover**. NEW `syllabuses`, `student_syllabuses`, per-`(student, syllabus, technique)` progress tables. Manual prod migration. Coordinated cutover, not a dual-read shim.

- **M4.5 — Collections → syllabuses rename** (new milestone, slots between M4 and M5b). User-facing rename: routes / types / API paths / copy. SQL table names stay `collections` until M5c bundles the data-model change with the table rename in one atomic step.

- **M6** (pinning + notes refactor): `technique_notes` (already created in GH PR #14) **stays as the canonical notes store across syllabus / pinned / camp contexts** per decision #21. The originally-planned dual-read shim during a transition window is replaced by a one-shot copy in the M5c migration script: legacy `student_techniques.{student,coach}_notes` rows merge into `technique_notes` during cutover. The per-syllabus progress table introduced in M5c does **NOT** carry notes columns — only status, attempt counts, and last-update timestamps.

- **M8** (camps): drop any RAG-status surface on `camp_techniques`. Camp focus stays on videos / notes / matches.

- **M18** (activity feed polish): cards + filter chips are now baked into M5b. M18 shrinks to **free-text search (CX-005) + unseen-activity divider (CX-027) only**. CX-004 filter chips ship in M5b.

### New pending decisions

| # | Decision | Pick | Why |
|---|---|---|---|
| 16 | Information architecture | Activity feed at `/student/<id>` is primary; syllabus at `/student/<id>/syllabus`. Filter chips on feed for Activity / Pinned / Camps / etc.; not parallel tabs. | A student's profile centres on what's happening week-to-week; syllabus is the durable structured thing that deserves its own surface. |
| 17 | Camps × RAG | Camps don't track RAG status. Only syllabuses do. | Cleaner separation: syllabus = durable progression; camp = focused project (videos / notes / matches). Same technique in both contexts means independent surfaces. |
| 18 | Multiple syllabuses per student | A student can be doing several syllabuses simultaneously; progress per `(student, syllabus, technique)`. | Matches gym reality: a student might be on Blue Belt + No-Gi Fundamentals + IBJJF Open prep at once, each with separate progress. |
| 19 | Collections → syllabuses rename, scope | User-facing rename now (M4.5). SQL table names stay `collections` until M5c bundles the data-model change with the table rename atomically. | SQLite's declarative migrator handles a rename as drop + recreate, which is destructive. Bundling with the cutover keeps destructive ops contained to one coordinated step. |
| 20 | Prod migration cadence for the data-model change | Manual cutover during M5c. Build on staging until the cutover lands; keep existing prod code paths working against `student_techniques` until cutover day. | The structural shift from `student_techniques` to per-syllabus progress is too big to drip in; an atomic cutover with a written runbook is safer than a long deprecation window. |
| 21 | Notes home under the new data model | **`technique_notes` (keyed `(student, technique)`) stays as the canonical notes store.** Notes are shared across syllabus / pinned / camp contexts. The per-syllabus progress row (`student_syllabus_techniques`) does **NOT** carry `notes_*` columns — it tracks status, attempt counts, last-update timestamps only. | Honors SD-004's "same notes appear across every view of the same `(student, technique)` pair" — the original product intent. Avoids the "I wrote a note in my Blue Belt syllabus, opened my No-Gi syllabus, where did it go?" foot-gun. Per-syllabus state (status / attempts) is the thing that legitimately differs across contexts. |
| 22 | Feed grouping when the same technique is in multiple syllabuses | **One card per `(student, technique)`, aggregating syllabuses.** Card sub-title lists the contributing syllabuses ("Blue Belt Fundamentals · No-Gi Fundamentals"). Status reflects the most advanced syllabus's status, or "mixed" with a tooltip. | Consistent with decision #21 — notes live at the `(student, technique)` level, so the dominant feed surface should too. Avoids feed noise from duplicate cards for the same technique. Tapping the card lands on the syllabus page where per-syllabus progress is visible side-by-side. |
| 23 | Filter-chip transition animation | **Framer Motion**. Add as a project dependency with a tiny wrapper around `motion.div` for entry/exit fades on filtered cards. Reused later for M19's notification drawer + M20's deleted-item placeholder transitions. | The chip-press → cards-rearrange interaction is the headline of the new feed surface; the difference between "cards instantly snap" and "cards smoothly fade" is the difference between feeling like a polished product and feeling like a homework assignment. The dep cost is real but amortised across future surfaces. |

### What stays unchanged

- M1, M2, M3, M4 — all unaffected. Already shipped (M1–M4) or queued in the stack and still valid.
- Pinning data model (`pinned_techniques`, M6) — independent of the syllabus question; stays as planned.
- All milestones beyond M8 — names and content unchanged; only the camp-RAG carve-out (decision #17) affects M8.
- The pending-decisions table above (rows 1–15) — all still valid as-is.
- **`technique_notes` (PR #14) schema and comment** — still correct under decision #21. The comment's "shared across syllabus / pinned / camp" framing was right; only the *implementation timeline* changes (cutover-time copy instead of dual-read shim).

---

## Pending decisions, resolved

The technical-notes doc surfaces several open technical decisions. The roadmap commits to the following picks. Each is revisited at its milestone's kick-off, but the rest of the plan assumes these:

| # | Decision | Pick | Why |
|---|---|---|---|
| 1 | Video parent shape (tech-notes §1) | **(A) Polymorphic columns**: `videos.technique_id` nullable, add `parent_kind` + `parent_id` | Closer to existing shape, simpler queries, sqlx-friendly. If lineage tracking is needed later, add a `video_origins` audit table separately. |
| 2 | Visibility guard shape (§4) | **(A) Context-aware guard**: callers pass `Library`, `Syllabus`, or `Camp(camp_id)` | Safer than a global "visible anywhere" predicate; prevents library-visibility from accidentally granting syllabus-context access. |
| 3 | Pinned notes shape (§3) | **(B) Notes table + separate `pinned_techniques` table** | Cleaner separation of relationship semantics from shared content. Migrate `student_techniques.{student,coach}_notes` to a new `(student, technique)`-keyed notes table on read, drop the old columns after a window. |
| 4 | CC-034 target camp (§9) | Coach picks the target from a dropdown of the student's active camps; default if only one; offer "create new camp" if none. | Matches the tech-notes proposal. Adds one click but no ambiguity. |
| 5 | SD-012 broadcast feed scope (§8) | Coach's own feed only; navbar notification (CX-025) fires for any student currently watching the video. | Avoids spamming every student's feed when a coach drops a note on a popular video. |
| 6 | CX-027 seen-at granularity (§7) | Per-(viewer, item) `seen_at` — full granularity, same shape as today's `student_technique_views`. | Keeps parity with the existing pattern; the cheaper aggregate variant loses interaction precision the UX wants. |
| 7 | CX-003 action-priority visual treatment | Deferred to M18 UX design. Plan as a v1 polish item, not a v1 blocker. | Action priority is a styling concern, easy to add once the feed is rendering items. |
| 8 | Graduated-student access to new ongoing-use surfaces | **Full access retained.** A graduated student can pin techniques, post threads, leave library comments, and (if they hold the Footage Submitter role) upload to profile/threads. The only thing they lose is the ability to change syllabus status / record attempts (SD-015). | The ongoing-use shape isn't about syllabus progression, so graduating shouldn't strip it. |
| 9 | Activity feed display of deleted threads (M20 × M5/M18 interaction) | Render the feed item as a "deleted by <coach>" placeholder, matching M20's thread-display behaviour. Item stays in the feed and remains clickable to the placeholder. | Consistency with the thread surface, and preserves the audit trail of when something was removed. |
| 10 | Footage Submitter dormant gating | Every milestone that lands a new upload surface (M9, M12, M13) explicitly checks `Permission::SubmitFootage` in its acceptance criteria, not just in M2's verify step. | M2 ships the role dormant; without per-PR enforcement on the surfaces, later milestones can silently ignore it. |
| 11 | Activity feed shape at M5 | **Item-shaped from day one.** M5 renders one row per top-level item (technique / camp / match / profile-thread / one-off), even when the item has just one activity. M18 polishes (search, filter chips, unseen divider, item-priority styling) without reshaping. | Coaches will form a mental model of the M5 shape and notice a reshape at M18. Pay the design cost up front; the storage shape doesn't differ. |
| 12 | @-mention storage shape (CX-011/CX-012) | **Interleaved tagged tokens inside `comments.body`**, e.g. `@[technique:42]` or `@[video:91 t=42]`. Parsed on render; enriched server-side with a join when the comment is fetched. No separate mentions table, no JSON-blob column. | Easier to grep, migrate, render. Mentions stay close to surrounding text in the source-of-truth column. |
| 13 | F2 cascade semantics | **Deferred per-parent-kind to the milestone that owns the parent.** Camp delete behaviour decided at M9, match delete at M12, thread delete at M20. F2 declares the cascade slots but doesn't lock the picks. | Locking three cascade picks before any milestone exercises them is overbaked; each milestone has context the early commit doesn't. |
| 14 | Per-feature permissions for new content surfaces | **Add `Permission::ManageThreads` (M13), `BroadcastLibraryComment` (M15), `ModerateContent` (M20)**. All three roll up to `Coach + Admin` today. | Matches the existing pattern that every guarded endpoint names a `Permission`; gives a future moderator role a clean hook. |
| 15 | Frontend permission-level UI gating | **Extend `/api/me` to return `permissions: string[]`** (derived from role). Add `hasPermission(user, name)` helper in `frontend/src/lib/api.ts`. Components conditionally render via `user.permissions.includes(...)`. | Today's `RequireAuth/Coach/Admin` route guards are coarse role checks. New surfaces like the "upload" button (M9/M12/M13) need permission-level conditional rendering, not new `RequireFootageSubmitter` guards. |

---

## Pre-roadmap prerequisites

Two infrastructure items to confirm before M1 lands:

1. **`.sqlx/` cache CI gate.** Confirm CI fails on stale prepared queries. The justfile has `just sqlx-check`; check whether it runs in CI. If not, add it as a workflow step before M3 (the first migration-heavy milestone). Without this, M3 / M6 / M7 / M8 will all see intermittent build breaks from cache drift.

2. **Deployment ordering**. The app's startup schema check (`crates/syllabus-tracker/src/main.rs:131-173`) panics on mismatch. Every milestone that touches the schema lands in two stages: (a) the migration runs in production, (b) the application image deploys. There is no automatic rollback path — a manual revert means rolling the schema and the code together. Each DB-touching milestone's verify step starts with "migrate first, then deploy."

---

## Cross-cutting conventions

Apply to every milestone unless overridden:

- **Endpoint instrumentation**: every new Rocket handler carries `#[instrument(skip(state, user))]` (see `crates/syllabus-tracker/src/videos/routes.rs:84` for the established pattern). Critical-path DB functions wear the same.
- **Form pattern**: every new form (rank edit M1, notes M6, camp CRUD M8, competition CRUD M11, match log M12, thread compose M13, library comment M15) uses `TracedForm` + `useFormWithValidation` + Zod schema + `handleApiFormError`. The library page at `frontend/src/app/library/page.tsx:36-49` is the canonical example.
- **TanStack query keys**: every milestone that adds a new query target adds the key to `frontend/src/lib/query-keys.ts` in the hierarchical pattern already used (e.g. `qk.camp(id)`, `qk.camps(studentId)`, `qk.thread(id)`, `qk.notifications()`). The milestone body names the keys it adds.
- **Index naming**: new tables follow the `idx_<table>_<key>` convention with partial `WHERE deleted_at IS NULL` indexes where soft delete applies (precedent at `config/schema.sql:157`). Each milestone names its indexes in the DB section.
- **Route module organisation** (from M8 onward): new resource domains land in their own sub-module (`crates/syllabus-tracker/src/camps/`, `threads/`, `notifications/`, etc.) following the `videos/` module pattern (`mod.rs` + `routes.rs` + a `routes()` function returning `Vec<Route>`). `main.rs` mounts each module with one `.mount("/api", camps::routes())` call. M8 introduces this convention; M11–M19 each follow it for their resource.
- **Soft-delete recovery**: today there's no UI for un-deleting. Operator clears the timestamp column manually. M20 retains this convention; an admin "trash" view is out of scope unless a real moderation incident motivates it.
- **Integration tests**: each milestone introducing endpoints adds 1-2 smoke tests in `crates/syllabus-tracker/tests/` covering the happy path + the most important permission denial.

---

## Cross-cutting technical foundations

These two refactors are called out separately because they touch a lot of surface area and ship before the product work that depends on them.

### F1 — Visibility model refactor (CX-019) → M3

- `videos.hidden_at` stays global.
- `video_student_visibility` (today: applies everywhere) is renamed `syllabus_video_student_visibility` and scoped to the syllabus view only.
- A new `camp_video_visibility` (M9) layers on top of the global hide inside camps.
- Library / thread / pinned contexts only check `videos.hidden_at`.
- Replace `video_visible_to_student(video, student)` with `video_visible_to_student(video, student, ctx: Library | Syllabus | Camp(camp_id))`.
- Audit every caller of the current predicate (the playback / download guards at `videos/routes.rs:511` and `:559`, the mutator at `:323`, and any direct `video_student_visibility` queries — grep both symbol names).

### F2 — Video parent polymorphism (CX-018) → M7

- `videos.technique_id` becomes nullable.
- Add `parent_kind TEXT NOT NULL` (one of: `technique`, `camp`, `match`, `profile`, `thread`, `loose`) and `parent_id INTEGER` (nullable only for `loose`).
- Existing rows migrate to `parent_kind='technique'`, `parent_id=technique_id`. `technique_id` stays populated for backwards-compatible read paths until M16 cleanup.
- Per-kind indexes replace `idx_videos_technique_position` and `idx_videos_alive_by_technique`.
- Cascade semantics: declared as slots, decided in the owning milestone (per resolved decision #13). M9 picks the camp-delete behaviour; M12 picks match-delete; M20 picks thread-delete. Each milestone names the decision in its DB section.
- `.sqlx/` cache rebuilds via `just sqlx-prepare` after every query shape change.
- The startup schema check (`crates/syllabus-tracker/src/main.rs:131-173`) panics on mismatch. Ship migration → restart → ship code, in that order.

---

## Phase 1 — Foundations (additive, low-risk)

### M1 — Rank fields on the user profile

**Stories**: CX-001, CX-002.

**Goal**: Coach can record and update a student's belt, stripe count, and last grading date from the student profile.

**DB**: New columns on `users`: `belt TEXT`, `stripes INTEGER`, `last_graded_at TIMESTAMP`. All nullable. New `rank_audit` table: `(id, user_id, belt, stripes, last_graded_at, changed_by_id, changed_at)`. **Audit is not optional** — M5's rank-change feed item reads from this table.

**Backend**: Extend `User`/`DbUser` models. New `PATCH /api/users/<id>/rank` endpoint gated by a new `Permission::EditStudentRank` (granted to coach/admin). Inserts a `rank_audit` row in the same transaction. `#[instrument]` on the handler.

**Frontend**: Surface rank as a header strip on the student profile (`frontend/src/app/student-techniques/page.tsx`). Coach-only edit modal. Query key: `qk.userRank(userId)`.

**Indexes**: `idx_rank_audit_user_changed` on `rank_audit(user_id, changed_at DESC)`.

**PR breakdown** (~2): (1) Schema (columns + audit table + index) + backend endpoint + `qk.userRank` key. (2) Frontend display + edit modal.

**Verify**: Coach edits rank; student sees it on their own profile; rank persists across reload; the audit row is visible via direct SQL.

---

### M2 — Footage Submitter sub-role + permissions on `/api/me`

**Stories**: CC-025, CC-026.

**Goal**: Coaches can promote/revoke `FootageSubmitterStudent`. The role itself does nothing useful until later milestones wire the upload surfaces (M9/M12/M13). M2 also lands the permission-aware frontend-gating infrastructure (per pending decision #15), which every subsequent UI-gated surface depends on.

**DB**: No schema changes. `users.role` already TEXT.

**Backend**:
- New `Role::FootageSubmitterStudent` variant in `crates/syllabus-tracker/src/auth/permissions.rs`.
- New `Permission::SubmitFootage` granted to `FootageSubmitterStudent`, `Coach`, `Admin`.
- Extend the role-update endpoint to allow promotion/revocation (granted by `EditUserRoles`).
- Extend `/api/me` to return `permissions: string[]` derived from the role's permission set.
- **Compiler will catch** every `match user.role { Role::Student => ... }` site; explicitly handle the new variant. Audit `crates/syllabus-tracker/src/db/` for these.
- **Compiler will NOT catch** string-comparison queries. Explicitly update `crates/syllabus-tracker/src/db/reporting.rs:112` (`WHERE u.role = 'student'`) and any peer in `students.rs`, `users.rs` to use `IN ('student', 'footage_submitter_student')` — silent dashboard exclusion otherwise.

**Frontend**:
- Expand the `Role` union in `frontend/src/lib/api.ts:56` to include `"footage_submitter_student"`.
- Update `isCoachOrAdmin`/`isAdmin` helpers if any branching is needed; add `isStudentLike(user)` for the `=== 'student'` checks.
- Audit `frontend/src/components/navbar.tsx:38`, `frontend/src/app/admin/page.tsx:754`, `frontend/src/app/dashboard/page.tsx:73` and any other `user.role === "student"` site to use `isStudentLike(user)`.
- Add `hasPermission(user, name)` helper in `lib/api.ts`.
- "Promote to Footage Submitter" / "Revoke" actions on the coach view of a student profile. Badge on the profile header when the role is active.

**PR breakdown** (~3): (1) Backend `Role` variant + permission + `/api/me` permissions array + reporting.rs filter audit. (2) Frontend `Role` union expansion + `=== 'student'` audit + `hasPermission` helper. (3) Promote/revoke toggle + badge.

**Verify**: Coach promotes student; student's `/api/me` returns the new role and a `permissions` array containing `SubmitFootage`; coach revokes; badge disappears. Coach dashboard still lists the `FootageSubmitterStudent` in the roster (regression check on the reporting.rs filter).

---

### M3 — Visibility model refactor (foundation F1)

**Stories**: CX-019.

**Goal**: Decouple library/thread/pinned visibility from per-student syllabus overrides. Set up the call sites for a per-camp layer later (M8).

**DB**: Rename `video_student_visibility` → `syllabus_video_student_visibility`. No behaviour change for the syllabus view.

**API contract**: video-list and playback endpoints accept an optional `?ctx=` query parameter (`library`, `syllabus`, `camp:<id>`). The server validates that the caller can claim the named context (e.g. cannot pass `camp:<id>` for a camp that isn't theirs). When omitted, default is the implied context for the route (technique-list defaults to `library`, etc.).

**Backend**: Replace `video_visible_to_student` with a context-aware variant per F1. Audit and update every caller (start at `videos/routes.rs:511`, `:559`, `:323`; grep `video_student_visibility` and `video_visible_to_student`). Library context becomes "global hide only." `FootageSubmitterStudent` from M2 inherits the same visibility as `Student` — verify in the audit.

**Frontend**: Pass the context through video-fetching call sites. Update `frontend/src/lib/api.ts` video query helpers to take a `ctx` argument; update consumers in `/library`, `/student/<id>`, video pages.

**PR breakdown** (~3): (a) Add the new `syllabus_video_student_visibility` table alias and ship a context-aware predicate with the old predicate delegating to it — no behaviour change, verify call sites still pass. (b) Flip every call site to pass an explicit context; ship the API contract (`?ctx=`) and server-side validation. (c) Drop the legacy alias + complete the rename + `.sqlx/` regen.

**Verify**: Existing syllabus visibility behaviour unchanged. Coach hides a video from a student in syllabus → still hidden in syllabus → no change in library (library still gated by role at this point; opens in M4). Caller-supplied `?ctx=camp:N` for a camp that isn't the user's returns 403.

---

### M4 — Self-directed library access

**Stories**: SD-001, SD-002.

**Goal**: Students can browse the full global technique library and watch any non-globally-hidden video. Read-only. No pinning yet.

**Backend**: New `Permission::BrowseLibrary` granted to all roles. No `scope` column exists on `techniques` yet (lands in M8), so every technique in the library is global by definition pre-M8. When M8 adds `scope`, extend the library query then to exclude `scope='scoped'` techniques belonging to other students. Library video queries pass `?ctx=library` per M3.

**Frontend**: Refactor `frontend/src/app/library/page.tsx` (~1000 LOC, edit forms inlined) by extracting two components: `LibraryView` (read-only, both roles) and `LibraryEditingOverlay` (coach-only mutations). Drop the `RequireCoach` gate on `/library`, `/collections`, `/collections/:id`; route renders `LibraryView` for all roles + `LibraryEditingOverlay` for coaches/admins. Query key: existing `qk.libraryTechniques` reused.

**PR breakdown** (~3): (1) Backend permission + library-query `ctx=library` wiring. (2) Frontend extract `LibraryView` + `LibraryEditingOverlay` (no role change yet, parity-only refactor). (3) Drop route gate, students gain access.

**Verify**: Student logs in, navigates to `/library`, sees techniques + videos, can play any non-hidden video; cannot edit anything; coach experience unchanged.

---

### M4.5 — Collections → syllabuses rename (introduced by amendment)

> ✨ New milestone introduced by the [Plan amendment](#plan-amendment-2026-06-09--ia--data-model-reframe).

**Goal**: User-facing rename of "collections" to "syllabuses". No data-model change; SQL table names stay `collections` until M5c bundles the rename with the atomic data-model cutover.

**Scope and counts** (verified against the current codebase):
- 20+ backend / frontend files have substantive `collection` references. `db/collections.rs` (~72 hits) → renames to `db/syllabuses.rs`. Frontend `lib/api.ts`, `mutations.ts`, `query-keys.ts`, the `app/collections/` route, plus deep refs from `student-techniques/page.tsx`, `library/page.tsx`, `assign-techniques.tsx`, `add-techniques-to-collection-dialog.tsx`.
- `bin/seed.rs` (12 hits) and `crates/syllabus-tracker/src/test/utils.rs` need ripple updates so the seed binary and integration tests still pass.
- `frontend/scripts/manual-verify.mjs` references "collection" — verify script breaks otherwise.
- `db/reporting.rs` queries that join collections feed the dashboard — explicitly grep this file post-rename.

**Naming policy** (critical for the M4.5 → M5c window):
- **SQL identifiers stay verbatim** in raw query strings: `collections`, `collection_techniques`, `student_techniques.collection_id`. Don't fight the migrator.
- **Rust fn parameters and struct fields rename** to `syllabus_*`. Bridge with `AS syllabus_id` aliases in `SELECT` clauses (e.g. `SELECT collection_id AS syllabus_id FROM student_techniques`).
- Every raw SQL hit on `collection_id` after the rename must carry an inline comment pointing at decision #19 / M5c so a future reader knows it's the old name, not a new one.

**Scope**:
- Frontend: route `/collections` → `/syllabuses`, route `/collections/:id` → `/syllabuses/:id`. **Add a `<Navigate to="/syllabuses" replace />` redirect from `/collections` and `/collections/:id`** so any link a coach previously shared via Slack/iMessage still resolves. Type `Collection` → `Syllabus`. Variable names, hooks (`useCollections` → `useSyllabuses`), query keys. UI copy: "Collections" → "Syllabuses", "Collection" → "Syllabus". Plural is "syllabuses" everywhere — avoid "syllabi".
- Backend: API path `/api/collections` → `/api/syllabuses`. Rust types `Collection`/`CollectionResponse` → `Syllabus`/`SyllabusResponse`. `db/collections.rs` → `db/syllabuses.rs`. The Rocket routes use the new path; the legacy `/api/collections` paths are not preserved (only our frontend consumes them).
- **SQL stays as-is**: `collections`, `collection_techniques`, `student_techniques.collection_id` keep their current names per the naming policy above.
- Copy: anywhere we say "Add to collection" → "Add to syllabus". "Start from a syllabus" framing on the new-student / add-techniques flows.

**PR breakdown** (~4): (1) Backend rename (paths, types, file rename) + `sqlx-prepare`. (2) Frontend lib + API helpers + queries/mutations/keys rename. (3) Page / component / copy rename + `/collections` → `/syllabuses` redirect routes. (4) `bin/seed.rs` + `test/utils.rs` + `frontend/scripts/manual-verify.mjs` ripple updates.

**Verify**:
- All existing collection workflows still work end-to-end under the new vocabulary; no behaviour change.
- `cargo nextest` passes; `pnpm exec tsc -b` clean; manual `seed` binary runs against an empty DB and produces a populated dev set.
- `rg -n collection crates/syllabus-tracker/src/db/reporting.rs` returns zero non-comment hits.
- `rg -n "/collections" frontend/src` returns only the `<Navigate>` redirect pair (no surviving callers).
- Old links: navigating to `/collections/3` redirects to `/syllabuses/3` and renders.

---

## Phase 2 — Student profile multi-tab + pinning

### M5a — Student profile tabs scaffold + item-shaped activity feed v1

> ⚠️ **Amended 2026-06-09** — what was originally "M5" is now M5a, joined by M5b and M5c. This section describes M5a as **shipped** (GH PRs #12 + #13). M5b ([cards + filter chips + syllabus extraction](#m5b--feed-as-cards--filter-chips--syllabus-extraction-introduced-by-amendment)) and M5c ([atomic data-model cutover](#m5c--atomic-data-model-cutover-per-syllabus-progress-introduced-by-amendment)) layer on top.

**Stories**: CX-020 (full), CX-003 (basic, item-shaped per pending decision #11), CX-015.

**Goal**: Restructure the student profile into Activity / Syllabus / Pinned / Camps tabs. Activity is the default tab and renders **one row per top-level item** (per pending decision #11) from day one — same shape M18 polishes, never a reshape. Item kinds present at M5: `technique` (anything in syllabus or with attempts), `rank_change` (one-off, no dedup).

**DB**: No new tables. The feed query groups events by parent item and selects the most-recent activity per item. Rank changes are one-off items (no dedup), keyed by `rank_audit.id`.

**Backend**: New `GET /api/students/<id>/feed` returning items with `kind`, `item_id`, `latest_activity_at`, `latest_activity_preview`. **Parent-resolution rules at M5**:
- An attempt → its `student_technique.technique_id`, surfaced as a `technique` item.
- A status change on `student_technique` → same.
- A rank change → its own one-off item.

Each subsequent milestone that introduces a new feed-relevant event names its parent-resolution rule. M18's polish unions per-kind queries; it does not reshape M5's output.

Any coach role can read any student's feed (CX-015); students can only read their own.

**Frontend**:
- **Tab state in URL search params** (`?tab=activity|syllabus|pinned|camps`), matching `student-techniques/page.tsx:170-178`. NOT `useState` like `dashboard/page.tsx:192`. CX-020 requires deep-links.
- Wrap the existing syllabus page in a `Tabs` container. Move technique list into the Syllabus tab. Add Activity (default), Pinned (placeholder), Camps (placeholder). Deep-links like `/student/<id>?focus=...` land on the Syllabus tab automatically.
- Activity tab renders one row per item with the latest activity as a preview. No filter chips, no search, no unseen divider yet (M18). Item types `technique` and `rank_change` only.

**Query keys**: `qk.studentFeed(studentId, { kinds? })`, `qk.studentProfile(studentId)`.

**PR breakdown** (~3): (1) Tab scaffold with URL-param state + Syllabus tab move + Pinned/Camps placeholders. (2) Feed endpoint + item-shape rendering + parent-resolution for `technique` and `rank_change`. (3) CX-015 coach-views-any wiring + reading-state sanity check.

**Verify**: Existing syllabus deep-links still work; tab survives reload via URL; Activity tab shows one row per technique even when several attempts hit the same technique; rank change appears as its own one-off row; coach loads `/student/<otherId>?tab=activity` and sees the other student's feed.

---

### M5b — Feed-as-cards + filter chips + syllabus extraction (introduced by amendment)

> ✨ New milestone introduced by the [Plan amendment](#plan-amendment-2026-06-09--ia--data-model-reframe). Layers on top of M5a (which already shipped as GH PRs #12 + #13). **M5b is honestly 3 milestones-of-work split into M5b1 / M5b2 / M5b3 below**; the rubber-duck review caught that the original "~3 PRs" estimate undercounted by ~2x.

**Goal**: Activity feed becomes the primary view at `/student/<id>` as a card layout (Twitter / Instagram style, infinite scroll). The four parallel tabs from M5a collapse into filter chips on the same feed surface (Activity / Pinned / Camps / etc — chip semantics, not view-swap). Syllabus exits the tab set entirely and gets its own route at `/student/<id>/syllabus`.

**Stories**: CX-020 (revised), CX-004 (filter chips, pulled forward from M18).

**Routes**:
- `/student/<id>` (was: profile with tabs) → activity feed home. Prominent "View syllabus" button at the top below the rank strip.
- `/student/<id>/syllabus` (NEW) → the existing syllabus content (techniques list, RAG status, filters, attempts). All of the content currently inside M5a's "Syllabus" `TabsContent` moves here as its own route component.

**Frontend data contract** (must be defined before extraction):
- `/student/<id>` feed page reads: `useStudentFeed(studentId, {kinds, cursor})` + a new `useStudentProfileHeader(studentId)` (rank strip + footage badge fields). Does NOT read `useStudentTechniques`.
- `/student/<id>/syllabus` syllabus page reads `useStudentTechniques(studentId)` exactly as today — preserves all existing filter / expansion / dialog state.
- The issued-claim-link panel (`student-techniques/page.tsx:961-988`) **stays at profile root `/student/<id>`**, not the syllabus page; it belongs to the student's identity, not their progress.

### M5b1 — Route extraction + feed endpoint pagination

**Goal**: Surgical move of the existing M5a Syllabus tab content into its own route at `/student/<id>/syllabus`. Backend feed gets paginated. No card layout yet; no chips yet. Status quo for the visible feed surface.

**Backend**:
- Add cursor pagination to `GET /api/student/<id>/feed`: `?after=<NaiveDateTime>&limit=<n=25>`. Today's `db/feed.rs` reads everything; rewrite the sort-in-app pattern as a per-kind `UNION ALL` plus `WHERE latest_activity_at < ?after ORDER BY latest_activity_at DESC LIMIT ?limit`.
- New supporting indexes — required NOW even though M18 originally owned them: `idx_attempts_for_feed` on `attempts(student_technique_id, attempted_at DESC)` (already exists at `:157`), confirm `idx_rank_audit_user_changed` covers the rank-side `WHERE user_id = ? ORDER BY changed_at DESC`.
- Endpoint signature: returns `{items: FeedItem[], next_cursor: NaiveDateTime | null}` so the frontend can chain pages.

**Frontend**:
- Add `/student/<id>/syllabus` as a lazy route. Move the syllabus content (h2 + attempts summary + action buttons + filters + technique list) into a new component `app/student-techniques/syllabus-page.tsx` (or whatever the cleanest extraction).
- Profile root `/student/<id>` keeps the existing tab scaffold for one PR (transitional) but the Syllabus tab redirects to `/student/<id>/syllabus`.
- Deep link rewrite: `activity-feed.tsx:103` currently emits `?profile_tab=syllabus&focus=...`. Rewrite to `/student/<id>/syllabus?focus=...`.

**PR breakdown** (~3): (1) Pagination on backend + new endpoint contract + sqlx-prepare. (2) Extract syllabus content to its own route + claim-link panel placement decision. (3) Rewrite feed item deep-links.

### M5b2 — FeedCard family + dropping the tab container

**Goal**: Convert the connected-list rows in `activity-feed.tsx` to per-kind standalone Cards. Drop the `Tabs` wrapper from `/student/<id>` entirely. No infinite scroll yet (still one page of items).

**Frontend**:
- Add `frontend/src/app/student-techniques/components/feed-cards/` directory: `technique-feed-card.tsx`, `rank-change-feed-card.tsx`, plus a shared `FeedCardShell` (border / padding / hover affordances). Future milestones add `pinned-feed-card.tsx`, `camp-feed-card.tsx`, etc.
- Each card uses shadcn `Card` / `CardHeader` / `CardContent` primitives — already in the project. No new shadcn imports needed.
- Drop the `Tabs` / `TabsList` / `TabsContent` from the profile root. The page becomes: profile header + "View syllabus" button + feed cards.

**PR breakdown** (~2): (1) FeedCard family extraction + card components. (2) Drop tabs container + flatten profile root.

> ⚠️ **Superseded by 2026-06-10 amendment.** The "FeedCard family" framing is replaced by `ActivityFeedItem` wrapper cards with slim-mode child renderers. See M5b2' below for the operative work; M5b2's "Drop tabs container + flatten profile root" step survives there as M5b3'.

### M5b2' — Activity feed extraction to its own route (introduced by 2026-06-10 amendment)

**Goal**: Lift the activity feed out of the profile tab into its own top-level route. Introduce the `ActivityFeedItem` wrapper card concept with kind-specific slim-mode child renderers.

**Routes**:
- `/activity` — current user's activity feed (students land here from the bottom nav).
- `/student/:id/activity` — coach view of any student's feed. Internally same page, different `id` from URL params.
- `/student/:id` (legacy) — redirects to `/student/:id/activity` per decision #25.

**Frontend**:
- New `frontend/src/app/activity/page.tsx` (or `student-activity/page.tsx` mirroring `student-pins/`). Renders `<StudentHeaderStrip>` (decision #24) at top + feed body.
- New `frontend/src/components/feed/activity-feed-item.tsx` — the wrapper card. Uses shadcn `Card` primitives. Composes one or more child components via children prop or per-kind dispatch.
- New `frontend/src/components/feed/technique-slim.tsx` — slim renderer for a technique-kind feed item. Reuses the shared base data shape; renders technique name + activity-relevant context (which syllabus / video / thread tripped the item). Does NOT render the full library expanded body.
- New `frontend/src/components/feed/rank-change-slim.tsx` — slim renderer for rank-change items.
- Existing `student-techniques/components/activity-feed.tsx` (in the profile tab) gets retired as part of this PR; the new page picks up its content and rewrites it through `<ActivityFeedItem>`.
- Bottom-nav for students gains an Activity entry (between Library and Pins or in front of Library, design TBD).

**Backend**: no changes for slim-mode rendering. `GET /api/student/<id>/feed` already returns item-kind. Pagination plumbing (cursor) lifted from M5b1 stays as-is.

**Auth**: same model as `/pins` — own view always allowed; viewing another's activity requires coach/admin. The page guards with `isCoachOrAdmin(user)` when the URL `id` differs from `user.id`, matching `student-pins/page.tsx`.

**PR breakdown** (~3): (1) New route + page skeleton + `<StudentHeaderStrip>` extraction; redirect `/student/:id` → `/student/:id/activity`. (2) `<ActivityFeedItem>` wrapper + technique-slim + rank-change-slim renderers. (3) Bottom-nav Activity entry + retire the profile-tab `activity-feed.tsx` usage.

**Verify**: Student logs in, lands on dashboard, taps Activity in bottom nav, sees their feed as cards. Coach navigates from a student row to `/student/:id/activity`, sees the same feed. Tapping a feed card lands on the syllabus / video / thread the item was about.

### M5b3' — Drop the profile-tabs container (introduced by 2026-06-10 amendment)

**Goal**: Remove the `<Tabs>` container from `/student/:id` entirely. The page exists only as a redirect to `/student/:id/activity`.

**Frontend**:
- `student-techniques/page.tsx` becomes a thin redirect component, OR the route registration changes to use `<Navigate>` directly.
- Existing tabs (Activity / Syllabus / Pinned / Camps) all have their own routes by this point. The Camps tab (still a placeholder) gets dropped — Camps page lands in M8.
- Shared `StudentHeaderStrip` from M5b2' is reused by `/student/:id/syllabus`, `/student/:id/pins`, `/student/:id/activity` so chrome stays consistent.
- Drop the in-profile `useStudentTechniques` / `useStudentFeed` calls that the tabs used; each new route owns its own data loading.

**PR breakdown** (~2): (1) Convert `/student/:id` to a redirect; pull the rank strip out of the tabbed page. (2) Delete the Tabs scaffold + tab-content components no longer used; verify no dead imports.

**Verify**:
- Navigating to `/student/:id` lands on `/student/:id/activity`.
- Deep links like `/student/:id?focus=42` legacy URLs redirect with the query preserved (so the syllabus tab focus still works after redirect to `/student/:id/syllabus?focus=42`). The redirect logic checks for legacy `?profile_tab=` / `?focus=` query params and rewrites accordingly.
- The page is otherwise unreachable; bottom nav for students still has Dashboard / My techniques / Library / Pins / Activity (or whatever order is final after M5b2' design).

### M5b3 (original — chips + infinite scroll) — scope-shrunk

> ⚠️ **Amended 2026-06-10**: filter chips no longer function as "view-switching tabs" — pinned / camps lifted to their own routes. Chips are kept as kind filters WITHIN the activity feed (techniques / rank changes / future kinds). Infinite scroll and Framer Motion stay.

**Backend**:
- Extend `GET /api/student/<id>/feed?kinds=technique,rank_change` to accept a comma-separated kind filter. Multi-select OR semantics.

**Frontend**:
- Add `framer-motion` to `frontend/package.json`. Reuse later for M19 / M20.
- New `useInfiniteFeed(studentId, {kinds})` hook wrapping TanStack's `useInfiniteQuery`. Cursor field is `latest_activity_at`. `getNextPageParam` returns `lastPage.next_cursor || undefined`.
- New `InfiniteList<T>` component (or hook) wrapping `IntersectionObserver` for the "load more on scroll" trigger. Reusable for future card lists (camps, threads, etc).
- Filter chip row above the feed using shadcn `Badge` with active/inactive variants. URL state via `?kinds=` searchParam.
- Chip toggle animation: `motion.div` wrapping each card with `layout` and `animate={{ opacity: 1 }} initial={{ opacity: 0 }} exit={{ opacity: 0 }}`.

**Query key** update: `qk.studentFeed(studentId, {kinds, cursor})` — extend M5a's key to carry the new params.

**PR breakdown** (~3): (1) Framer Motion dep + `useInfiniteFeed` hook + backend `?kinds=` filter. (2) Filter chip row + URL state plumbing. (3) Chip-toggle animation + verify pass on mobile viewports.

### M5d — Unified TechniqueRow base component (introduced by 2026-06-10 amendment)

**Goal**: Merge the syllabus-side `TechniqueRow` (in `student-techniques/components/technique-row.tsx`) and the library-side `LibraryTechniqueRow` (in `components/library-technique-row.tsx`) into a single shared component the surfaces overlay context onto.

**Why M5d, not now**: the data shapes are different — `LibraryTechniqueRow` data has student / video counts; `Technique` (= `StudentTechnique`) has status / attempts / notes plumbing. A unified component needs a normalized intermediate type plus a refactor of the syllabus row's `StatusToggle` / `NotesEditor` / `AttemptsList` to participate in the base. The PR #25 work uses two adjacent components that follow the same UX pattern; this milestone finishes the consolidation.

**Frontend**:
- Define a `TechniqueCardData` shape that's the union of fields any surface might need. Library rows omit `student_technique` data; syllabus rows include it; pinned rows include partial student_technique data if there's a syllabus assignment for the pair.
- New base component at `frontend/src/components/technique-row.tsx` (consolidates the existing two). Renders a header + expandable body with overlay sections gated by which fields exist on the data.
- Library page, Pins page, Syllabus page all consume the new base. Existing surfaces fall over via incremental adoption — one surface per PR, with a feature flag toggle if needed for safety.

**PR breakdown** (~4): (1) Define the unified data shape + a new base component without flipping any consumers. (2) Library page flips to it. (3) Pins page flips to it. (4) Syllabus page (the gnarliest, has StatusToggle / NotesEditor / AttemptsList) flips to it. Drop the two legacy components.

**Verify**: Each surface looks pixel-identical to its pre-flip state for at least the screenshot path the user has provided feedback on. No behaviour regressions on attempts logging / status changes / notes editing in the syllabus page.

---

### M5c — Atomic data-model cutover: per-syllabus progress (introduced by amendment)

> ✨ New milestone introduced by the [Plan amendment](#plan-amendment-2026-06-09--ia--data-model-reframe). The single most coordinated PR in the roadmap.

**Goal**: Replace the `student_techniques` model (techniques assigned individually to a student) with the new model: syllabuses as standalone entities, students "doing" multiple syllabuses, per-`(student, syllabus, technique)` progress. Existing prod data migrated manually as part of the cutover.

**Stories**: not directly tied to a CSV story; this is a foundational data-model change required by amendment decisions #16, #18, #21, and #22.

**DB** (atomic migration):
- Rename `collections` → `syllabuses` (and the related `collection_techniques` → `syllabus_techniques`).
- New `student_syllabuses` table: `(id, student_id, syllabus_id, assigned_at, assigned_by_id, archived_at NULL)`. Records "this student is doing this syllabus". A student can have multiple active rows.
- New `student_syllabus_techniques` table: `(student_syllabus_id, technique_id, status, last_coach_update_at, last_coach_update_by_id, last_student_update_at, last_student_update_by_id, attempt_count_cache)`. Per-`(student, syllabus, technique)` progress. **No `notes_*` columns per decision #21** — notes live in `technique_notes` keyed `(student, technique)`, shared across all contexts. PK on `(student_syllabus_id, technique_id)`.
- `attempts.student_technique_id` is **rewritten in place** (not adding a new column): the FK target switches from `student_techniques(id)` to `student_syllabus_techniques(id)`. SQLite requires the rebuild-table dance via the migration engine; the runbook below names this as an explicit step.
- `student_technique_views.student_technique_id` also rewritten in place to point at `student_syllabus_techniques`. Existing rows mapped via the same migration script.
- Existing `student_techniques`, `collections`, `collection_techniques`, `student_techniques.collection_id` are all **dropped at the end of the cutover** after data is migrated.

**Migration runbook** (write it before code, treat it like a deployment script):

1. **Pre-flight on the staging fork** (separate PR, days before the real cutover): full dry-run of the migration script against a fresh fork of prod data. Verify row counts match before / after, spot-check ~10 students with mixed progression for fidelity.
2. **Pre-cutover SQL backup**. Litestream snapshot the prod DB to an off-host R2 location. This is the rollback artefact.
3. **Engage maintenance mode**. App is set to return 503 for all non-health routes. Add a `MAINTENANCE_MODE` env-var read by Rocket at startup; the existing `prep_host` step in the deploy workflow flips it. (TODO: confirm Rocket gracefully reloads or needs a restart.)
4. **Add new tables** alongside `student_techniques` via the declarative migrator. Additive only at this step; old reads still work.
5. **Run the one-off migration binary** (`bin/migrate_to_syllabus_model`). For each existing student:
   - Iterate their `student_techniques` rows.
   - Decide each row's target syllabus: `collection_id IS NOT NULL` maps 1:1 to the renamed `syllabuses` table; `collection_id IS NULL` rows bucket into a new per-student "Imported progression" syllabus created during the run.
   - Insert `student_syllabuses` + `student_syllabus_techniques` rows. Status, last-update timestamps carry over verbatim.
   - **Notes pass**: copy any `student_techniques.student_notes` / `coach_notes` into a `technique_notes` row keyed `(student_id, technique_id)` — that table already exists from M6 schema (PR #14). If a `technique_notes` row already exists for the pair (pinned-only writes from M6), merge into it: take the more recent timestamp, concat notes if both non-empty.
   - **Attempts FK rewrite**: build an in-memory map `old_student_technique_id` → `new_student_syllabus_technique_id`. `UPDATE attempts SET student_technique_id = ?` in batches; use SQLite's `UPDATE ... FROM (SELECT old, new FROM map_table)` (SQLite 3.33+).
   - **Views rewrite**: same pattern for `student_technique_views.student_technique_id`.
6. **Rebuild-table dance** for the FK target switch. SQLite needs: create `attempts_new` with the new FK, copy rows, drop `attempts`, rename `attempts_new` → `attempts`. The migration engine has a precedent for this (`reorder-columns` style migrations); cross-reference.
7. **Deploy the new app code**. Schema check at startup verifies the new shape; old tables are dropped in this same migrate pass.
8. **Disengage maintenance mode**. Smoke-test the dashboard, a coach's view of a student, a student's own syllabus page, the feed.
9. **Rollback path**: if any step fails before the new app code is up, run a script to drop the new tables (the additive part). If failure is after the FK rewrite, restore the pre-cutover Litestream snapshot AND revert the app image — these must move together, do not partially restore.

**Backend**:
- Every read against `student_techniques` rewrites to the new tables. The Rocket route surface mostly survives but the response shape changes: instead of returning a flat list of techniques per student, we return a list of `(syllabus, techniques[])` groups for the syllabus page; the feed page query groups by `(student_id, technique_id)` per decision #22, aggregating syllabuses.
- The feed `technique` item gets a new `syllabuses: [{id, name, status}]` sub-array so a card can show "Blue Belt Fundamentals · No-Gi Fundamentals" and which one tripped the latest activity.
- `db/feed.rs` rewrites: `SELECT FROM student_syllabus_techniques sst JOIN student_syllabuses ss ON sst.student_syllabus_id = ss.id WHERE ss.student_id = ?` replaces today's `student_techniques` scan; group in app code by `(student_id, technique_id)` aggregating syllabuses per decision #22.
- `db/reporting.rs` dashboard query: `has_unseen_activity` join migrates from `student_techniques.last_student_update_at` to `MAX(student_syllabus_techniques.last_student_update_at)` per `(student_id, technique_id)` group.

**Frontend**:
- `/student/<id>/syllabus` becomes `/student/<id>/syllabuses` (plural — student can have multiple). Each syllabus renders as a section with its own technique list + RAG bar.
- A "Start a new syllabus" affordance lets a coach assign another from the per-student page or from the new student creation flow.
- The feed gets a new card kind for "Syllabus started" / "Syllabus archived" events.

**PR breakdown** (~7): (1) New tables + the migration binary; verify against the staging fork. (2) Backend reads rewritten; existing endpoints adapted; integration tests against the new shape. Server still reads from old tables in prod (new tables exist but unused) — this PR is a "shadow build" lifted by feature flag. (3) Frontend reads rewritten; syllabuses page handles multiple; per-syllabus sections. (4) New feed item kinds + the `(student_id, technique_id)` aggregation grouping rule. (5) Notes-pass: copy notes from `student_techniques.{student,coach}_notes` into `technique_notes` (merging with any existing pinned-context rows). (6) Maintenance-mode infrastructure: env var, Rocket-level guard, deploy.yaml flip step. (7) **Atomic cutover day**: 503 mode, migration binary, new image deploy, old tables dropped.

**Verify**:
- Staging fork: full dry-run completes; row counts match; spot-check ~10 students.
- Existing prod students keep their progress (status, notes, attempts) intact after migration.
- Coaches can assign a second syllabus to an existing student and track progress separately on shared techniques.
- Notes typed in the syllabus page show up in the pinned view of the same technique (decision #21).
- A technique in two syllabuses shows as ONE feed card with both syllabuses in the sub-title (decision #22).
- Dashboard `has_unseen_activity` lights up correctly after a student edits a syllabus note.
- Rollback path tested end-to-end on the staging fork BEFORE cutover day.

**Risks** (revisit before kickoff):
- The "Imported progression" auto-syllabus bucket for ad-hoc-assigned techniques is lossy. Acceptable for now but document the heuristic in the migration runbook.
- The cutover is coordinated. Pick a low-traffic window and pre-announce.
- The FK rebuild-table dance for `attempts` (108 call sites of `attempts.student_technique_id` today) is the most error-prone step. Bench it on the staging fork first.
- Tests / fixtures across the codebase reference `student_techniques` shapes; a wholesale rename of test fixtures rides along.
- The notes-merge step in the migration script needs a deterministic conflict-resolution rule (most-recent timestamp wins; concat both texts if both non-empty). Document it.

---

### M6 — Pinning + shared notes refactor

> ⚠️ **Amended 2026-06-09** — see [Plan amendment](#plan-amendment-2026-06-09--ia--data-model-reframe). Per decision #21, `technique_notes` (already created in GH PR #14) IS the canonical notes store across syllabus / pinned / camp contexts. The dual-read shim against `student_techniques.{student,coach}_notes` becomes a one-shot migration during M5c: the migration script copies legacy notes into `technique_notes`, merging with any pinned-context rows.
>
> **Followup**: the schema comment at `config/schema.sql:52-58` in PR #14 still describes the table as "shared across syllabus / pinned / camp" which now aligns with decision #21 — no change needed. The original "shim then drop" intent is replaced by "copy at cutover".

**Stories**: SD-003, SD-004, SD-006, SD-008, SD-009, SD-015, SD-014 (profile header strip only; dashboard signal stays in M21).

**Goal**: Students can pin techniques from the library to a personal "working on" list. Notes are now shared per `(student, technique)` across syllabus, pinned, and (future) camp views. Syllabus context surfaces on the pinned view with a hide toggle. Profile gets a "recently working on" header strip surfacing pins. Graduated students retain full read-only syllabus + interactive ongoing-use surfaces (per pending decision #8).

**DB** (per pending-decision #3, shape B):
- New `pinned_techniques` table: `(id, student_id, technique_id, pinned_at, unpinned_at NULL)`.
- New `technique_notes` table: `(student_id, technique_id, student_notes, coach_notes, last_student_update_at, last_coach_update_at, last_*_by_id)`. PK is `(student_id, technique_id)`.
- Migrate existing `student_techniques.student_notes/coach_notes/last_*` into `technique_notes`. Read both during a transition window; write only to `technique_notes` from this milestone onward; drop the old columns at M16 cleanup.

**Migration ripple**: the dashboard `has_unseen_activity` query (`crates/syllabus-tracker/src/db/reporting.rs:78-97`) joins `student_techniques.last_*_update_at`. The new query has to join `technique_notes` on `(student_id, technique_id)` instead, or compute `MAX(last_update_at)` across both tables during the transition window. Mark this work in the migration PR explicitly so the dashboard regression is caught.

**Backend**: `POST /api/students/<id>/pin/<technique_id>`, `DELETE /api/students/<id>/pin/<technique_id>`. Pin emits an activity-feed item; unpin does NOT. Existing notes reads/writes route through the new table. Profile aggregator endpoint returns recent pins for the header strip (SD-014).

**Frontend**: Populate the Pinned tab from M5 with the student's pinned techniques. "Pin" button on the library technique view (student-only). On the pinned-technique detail view, surface syllabus context (status, attempts, original syllabus notes) with a toggle (SD-009). For graduated students, the Syllabus tab renders read-only; Pinned tab stays interactive. Profile header strip shows "Recently working on: X, Y, Z" with links.

**PR breakdown** (~5): (1) `technique_notes` table + dual-read on notes consumers (`db/student_techniques.rs`) — writer still goes to `student_techniques.{student,coach}_notes`. (2) Cut writer over to `technique_notes`; rewrite the dashboard `has_unseen_activity` join in `reporting.rs:78-97` to use the new table; regression-test the dashboard. (3) `pinned_techniques` table + pin/unpin endpoints + library "pin" button. (4) Pinned tab content + syllabus-context surfacing (SD-008) + profile header strip (SD-014 surface). (5) Toggle (SD-009), graduated read-only behaviour (SD-015), activity-feed wiring for pins (parent-resolution: pin event → `technique` item; same row as syllabus-source activity, just bumped).

**Query keys**: `qk.studentPins(studentId)`, `qk.techniqueNotes(studentId, techniqueId)`, `qk.studentProfileHeader(studentId)`.

**Verify**: Student pins a library technique; it appears on their Pinned tab and in their activity feed; edits to notes in syllabus view show up in pinned view and vice versa; unpinning does NOT bump the feed; graduated student cannot toggle status.

---

## Phase 3 — Video architecture & camps

### M7 — Video parent polymorphism (foundation F2)

**Stories**: F2 foundation; no user stories complete in this milestone. CX-018 is split: schema lands here, the upload UX lands in M7.5.

**Goal**: Schema-level parent polymorphism. Every existing query and pipeline call site moves to the new shape. No new user-facing behaviour ships at M7 — the inbox + loose-upload UX is M7.5. Splitting protects the migration: M7 is purely structural so any regression surfaces immediately on existing surfaces (technique videos still play, hide, delete).

**DB**: Per F2. Existing rows migrate to `parent_kind='technique'`, `parent_id=technique_id`. New per-kind indexes replace `idx_videos_technique_position` and `idx_videos_alive_by_technique`. `technique_id` column stays populated for backward-compat reads through M16 cleanup.

**Backend**:
- All video DB queries in `crates/syllabus-tracker/src/db/videos.rs` filter by `(parent_kind, parent_id)` instead of (or in addition to) `technique_id`.
- Pipeline change: `process_uploaded_video` and friends (`videos/routes.rs:411-417, :459`) extended to accept `(parent_kind, parent_id_opt)`. The branch in `:411-417` that currently treats `Option<i64>` as `Some(tid)`-only updates to dispatch on `parent_kind`.
- Models: `Video` and `DbVideo` (`crates/syllabus-tracker/src/db/models.rs:196+`) gain `parent_kind` and `parent_id` fields; `technique_id` stays in the struct as a back-compat helper that maps from `(parent_kind='technique', parent_id)`.
- Existing endpoints continue to work. Loose upload endpoint does NOT ship in M7.

**PR breakdown** (~3): (1) Schema migration + model + sqlx regen + `technique_id` back-compat shim. (2) Every video DB function in `videos.rs` updated to filter by `(parent_kind, parent_id)`. (3) Pipeline signature change + every video route updated to pass parent kind explicitly (technique endpoints pass `parent_kind='technique'`).

**Verify**: Existing technique videos still play / list / hide / delete as before. Schema check at startup passes. `.sqlx/` cache rebuilds cleanly. No new endpoint surfaces — exclusively a structural refactor.

---

### M7.5 — Loose uploads + categorized picker scaffold

**Stories**: CX-018 (full).

**Goal**: Coaches can upload a loose video and find it later. The categorized video picker lands as a living component: M7.5 ships the empty scaffold, M9/M12/M14/M17b each contribute one more data source as their parent kinds populate.

**Backend**: New `POST /api/videos/upload` (no parent — sets `parent_kind='loose'`, `parent_id=NULL`) gated by `UploadVideos`. New `PUT /api/videos/<id>/attach` to set the parent after the fact (used by M9 and M12). New `GET /api/videos?parent_kind=loose` for the inbox listing with search params (`uploader_id`, `from_date`, `to_date`, `title_substring`).

**Frontend**:
- New `/library/loose` page (coach-only) listing unattached videos. Reuses the existing video-card component from `LibraryView`.
- New component `frontend/src/components/videos/categorized-video-picker.tsx`. Props: `{ parentKinds: VideoParentKind[]; query: string; onSelect: (video) => void }`. **Returns empty arrays for kinds whose data sources land later** (camp, match, profile come in M8/M9/M12; thread in M13). The picker shows tabs per kind with "no videos yet" empty states for un-populated kinds.

**Query keys**: `qk.looseVideos({uploaderId, from, to, q})`, `qk.videoPicker({kinds, q})`.

**PR breakdown** (~3): (1) Loose upload endpoint + `?parent_kind=loose` listing endpoint + attach endpoint. (2) `/library/loose` inbox page. (3) Categorized picker skeleton component + types.

**Verify**: Coach uploads a loose video via `/library/loose`. Inbox lists it with metadata. Picker renders with the `loose` tab populated; other tabs show empty state.

---

### M8 — Generic camps + camp techniques + per-camp visibility + route-module convention

> ⚠️ **Amended 2026-06-09** — decision #17 confirms `camp_techniques` does NOT carry a status column. M8's existing DB schema (`camp_techniques(camp_id, technique_id, position)`) already matches this; this note is documentation-only — no fields to drop. The amendment's real M8 impact lives upstream of the schema: any "RAG donut" / "status pill" UI surface on camp detail is out of scope; camp focus is videos / notes / matches.
>
> The original "Camps tab" framing in the Frontend section below is also superseded by decision #16 — the Camps surface is now a filter chip on the feed (`?kinds=camp` on the feed query) plus the `/camps/<id>` detail route, not a parallel tab.

**Stories**: CC-001, CC-008, CC-009, CC-010, CC-015.

**Goal**: Coach creates generic camps for a student. Camp has techniques, picked from the global library or created fresh as either global or camp-scoped. The per-camp visibility table lands here so M9 stays focused on upload UX. **M8 also introduces the sub-module route-organisation convention** (`camps::routes`) that every subsequent resource milestone follows.

**DB**:
- `camps` table: `(id, student_id, coach_id, name, description, created_at, archived_at NULL)`. Per pending decision #13 and reviewer feedback: `competition_id` and `references_camp_id` columns are added in M11 / M17a respectively, not pre-baked here. Less unused-column debt.
- `camp_techniques` table: `(camp_id, technique_id, position)`.
- `techniques` gets `scope TEXT NOT NULL DEFAULT 'global'` and `scoped_camp_id INTEGER NULL` (only meaningful when `scope='scoped'`). Library queries (M4) updated to exclude scoped techniques belonging to other students.
- `camp_video_visibility` table: `(camp_id, video_id, visible BOOLEAN, set_by_id, set_at)`. Layered on top of `videos.hidden_at`. Visibility guard (M3) extended with the `Camp(camp_id)` context now, even though uploads to camps come in M9.

**Indexes**: `idx_camps_student_active` on `camps(student_id, archived_at)`, `idx_camp_techniques_camp_position` on `camp_techniques(camp_id, position)`, `idx_techniques_scope` on `techniques(scope, scoped_camp_id)`, `idx_camp_video_visibility_camp` on `camp_video_visibility(camp_id)`.

**Backend**:
- New `crates/syllabus-tracker/src/camps/` module (`mod.rs`, `routes.rs`, `db.rs`) — first use of the sub-module convention introduced as a cross-cutting rule. `main.rs` mounts via `.mount("/api", camps::routes())`. Document the convention in the module's `mod.rs` doc-comment.
- Camp CRUD endpoints. `POST /api/camps/<id>/techniques` reuses the autocomplete shape from the syllabus picker. Technique creation inside a camp requires an explicit `scope` choice (no silent default — error if missing).
- Coach UI endpoint to set `camp_video_visibility` on library videos.
- All handlers carry `#[instrument]`.

**Frontend**:
- Populate the Camps tab on the student profile (placeholder from M5) with a list of the student's camps. New `/camps/<id>` page (lazy route) for camp detail (techniques list, no videos yet — those land in M9). Library page shows a "scoped" badge for camp-scoped techniques in the coach view (via `LibraryView` extension from M4). Coach UI in camp detail to hide/unhide individual library videos for the camp.
- Feed integration: camp items now appear in the M5 feed. Parent-resolution: camp create / add-technique / hide-video event → `camp` item (one row per camp, regardless of activity count).

**Query keys**: `qk.camps(studentId)`, `qk.camp(id)`, `qk.campTechniques(campId)`, `qk.campVideoVisibility(campId)`.

**PR breakdown** (~6): (1) Sub-module convention + schema (camps, camp_techniques) + camp CRUD endpoints. (2) Camp detail page + Camps tab content. (3) `camp_techniques` add/remove + autocomplete picker + `qk.campTechniques` key. (4) `scope` column on techniques + scoped technique creation flow + library-query exclusion update. (5) `camp_video_visibility` table + camp-context guard wiring + hide/unhide UI. (6) Feed integration: camp item kind + parent-resolution.

**Verify**: Coach creates a generic camp; adds existing library techniques; creates a new technique scoped to the camp; the scoped technique does NOT appear in the global library list for other students; coach hides a library video for camp A and the student still sees it in their syllabus; camp appears as its own row in the student's activity feed.

---

### M9 — Camp video uploads + cascade decision

**Stories**: CC-016, CC-017, CC-018, CC-019.

**Goal**: Videos can be uploaded directly to a camp, to a student's profile, or to a camp technique with a scope choice. Loose videos (M7.5) can be attached after the fact. The categorized picker (M7.5) gains its first concrete data sources (camp, profile videos).

**DB**: Video parent kinds used: `camp` (CC-016), `profile` (CC-017). Camp-technique uploads land on the global technique (`parent_kind='technique'`) if promoted, or on the camp (`parent_kind='camp'`) if scoped.

**Cascade decision (F2)**: deleting a camp re-parents its `parent_kind='camp'` videos to `parent_kind='profile'` with `parent_id=student_id` (videos survive the camp's deletion); `camp_video_visibility` rows for that camp hard-delete. Documented here per resolved decision #13.

**Backend**:
- Upload endpoints accept a parent specifier.
- `PUT /api/videos/<id>/attach` (built in M7.5) reused for loose → camp / profile / camp-technique flows.
- **Footage Submitter gating**: new upload endpoints check `Permission::SubmitFootage` (per pending decision #10). Note on composition: `SubmitFootage` replaces `UploadVideos` on these new endpoints. Coach + Admin implicitly hold it via their permission sets. Verify exercises `FootageSubmitterStudent` (allow) and plain `Student` (deny).
- All handlers `#[instrument]`.

**Frontend**:
- Upload buttons on camp detail page, camp-technique view (with scope radio when the parent technique is global), and student profile.
- Buttons render conditionally via `hasPermission(user, 'SubmitFootage')` (from M2's infrastructure).
- Categorized picker (M7.5) gains `camp` and `profile` data sources. Loose videos shown in the picker's `loose` tab when attaching.

**Query keys**: `qk.profileVideos(studentId)`. Camp video queries extend `qk.camp(id)`.

**PR breakdown** (~4): (1) Camp upload endpoint + UI + picker `camp` data source enrichment. (2) Profile upload endpoint + UI + picker `profile` data source enrichment. (3) Camp-technique upload with scope-choice + attach-loose flow. (4) Cascade behaviour: camp soft-delete re-parents videos to profile + cleans `camp_video_visibility`; integration test.

**Verify**: Coach uploads a video to camp A; only the camp's student sees it; coach attaches a loose video to a camp; loose inbox no longer shows it; plain `Student` cannot upload, `FootageSubmitterStudent` can; deleting a camp keeps the uploaded videos accessible from the student's profile.

---

### M10 — Scoped techniques admin

**Stories**: CC-011, CC-012, CC-013, CC-014.

**Goal**: Coaches have a dedicated `/scoped-techniques` view to audit, promote, and reuse scoped techniques across students.

**DB**: No new tables. Querying `techniques WHERE scope='scoped'`.

**Backend**: `GET /api/techniques?scope=scoped` with sort/filter params. `POST /api/techniques/<id>/promote` taking a payload of which child content (videos, notes) comes along — granular per-item picker, not all-or-nothing. The camp-add-technique picker (M8) gains a "similar scoped techniques exist for other students" surface, with one-step actions to copy or promote.

**Frontend**: New `/scoped-techniques` page (coach-only). Surface cross-student suggestions inside the camp-technique picker (CC-014).

**PR breakdown** (~4): (1) Scoped-techniques page + endpoint + filters + `qk.scopedTechniques(filters)` key. (2) Promote-to-global endpoint with payload contract + integration test (no UI yet). (3) Granular content picker UI for promote-to-global. (4) Cross-student suggestion in the add-to-camp picker.

**Verify**: Coach views the scoped-techniques page, promotes one with a subset of its videos; the promoted technique appears in the global library; remaining videos stay scoped to the original camp.

---

## Phase 4 — Competitions & matches

### M11 — Competitions + competition camps

**Stories**: CC-002, CC-003, CC-004, CC-005, CC-006, CC-007.

**Goal**: Gym-wide competition entities. Students opt in (or coach opts them in). Generic camps can be promoted to competition camps by linking a competition. Per-competition roster page.

**DB**:
- `competitions` table: `(id, name, date, created_by_id, created_at, archived_at NULL)`. Soft-delete only (referenced by registrations and camps).
- `competition_registrations` table: `(id, student_id, competition_id, registered_at, registered_by_id)`.
- `camps.competition_id` column ADDED in this milestone (M8 no longer pre-bakes it). Nullable FK to `competitions`.

**Indexes**: `idx_registrations_competition` on `competition_registrations(competition_id, student_id)`, `idx_camps_competition` on `camps(competition_id) WHERE competition_id IS NOT NULL`.

**Routes module**: `crates/syllabus-tracker/src/competitions/` per the M8 sub-module convention.

**Registration rule**: a `camp.competition_id` requires an active `competition_registrations` row for `(student_id, competition_id)`. Coach-promoting a camp to competition implicitly creates the registration row if missing. Promoting cannot orphan: if the registration is later deleted, the promotion has to be reversed first.

**Backend**: Competition CRUD, register/unregister endpoints (student-self or coach-on-behalf), per-competition student list with each student's camp link. `#[instrument]` on handlers.

**Frontend**: `/competitions` index, `/competitions/<id>` detail with roster + camp-progress summary. Camp detail page gets a "promote to competition camp" action that surfaces existing competitions + a quick-create — single dialog combining the picker and create flow.

**Query keys**: `qk.competitions()`, `qk.competition(id)`, `qk.competitionRoster(competitionId)`.

**PR breakdown** (~3): (1) Competition + registration schema + endpoints + `camps.competition_id` column + registration-required validation. (2) Competition pages (`/competitions`, `/competitions/<id>`). (3) Promote-to-competition action on camp detail + auto-create-registration on promote.

**Verify**: Coach creates a competition; student self-registers; coach promotes their generic camp to a competition camp; per-comp roster shows the camp; promoting without an existing registration auto-creates it.

---

### M12 — Matches

**Stories**: CC-020, CC-021, CC-022, CC-031 (preview only — full at M16).

**Goal**: Inside a competition camp, students or coaches log individual matches (W/L/D + method + free-text detail). Raw match video uploads attach to a specific match. Coach can attach camp techniques to matches as analysis. `My matches` tab lands as a read-only aggregator.

**DB**:
- `matches` table: `(id, registration_id, result ENUM[win/loss/draw], method ENUM[submission/points/decision], method_detail TEXT, occurred_at, created_by_id, created_at, deleted_at NULL)`. No opponent fields per concepts doc.
- `match_techniques` join table: `(match_id, camp_technique_id)`.
- Videos with `parent_kind='match'`.

**Indexes**: `idx_matches_registration` on `matches(registration_id, occurred_at)`, `idx_match_techniques_match` on `match_techniques(match_id)`.

**Routes module**: `crates/syllabus-tracker/src/matches/`.

**Cascade decision (F2)**: deleting a match demotes its videos to `parent_kind='camp'`, `parent_id=<camp_id>` (videos remain attached to the camp the match belonged to). Documented here per resolved decision #13.

**Backend**: Match CRUD endpoints. Both students and coaches can create/edit matches on their own registration. Upload endpoint accepts `parent_kind=match`. `match_techniques` linking endpoint. `#[instrument]` everywhere.

**Footage Submitter gating**: match-video upload endpoint checks `Permission::SubmitFootage` for non-coach roles (per decision #10).

**Frontend**: Match list on the competition-camp detail page. Match detail view with footage + linked techniques. `My matches` tab on student profile as a read-only aggregator (CC-031 preview). The full footage-review experience (timestamp threads, suggestion flow) lands in M16; the verify step at M12 explicitly notes that threads/suggestions are not yet wired. Categorized picker (M7.5) gains the `match` data source.

**Query keys**: `qk.matches(campId)`, `qk.match(id)`, `qk.myMatches(studentId)`.

**PR breakdown** (~5): (1) Schema + match CRUD + sub-module. (2) Match list + detail UI on camp detail. (3) Match video upload (parent_kind=match) + Footage Submitter gating + picker `match` enrichment. (4) `match_techniques` linking + analysis UI. (5) `My matches` tab on student profile (read-only).

**Verify**: Student logs a match in their competition camp; uploads raw footage; coach attaches a camp technique as analysis; the match appears in `My matches` tab. Playback works; threads and suggestions DO NOT (deferred to M16). Deleting a match keeps the videos accessible from the parent camp.

**PR breakdown** (~4): (1) Match schema + CRUD + UI on camp detail. (2) Match video upload (uses `parent_kind=match`). (3) `match_techniques` linking + analysis UI. (4) `My matches` tab on student profile (read-only aggregator).

**Verify**: Student logs a match in their competition camp; uploads raw footage; coach attaches a camp technique as analysis; the match appears in `My matches` tab.

---

## Phase 5 — Threads, mentions, comments

### M13 — Profile threads + replies + video replies + ManageThreads permission

**Stories**: CX-006, CX-007, CX-008, CX-009, CX-010.

**Goal**: Top-level concept of a "thread" arrives. Threads attach to profiles (here), to videos (M16), to camps (here as well). Replies are text, video, or both. Video replies cannot spawn new top-level threads.

**Thread auth model**: students can start profile threads only on **their own profile**; coaches can start threads on any student's profile. Camp threads: any participant (the camp's student or any coach) can start. This rule applied in the create-thread guard.

**DB**:
- `threads` table: `(id, parent_kind TEXT, parent_id INTEGER, parent_video_anchor_seconds INTEGER NULL, author_id, body, created_at, deleted_at NULL, deleted_by_id NULL)`. Parent kinds at this milestone: `profile`, `camp`. (`video_timestamp`, `library_video` come in M15/M16.)
- `comments` table: `(id, thread_id, parent_comment_id NULL, author_id, body, video_id NULL, created_at, deleted_at NULL, deleted_by_id NULL)`. `video_id` non-null marks a video reply.
- Videos with `parent_kind='thread'`. These do not promote globally and **are hard-deleted on thread delete** (M20 owns the cascade decision but it's noted here for completeness).

**Indexes**: `idx_threads_parent` on `threads(parent_kind, parent_id) WHERE deleted_at IS NULL`, `idx_comments_thread` on `comments(thread_id, created_at) WHERE deleted_at IS NULL`.

**Routes module**: `crates/syllabus-tracker/src/threads/`.

**Permissions**: new `Permission::ManageThreads` (per pending decision #14) granted to Coach + Admin. Used by M20 moderation; introduced here for consistency since thread CRUD lives here. Plain thread CRUD uses author + viewer permissions, not `ManageThreads`.

**Backend**: Thread CRUD, comment CRUD. Video-reply upload routes use the standard pipeline with `parent_kind='thread'`. Footage Submitter (`Permission::SubmitFootage`) gates student video replies (CX-009) — third upload surface to enforce per decision #10. API enforces "video replies cannot be parents of new threads" (CX-010): the create-thread endpoint rejects parent kinds it doesn't know. Graduated students retain full thread + reply access per decision #8. `#[instrument]` on handlers.

**Frontend**: Profile threads appear inline in the Activity feed as their own item kind (`profile_thread`); thread detail page (`/threads/<id>`) renders the thread + replies. Reply composer with attach-video / record-video buttons. Video reply button renders conditionally via `hasPermission(user, 'SubmitFootage')`. Camp threads appear in camp detail.

**Feed integration**: parent-resolution for thread events at M13: thread create or reply on a profile thread → `profile_thread` item (one per thread); reply on a camp thread → bumps the parent `camp` item; reply on a `video_timestamp` thread (M16) → bumps the parent of the video.

**Query keys**: `qk.thread(id)`, `qk.threadsForParent(parentKind, parentId)`.

**PR breakdown** (~5): (1) Thread + comment schema + sub-module + thread-auth rule + `ManageThreads` permission. (2) Profile-thread endpoints + thread detail UI + text replies. (3) Video reply upload + display + Footage Submitter gating. (4) No-new-thread-from-reply enforcement (server) + camp threads. (5) Feed integration: `profile_thread` item kind + parent-resolution for camp threads.

**Verify**: Coach starts a thread on a student profile; student replies with text; coach replies with a video; the video reply renders inline; student without `FootageSubmitter` cannot reply with a video (composer button hidden, endpoint rejects); coach starts a camp-level thread which bumps the camp item in the feed; student tries to start a thread on another student's profile and is rejected.

---

### M14 — @-mentions in comments

**Stories**: CX-011, CX-012, CX-013, CX-014.

**Goal**: Comment bodies can embed structured `@technique` and `@video` tokens. Mentions render as tappable cards inline. When a coach mentions a video the recipient student can't see, the unhide prompt appears.

**Storage** (per pending decision #12): **interleaved tagged tokens inside `comments.body`**, e.g. `@[technique:42]` and `@[video:91 t=42]`. No JSON column. No new tables. Mentions parsed on render; enriched server-side by joining the referenced rows in the comment-fetch query and returning the comment alongside a sidecar map of mention metadata.

**Backend**: Mention parser + serializer in `crates/syllabus-tracker/src/threads/mentions.rs`. Pre-publish visibility check on author submit: query `videos.hidden_at` first, then `syllabus_video_student_visibility` (post-M3); branch the prompt per CX-013. Student authors skip the auto-grant prompt (CX-014). The enriched comment-fetch sidecar respects M3 visibility per viewer.

**Frontend**: Comment editor (built in M13) gains `@` triggering. Picker IS the categorized component from M7.5 — by M14 it's populated by technique, camp, match, profile, loose, and thread data sources. Renderer turns tokens into cards inline within comment bodies.

**Query keys**: `qk.mentionPicker({kinds, q})` (reuses `qk.videoPicker` from M7.5).

**PR breakdown** (~4): (1) Token storage parser/serializer + server-side enrichment shape. (2) Renderer (turns tokens into cards inline). (3) `@` editor trigger + picker integration + technique data source for the picker. (4) Pre-publish visibility prompts (CX-013/CX-014).

**Verify**: Coach types `@kimura` in a thread reply; picker offers techniques; selecting one inlines a card; coach types `@<hidden-video>`; the unhide prompt appears with the right branching.

---

### M15 — Library video comments + BroadcastLibraryComment permission

**Stories**: SD-010, SD-011, SD-012.

**Goal**: Students can leave private timestamped comments on library videos (visible to themselves and coaches). Coaches reply privately or broadcast publicly.

**DB**: Reuses threads/comments from M13. New parent kind: `library_video` (anchored to `video_id` with `parent_video_anchor_seconds`). Threads (not individual comments) get a `visibility ENUM` column: `private_to_owner_and_coaches`, `broadcast`.

**Permissions**: new `Permission::BroadcastLibraryComment` (per pending decision #14) granted to Coach + Admin. Required to set `visibility='broadcast'` on a library-video thread.

**Backend**: Library video page exposes a comments surface using the thread/comment plumbing. Student-authored threads default to `private_to_owner_and_coaches`. Coach broadcast threads visible to every student who can see the video. SD-012 broadcasts surface in the coach's own activity feed only (per resolved decision #5); a navbar notification (M19) fires for any student currently watching the video at broadcast time.

**Frontend**: Comments rail under the video player on library/technique pages. Timestamp anchor visible in the rail; clicking jumps the player. Coach toolbar: explicit dropdown next to the submit button with `Reply privately` / `Broadcast` modes — modelled on GitHub's "Comment / Close and comment" pattern (no existing component to reuse). `Broadcast` option renders only if `hasPermission(user, 'BroadcastLibraryComment')`.

**Query keys**: `qk.libraryVideoComments(videoId, viewerId)`.

**PR breakdown** (~3): (1) `visibility` enum on threads + `library_video` parent kind + `BroadcastLibraryComment` permission. (2) Comments rail UI on library video page + private reply flow. (3) Broadcast flow with dropdown UI + notification fire (placeholder hook until M19).

**Verify**: Student leaves a private comment on a library video; only they + coaches see it; coach broadcasts; every student watching that video sees it; student does not see other students' private comments; student without `BroadcastLibraryComment` cannot choose the broadcast mode.

---

### M16 — Video timestamp threads + footage review

**Stories**: CC-023, CC-024, CC-031 (full), CC-032, CC-033.

**Goal**: Threads can be anchored to a timestamp on any camp/match video. Students review their own historical match footage, start discussion threads, and suggest techniques from the library tied to a moment.

**DB**:
- Thread parent kinds added: `video_timestamp` (works for camp and match videos uniformly; the underlying video's parent kind dictates visibility — a video-timestamp thread on a camp video uses `ctx=camp:<id>`).
- `technique_suggestions` table: `(id, student_id, technique_id, anchor_video_id, anchor_seconds, status ENUM[pending/approved/replaced/dismissed], created_at, resolved_by_id NULL, resolved_at NULL, resolution_note TEXT NULL, target_camp_id NULL)`.

**Indexes**: `idx_suggestions_pending` on `technique_suggestions(student_id, status, created_at) WHERE status='pending'` (drives M17b queue query).

**Backend**: Thread endpoints extended for `video_timestamp` parents. Thread visibility for `video_timestamp` parents inherits the parent video's visibility, evaluated via M3's context-aware predicate in the same context as the video's home (camp / match → camp ctx; library_video → library ctx). Suggestion CRUD: student creates suggestion anchored to a moment; coach's queue endpoint exists here (used by M17b's UI).

**Frontend**: Player gains a "comment at this moment" affordance. `My matches` tab gains the full footage-review experience: per-match playback, timestamp threads, suggest-technique panel. The suggest-technique panel reuses the categorized picker (now technique-only).

**Query keys**: `qk.videoThreads(videoId)`, `qk.suggestions({studentId, status?})`, `qk.matchFootageReview(matchId)`.

**PR breakdown** (~5): (1) `video_timestamp` thread parent + visibility inheritance + UI affordance on player. (2) Coach-initiated feedback threads (CC-023/CC-024). (3) Student permission rule + endpoint to create threads on their own footage. (4) `My matches` footage-review experience UI (CC-032). (5) Suggestion flow (CC-033) + suggestion list on coach side (no queue UI yet — that's M17b).

**Verify**: Coach starts a thread at 0:42 on a match video; student replies; student opens a historical match in `My matches`, starts their own discussion thread at 1:15; student suggests a library technique anchored to that moment; suggestion appears as `pending` on the coach side; a student cannot start a thread on another student's match video.

---

## Phase 6 — Camp lifecycle + cross-camp continuity

### M17a — Camp lifecycle + cross-camp history + camp lineage

**Stories**: CC-027, CC-028, CC-029, CC-030, CC-035, CC-036.

**Goal**: Camps can be archived. New camps reference a prior camp and link historical matches/threads/scoped techniques as first-class content. Cross-camp history surfaces on student profiles for both coach and student.

**DB**:
- `camps.archived_at` (M8 column now exercised).
- `camps.references_camp_id` — NEW column added in this milestone (was M8 placeholder; not pre-baked).
- `camp_technique_referenced_videos` table: `(camp_technique_id, video_id)`.
- Generic `camp_references` polymorphic table for linked matches/threads/techniques: `(camp_id, ref_kind TEXT, ref_id INTEGER)` where `ref_kind ∈ {match, thread, scoped_technique}`. **FK behaviour per kind enumerated**: `match` and `thread` refs cascade-delete if the referenced row is hard-deleted; `scoped_technique` refs are blocked from delete (the technique was scoped to a prior camp and may have content the new camp links to).

**Indexes**: `idx_camp_references_camp` on `camp_references(camp_id, ref_kind)`, `idx_camp_references_target` on `camp_references(ref_kind, ref_id)`.

**Backend**: New-camp creation accepts a `references_camp_id` and a list of `(ref_kind, ref_id)` items to link. Cross-camp history aggregator endpoint (`GET /api/students/<id>/camps?include=archived`) feeds the Camps tab. Active/archived filtering propagates to the Camps tab (M8), camp detail (M8), competition roster (M11), Match list (M12) — each gets a small filter parameter and a UI toggle.

**Frontend**: New-camp wizard step: "seed from previous camp?" with a picker. Camp detail shows "builds on <previous camp>" with link. Student profile cross-camp history surfaces in the Camps tab. Archived camps no longer surface in active roster views but stay in the activity feed and in cross-camp history.

**Query keys**: `qk.camps(studentId, {includeArchived?})` (key extends existing).

**PR breakdown** (~4): (1) `camps.references_camp_id` column + `archived_at` activation + active/archived view filters across Camps tab, camp detail, competition roster, Match list (named explicitly per reviewer). (2) `camp_references` + `camp_technique_referenced_videos` tables + endpoints. (3) New-camp seed-from-previous flow + camp detail "builds on" link. (4) Cross-camp history surfacing on Camps tab.

**Verify**: Coach archives a camp; it disappears from active views but still surfaces in cross-camp history; coach starts a new camp seeded from the archived one and links a historical match video to a new camp technique; student sees the same history on their own profile.

---

### M17b — Suggestions queue + pinned-to-camp promotion

**Stories**: CC-034, CC-037.

**Goal**: Coaches review pending technique suggestions (from M16) in a dashboard queue and resolve each as approve / replace / dismiss with a target-camp pick. Pinned techniques can be promoted into a camp, carrying threads and notes.

**Backend**: Suggestion resolution endpoint with target-camp picker per resolved decision #4: dropdown of the student's active camps; default if single; offer "create new camp" if none. Pinned-to-camp promotion endpoint creates a `camp_techniques` row; notes are already shared per M6's `technique_notes`; thread/comment links from the pinned context get attached to the camp context.

**Frontend**: Suggestions UI lives **next to `QueuePanel`** in `frontend/src/app/dashboard/page.tsx` (around line 313 — the existing Queue grouping for reset requests, pending approvals, needs-syllabus), NOT as a fourth tab inside the Initiative/Recent/Quiet roster Tabs. Different semantic grouping — Queue = items needing my action, roster Tabs = students who deserve attention.

"Promote to camp" action on the pinned technique view (coach-only) opens the same target-camp modal as suggestion approval (single shared component, since both flows hit the same UX). Categorized picker (M7.5) gains active-camp data source for the modal.

**Query keys**: `qk.suggestions({status, studentId?})`, `qk.activeCampsForStudent(studentId)`.

**PR breakdown** (~3): (1) Shared target-camp modal component (used by both flows). (2) Suggestion queue UI + resolution endpoint, mounted in QueuePanel area. (3) Pinned-to-camp promotion endpoint + UI on pinned technique view.

**Verify**: Coach reviews and approves a student's suggestion, picking the target camp; coach picks "create new camp" when no active camps exist; coach promotes a pinned technique into a camp; existing notes and thread links appear in the camp context.

---

## Phase 7 — Cross-cutting polish

### M18 — Activity feed polish

> ⚠️ **Amended 2026-06-09** — cards + filter chips (CX-004) now ship in M5b, not here. M18 shrinks to free-text search (CX-005) + unseen-activity divider (CX-027) only.

**Stories**: CX-004 (filter chips), CX-005 (free-text search, v1 nice-to-have), CX-027 (unseen-activity indicator). CX-003 dedup already shipped at M5 per pending decision #11 (item-shaped from day one); CX-015 already in M5. M18 is polish only — no reshape.

**Goal**: Add filter chips, free-text search, the unseen-activity indicator, and action-priority styling to the M5 feed.

**DB**:
- New `feed_item_views` table: `(viewer_id, item_kind TEXT, item_id INTEGER, seen_at TIMESTAMP)`. PK on `(viewer_id, item_kind, item_id)`.
- For CX-005 search: denormalised `feed_search_text` column maintained per top-level item via a SQLite trigger on event-bearing tables. Start with `LIKE %q%`; revisit FTS5 if it gets slow.

**Indexes**: PK on `feed_item_views` is `(viewer_id, item_kind, item_id)`; secondary `idx_feed_views_viewer_seen` on `(viewer_id, seen_at DESC)`. Without these the unseen divider query is N+1.

**Backend**: Per-(viewer, item) seen-at tracking (resolved decision #6). Feed query already dedups (M5); search param does substring match against `feed_search_text`. Deleted threads (M20) surface in the feed as "deleted by <coach>" placeholders per pending decision #9. **Performance**: M5's dedup query unions per-kind queries; M18 ships the index strategy + a per-kind benchmark.

**Frontend**: Filter chips (multi-select OR semantics) at the top of the feed. Search box. Unseen-activity divider rendered server-side based on per-(viewer, item) seen_at; debounced scroll-past mark-as-seen action. Item-priority visual treatment per resolved decision #7.

**Query keys**: `qk.studentFeed(studentId, { kinds, q })` (extends M5's key), `qk.feedItemViews(viewerId)`.

**PR breakdown** (~4): (1) Filter chips + multi-kind query param. (2) `feed_item_views` table + indexes + unseen divider + mark-as-seen API. (3) `feed_search_text` denormalisation + search param. (4) Action-priority styling polish + deleted-placeholder rendering.

**Verify**: Activity feed shows one row per item even when multiple activities hit it; filtering by `camps` hides non-camp items; scrolling past unseen items moves the divider; coach loads any student's feed.

---

### M19 — Notifications

**Stories**: CX-025.

**Goal**: In-app notifications for replies and @-mentions. Navbar badge, notification center with mark-as-read.

**DB**: `notifications` table: `(id, user_id, kind TEXT, source_id INTEGER, source_kind TEXT, created_at, read_at NULL)`.

**Indexes**: `idx_notifications_user_unread` on `notifications(user_id, created_at DESC) WHERE read_at IS NULL`.

**Emission model**: **inline INSERT in the same transaction** as the source row (reply, mention). No event bus. The reply/mention handler computes recipients (thread author, mentioned users) and writes notification rows alongside the comment row. If multi-recipient fanout grows past five rows per request, revisit.

**Frontend**: Badge on `frontend/src/components/navbar.tsx` with unread count. Notification center uses shadcn `Sheet` component (no existing drawer — `Sheet` is the closest fit) listing unread items most-recent-first with direct deep-links into the source.

**Query keys**: `qk.notifications(userId)`, `qk.notificationsUnreadCount(userId)`.

**PR breakdown** (~2): (1) Schema + emission hooks into M13 (replies) and M14 (mentions) + endpoint to list and mark read. (2) Navbar badge + Sheet-based notification center.

**Verify**: Coach replies to a student's thread; the student's navbar badge shows `1`; clicking opens the Sheet; clicking the item lands on the thread; the badge clears. Mention in a comment also generates a notification for the mentioned user.

---

### M20 — Moderation + ModerateContent permission

**Stories**: CX-023, CX-024.

**Goal**: Coaches and admins can soft-delete student comments, threads, and uploaded videos with the original author notified. Replies survive with a "deleted by <role>" placeholder.

**DB**: `threads.deleted_at`, `threads.deleted_by_id`, `comments.deleted_at`, `comments.deleted_by_id` (columns exist from M13). Videos already have `deleted_at`; add `deleted_by_id`. Admin-only hard-delete endpoints for spam cleanup.

**Cascade decision (F2)**: deleting a thread hard-deletes its `parent_kind='thread'` reply videos (per resolved decision #13). Reply videos have no value without their thread; the storage reclaim hook in PR 2 picks them up.

**Permissions**: new `Permission::ModerateContent` (per pending decision #14) granted to Coach + Admin. Required for the delete endpoints.

**Backend**: Coach moderation endpoints (`DELETE /api/threads/<id>`, `DELETE /api/comments/<id>`, `DELETE /api/videos/<id>` — the existing video delete extends). Admin hard-delete endpoints under `/api/admin/...`. Notification (CX-025) fires for the original author. **Soft-delete recovery**: operator clears `deleted_at` directly (per cross-cutting conventions); no UI for un-delete.

**Storage reclaim**: hard-delete on videos uses a synchronous storage delete (DigitalOcean Spaces `DELETE` per the existing reclaim pattern in `videos/routes.rs`). No async job. If the storage call fails, the hard-delete is aborted (operator retries). The plan does NOT introduce a background reclaim worker.

**Frontend**: Trash icon on threads/comments/videos for coaches (themselves and other students; admin = all). Deleted items render as placeholder; the same placeholder applies in the activity feed (M18) per pending decision #9. Admin-only "purge" action surfaces in the admin page (`frontend/src/app/admin/page.tsx`).

**PR breakdown** (~2): (1) `ModerateContent` permission + soft delete endpoints + UI + author notification + feed placeholder rendering. (2) Admin hard delete + sync storage reclaim + admin "purge" UI.

**Verify**: Coach deletes a student comment; the placeholder renders; the student gets a notification; replies still chain; admin purges; the row is gone.

---

### M21 — Initiative signals (dashboard roster)

**Stories**: SD-013. The SD-014 profile header strip already shipped in M6 alongside pinning; this milestone only does the dashboard roster signal evolution.

**Goal**: The coach dashboard's Initiative tab factors in self-directed activity (pins, library watches, library comments, suggestions), not just syllabus updates.

**Backend**: Rewrite `get_students_by_recent_updates` (`crates/syllabus-tracker/src/db/reporting.rs:51-172`) using a CTE per signal source then a final `MAX(...)` outer aggregation. The current query already uses a correlated subquery for `latest_watch_at`; adding pins + library comments + suggestions via UNION inside a `MAX(...)` would not compose. The CTE structure also makes future signal sources easier to add.

**Indexes for new sources**: `idx_pinned_recent` on `pinned_techniques(student_id, pinned_at DESC) WHERE unpinned_at IS NULL`, `idx_suggestions_recent` on `technique_suggestions(student_id, created_at DESC) WHERE status='pending'`.

**Risk note**: when CX-017 (phase-2, watch-activity opt-out) lands, this query's library-watch signal source needs an opt-out filter. Document inline.

**Frontend**: Initiative tab sorts/filters incorporate the new signal sources. Tooltip or badge surfaces which signal type tripped the inclusion (helps the coach decide who to spend time with).

**PR breakdown** (~2): (1) Backend query rewrite (CTE) + new signal sources + indexes. (2) Frontend surfacing on the Initiative tab.

**Verify**: Student pins three techniques and watches two library videos; coach dashboard Initiative tab surfaces them as recent activity; the signal-source badge indicates self-directed vs syllabus origin. Query perf still in line with the pre-rewrite query (benchmark before/after).

---

## Out of scope

- All OS-* stories (attendance heatmap, attention marking, roster signal evolution, grading day, check-in integration).
- Phase-2 stories: CX-016 (reactions), CX-017 (watch-activity opt-out), CX-021 (attempt threads), CX-022 (syllabus-technique threads), CX-026 (reaction notifications).
- `SD-005` and `SD-007` are intentional ID gaps (see tech-notes §10).

---

## Verification approach (cross-milestone)

Each milestone's PR breakdown ends with a verify step. Beyond per-milestone verification, three repeated check patterns:

1. **Schema integrity**: every DB-touching PR runs `just sqlx-prepare` and the migration runs cleanly against a fresh DB seeded from the current production-shaped fixture. The app's startup panic-on-mismatch catches regressions automatically.
2. **Visibility regression**: after each milestone that touches video visibility (M3, M4, M9, M14, M15, M16), run the visibility matrix: (coach, student, graduated student) × (library, syllabus, camp, thread, profile) × (global-hide, syllabus-hide, camp-hide). Document a small fixture script in `crates/syllabus-tracker/tests/` to make this repeatable.
3. **Feed coverage**: after each milestone that adds a new item kind to the activity feed (M5, M6, M8, M12, M13, M16, M17), confirm the feed surfaces it and dedups correctly. M18's polish PRs include the full feed acceptance test.

---

## Risks + decisions to revisit

- **M5c atomic cutover** (added by amendment): the single most coordinated PR in the roadmap. Stops the app briefly, migrates `student_techniques` rows into the new per-syllabus shape, drops the legacy table. Pre-flight checklist: full staging-DB dry-run with the migration script, SQL backup taken pre-cutover, rollback path tested. Pick a low-traffic window.
- **M6 notes migration**: the dual-read / write-new pattern was originally planned to bridge syllabus notes across syllabus / pinned / camp views. The 2026-06-09 amendment narrowed `technique_notes` to pinned-only; syllabus notes live in the per-syllabus progress table introduced at M5c. The dual-read shim is dropped. Confirm pin-context notes still appear correctly during the M5c verify.
- **Activity feed query performance** (M5 + M18): the dedup-by-item query unions per-kind sources and grows with every milestone that adds an item kind. M18 ships the indexes; if latency degrades, add a denormalised `item_latest_activity` cache.
- **Notification volume on hot threads** (M19): one row per reply in a busy thread will spam the notification center. M19 ships as one-per-event; if real usage shows noise, add per-thread coalescing (most-recent N replies bundled into one notification, similar to how reactions are planned in phase-2 CX-026).
- **`video_watch_aggregates` × parent polymorphism** (F2): the existing aggregate table (`reporting.rs:99-107`) keys on `video_id` only. M18's dedup query resolves each watch event to its parent item via `videos.parent_kind / parent_id`, not by projecting parent into the aggregate table. Revisit if the join becomes hot.
- **`technique_id` back-compat shim on `videos`**: lives from M7 through M16 cleanup. If any new query in this window writes to `videos` it must populate both `technique_id` (when applicable) and `parent_kind/parent_id`. Code review checklist item.
- **Camp delete cascade** (M9): re-parenting videos to `profile` removes them from the camp's lifecycle but they survive on the student's profile. Operator deleting a camp likely doesn't expect this; document the behaviour in the camp-delete confirmation modal.
- **CC-034 target-camp UX**: the dropdown-of-active-camps assumes the suggestion came from a footage moment associated with a comp camp. CC-033 also allows library-browsing suggestions, so the "no active camp" branch will be common; M17b's shared modal makes the "create new camp" affordance prominent for both flows.
- **Coach feedback gap**: the CSV "Coach feedback" column is empty. Worth a check-in with a coach before locking M17b's suggestion-queue UX since CC-034 has the biggest "is this how I actually work?" surface area.
- **CX-017 phase-2 carve-out** (M21): the new initiative-signal query unions library-watch events. If CX-017 ships later, M21's query needs an opt-out filter on the watch source. Documented inline in M21.
- **Storage reclaim policy** (M20): synchronous DELETE during admin hard-delete couples user action to storage I/O. Acceptable for the gym-scale workload assumed; revisit if hard-deletes ever batch.
- **Polymorphic `camp_references` table** (M17a): the picked shape mirrors `videos.parent_kind/parent_id` but introduces a different FK-cascade model per kind. The schema check at startup won't catch FK behaviour drift; relies on integration tests in `crates/syllabus-tracker/tests/` to enforce.
