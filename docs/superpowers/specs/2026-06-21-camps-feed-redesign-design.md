# Camps Feed Redesign: a camp is a timeline you post into

**Date:** 2026-06-21
**Status:** Approved, pre-implementation
**Supersedes:** the "Camp as a discrete attachable unit" half (Phase 2) of
`2026-06-20-camps-redesign-remove-competitions-design.md`. The competition
removal (Phase 1) and the generic-camp foundation it describes still stand; this
replaces the ordered-technique-list mental model with a feed.

## Problem

The current camp is a syllabus-like structure: an ordered list of techniques,
plus separate footage and separate threads. It conflates three attachment
mechanics and makes "what happened in this camp" hard to see.

Reframe a camp as a small, focused **timeline**. A camp opens with just its
title and one unified composer. Coach or student attach a technique, attach a
video, or post a plain note. Every attachment is a thread; the camp view is
those threads as a feed, newest activity on top, with search and kind filters.
The camp becomes a narrow, high-interactivity slice of the existing activity
feed.

## Launch context

Camps ship to staging/dev only, gated off production by `campsUiEnabled`
(`VITE_ENVIRONMENT !== "production"`). No production camp data exists, so
destructive schema changes here (dropping `camp_techniques`,
`camps.references_camp_id`) are clean drops, not data migrations. `schema.sql`
is declarative; the migrator handles the drops.

---

## 1. Model: a camp is a feed of threads

A camp owns no ordered lists. Everything in it is a **thread**, and the camp
view is those threads rendered as a feed. Three thread kinds, all already in the
schema (`threads.anchor_kind`):

| Feed card | Anchor | Carries |
|---|---|---|
| Plain post | `anchor_kind='camp'` | body text |
| Video post | `anchor_kind='camp'` | `attached_video_id` + a **required title** (+ optional body) |
| Technique post | `anchor_kind='camp_technique'` | `technique_id`; renders the library `TechniqueRow`, discussion stays camp-scoped |

Decisions:

- **No sections, no ordered list.** A technique is "in" a camp iff a
  `camp_technique` thread exists for it.
- **Attaching the same technique twice = two cards.** It is a timeline; no
  dedupe.
- **Feed ordering = activity chronology** (see Section 7): a reply resurfaces
  its post as new activity, exactly like the dashboard feed.

---

## 2. Schema changes

Additive unless noted.

- **`videos.title`** already exists (`NOT NULL`); reply/draft videos currently
  store an empty string (`videos/routes.rs` draft upload). No schema change. The
  work is enforcing a *meaningful* (non-empty) title on the thread-start paths
  (the upload/link forms already collect one; the reference path must collect or
  backfill it) and using it for search. Reply videos keep the empty title. One
  title per video. See Section 5 for the backfill-on-reference rule.
- **`thread_comments.video_ts_seconds`** (new, nullable `INTEGER`). A reply
  pinned to a timestamp in *its own thread's* attached video. This is distinct
  from the cross-video clip-reference that was dropped earlier; it points only
  into the thread's own video.
- **Drop `camp_techniques`** (the ordered-list table) and its indexes.
  Destructive; clean (no prod data). `validate_anchor` for `camp_technique`
  changes from "the technique is in the camp's list" to "the technique exists
  and is global or `scoped_camp_id = this camp`."
- **Drop `camps.references_camp_id`** ("builds on"). Superseded by referencing
  real content through the navigator (Section 4). Its UI is already gone.
- Keep `techniques.scoped_camp_id` (one-off camp techniques).
- Keep `videos.parent_kind='camp'` for uploaded-fresh camp footage. Referenced
  (linked) videos are *not* re-parented; see Section 4.

---

## 3. The unified composer

Pinned at the top of the camp feed. Used by both the camp's student and the
coach (subject to Section 8 permissions). Typing and sending with no attachment
posts a plain thread. A **＋** opens a short menu:

- **Attach a technique** -> technique picker (existing library search, or, coach
  only, create a one-off scoped technique). Result: a `camp_technique` post.
- **Attach a video** -> opens the **video-source sheet** (Section 4). Result: a
  video post (requires a title).

The same composer (and the same video-source sheet) is reused by the **reply
composer** on every thread, so a reply can also attach a video from any source.
Send stays async/optimistic and author-only-until-ready, reusing the shipped
thread-video-reply behavior.

---

## 4. Video sources and the "choose from Sillybus" navigator

Every video-attach point (a video post, or a video reply) offers **four
sources** through one shared sheet:

1. **Record now** (device camera capture).
2. **Choose from device** (gallery / file picker).
3. **Paste a link** (the existing supported external formats).
4. **Choose from Sillybus** (the navigator below).

Reuse: 1 and 2 feed the existing upload pipeline (record-now is the device
picker in camera-capture mode); 3 reuses the existing link form; 4 is the new
navigator.

### The navigator (choose from Sillybus)

A drill-down picker. A top search box spans everything in scope; browsing by
source is the fallback. Sources (v1):

- **Global library** (technique -> its videos)
- **This student's other camps** (camp -> its videos)
- **This student's syllabuses** (syllabus -> its videos)

Behavior:

- **Reference, not move.** Linking points the new camp post's
  `attached_video_id` at the existing video; the video stays where it lives.
  Deleting the camp post never deletes a referenced video. Uploaded-fresh camp
  videos keep `parent_kind='camp'` ownership as today; referenced videos do not
  change parent.
- **Scoped to the camp's student's visibility, for BOTH operators.** A coach
  driving the navigator inside a student's camp sees exactly that student's
  view: only library videos the *student* may see (coach-only-visibility videos
  excluded), that student's own camps, that student's own syllabuses. Never
  another student's content; never coach-only content. Linking exposes the video
  to the student, so the coach must not be able to pull in anything the student
  is not already entitled to see.

More sources may be added later; these cover the expected 95%+ of flows.

---

## 5. Titles, and referencing title-less videos

- A video *starting* a thread requires a title (used for search, e.g. "Match
  Footage - GI Round 2"). A video attached as a *reply* does not.
- Title lives on the video (`videos.title`), so search is always
  `videos.title`.
- **Reply videos are identified in the navigator by thumbnail + provenance**,
  not a title: "Reply by Coach Matt on 'Inside heel hook' - Jun 14." They
  surface mainly through the top search and within their parent context's
  drill-down.
- **Backfill on reference.** Referencing a title-less video to start a camp post
  requires a title at that moment (thread-start rule), which backfills
  `videos.title`. Referencing an already-titled video reuses its title (no
  re-prompt). The orphan clip gets a real name the first time it is carried
  forward, with no separate "title later" feature.

---

## 6. Timestamped replies on a video post

Goal: replies to a video post can address the whole video or a specific
timestamp, using the timestamp UI we already have, while staying camp-scoped.

### Chosen shape: discussion belongs to the post

A video post is one `anchor_kind='camp'` thread with an attached video. Replies
are its comments; a comment optionally carries `video_ts_seconds` (a pin into
that thread's video). Because the discussion lives on the camp thread, it is
camp-scoped by construction: a referenced library video shows none of its camp
discussion back in the library or in another camp. This realizes the general
principle: **discussion lives in the context where the content was added, and
stays there.**

### Why not reuse the legacy storage

Today the standalone video viewer (`components/videos/review/`, the internal
"moments" subsystem) stores each timestamped comment as its own thread anchored
to the video (`anchor_kind='video'`/`'video_timestamp'`, keyed by `video_id`),
which is global to the video, the cross-context leak we are avoiding. Adding a
`camp_id` discriminator to that model would keep discussion anchored to the
global video and would make a "video post" an awkward video-plus-satellite-
threads entity, breaking the thread-uniform feed and the reference model. The
chosen shape (comments-with-timestamp on the post) is the end-state the deferred
re-scoping work (Section 11) is also heading toward.

### Avoiding real duplication: share the UI, not the storage

The presentational pieces (`ScrubberPins`, `MomentOverlay`, and the seek/jump
logic) currently read `ThreadView[].video_ts_seconds`. Generalize them to a
small `TimestampedEntry { id, video_ts_seconds }` interface so the *same*
components render both legacy moment-threads and camp ts-comments. Shared
rendering and scrubber logic; the only duplication is transitional storage,
which the deferred refactor collapses (at which point `video_timestamp` as a
thread anchor retires). User-facing language stays "comments" / "timestamped
comments", never "moment".

---

## 7. The camp feed view

- **One screen:** a title header (with back and a 🔍 toggle), the unified
  composer, then the feed. No tabs.
- **Backed by the activity feed, sliced to the camp.** The feed is
  `activity WHERE camp_id = ?`, rendered with the existing activity-tile
  components, ordering, and pagination (newest activity on top; a reply
  resurfaces its post). The camp view is the dashboard feed narrowed to this
  camp, plus the composer and inline replies.
- **Per-kind cards:** plain -> body + comments; video -> player + title + the
  shared scrubber pins fed by the post's ts-comments + reply composer; technique
  -> the library `TechniqueRow` (expand-in-place) with camp-scoped
  `camp_technique` discussion (global discussion never shown).
- **Search/deep-link jump:** tapping a search result (or a dashboard activity
  link) closes search, scrolls the feed to that card, and pulses it, reusing the
  `?thread=` scroll-and-highlight in `discussion-block.tsx`. If the target is
  deeper than the loaded slice, open it in the single-thread focused view rather
  than pre-loading the whole feed.
- **Empty camp:** title + composer + one-line hint ("Post a technique, video, or
  note to start this camp").

---

## 8. Activity integration

Every camp post and reply emits an `activity` row with `camp_id` set and
`context_kind='camp'`, scoped private to the student + coaches. **This is already
implemented** for `camp`/`camp_technique` threads and their comments in
`create_thread` / `create_comment` (`db/threads.rs`); no new emission work. So:

- It already flows into the student's and the coach's existing dashboard feeds
  chronologically, as normal tiles, with no special-casing.
- The camp page is the same data filtered to one `camp_id` (the new read path in
  Section 7). The `activity` table already has `camp_id` and `context_kind`
  columns; no schema work needed here.

---

## 9. Search

Toggleable, Slack/Teams style: a 🔍 in the header opens a full-screen sheet with
a text box and kind chips (All / Techniques / Videos / Threads). Matches three
targets: technique names, video titles, and thread/reply text. Results grouped
by kind and match-highlighted. Tapping a result closes the sheet and jumps to
that card in the feed (Section 7). Category/tag filtering beyond content-kind is
out of scope (Section 11).

---

## 10. Permissions

| Action | Coach | Student (own camp) |
|---|---|---|
| Create / archive / unarchive camp | yes | no |
| Post plain thread | yes | yes |
| Post video (record / device / link / from Sillybus) | yes | yes |
| Attach an existing library technique (start a `camp_technique` discussion) | yes | yes |
| Create a new one-off technique (`scoped_camp_id`) | yes | no |
| Edit global library content | yes | no |
| Reference a video from Sillybus | yes (camp student's visible content) | yes (own visible content) |

A student may *attach* (reference) an existing library technique to discuss in
their own camp, but creating new technique content stays coach-only (library
authoring). All student write actions are limited to the student's own camp.
Audience of every camp thread = the camp's student + the coaches (single rule).

---

## 11. Out of scope (tracked separately)

- **Re-scoping the standalone video viewer's discussion** (library / syllabus /
  pins) from video-global to context-scoped. This is the related but separate
  follow-up; camps get isolation natively via Section 6, so this does not gate
  the camp work. When it lands, the legacy `video_timestamp` thread anchor
  converges onto the ts-comment shape and retires.
- **Tags on every content kind** (uniform category filtering across
  videos/threads). v1 search is kind + free text only.
- **Multi-student camps**, and student-created/owned camps (coach-only authoring
  of the camp itself stays).
- Additional navigator sources beyond library / this student's camps / this
  student's syllabuses.

---

## 12. Testing strategy

- Backend route + db tests per slice: camp feed slice query; title-required on
  video-post / not-required on reply; `thread_comments.video_ts_seconds`
  round-trip and author-only-until-ready; `camp_technique` validation after the
  `camp_techniques` drop; navigator visibility scoping (coach inside a student's
  camp cannot list another student's or coach-only videos); reference vs
  ownership (referenced video keeps its parent; deleting the camp post leaves it
  intact); backfill-on-reference of a title-less video; student permission
  matrix with explicit negative tests.
- Activity: a camp post emits an `activity` row with `camp_id` +
  `context_kind='camp'`; appears in the camp slice and in the student/coach
  dashboard feeds.
- Frontend vitest (stub `window.fetch`, `renderWithProviders` + `buildUser`,
  CI Chromium only): the four-source video sheet; the navigator drill-down and
  scoping; the shared `TimestampedEntry` rendering for camp ts-comments; search
  sheet + jump.
- Gate: offline build + tests; `just verify`. After any `sqlx::query!` change,
  regenerate `.sqlx` via `nix develop .#ci --command just sqlx-prepare`.
- Destructive drops (`camp_techniques`, `camps.references_camp_id`) deploy to
  staging with `allow_destructive_migrations=true`; the additive columns alone
  would be `false`.

## 13. Open edge cases (acceptable to defer)

- A referenced video later deleted at its origin: the camp post's
  `attached_video_id` is `ON DELETE SET NULL`-style dangling; render a "video
  removed" tombstone.
- Reply-video discoverability when never carried forward: stays thumbnail +
  provenance only; acceptable.
