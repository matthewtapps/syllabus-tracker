# Thread video replies — design

Date: 2026-06-20
Status: approved, ready for implementation plan

## Goal

Let any thread carry **video replies** alongside text comments. A video reply
is a standalone video clip (upload or external link) posted into a thread. Text
comments can refer to a specific video reply, optionally at a timestamp, and the
UI renders that reference as a clip chip that opens and seeks the reply.

Three product requirements:

1. Any thread can have a video reply.
2. A video that is part of a thread reply **cannot** have a thread/comments
   started on it (no endless reply chains).
3. Text replies can tag/refer to a video reply in the thread, optionally with a
   timestamp.

## Locked decisions

- **Video reply = standalone row**, not an attachment on a comment. A reply is
  text (a `thread_comments` row) **or** a clip (a `videos` row), never both. The
  UI merges the two streams by `created_at` into one timeline.
- **Reference = structured columns** on `thread_comments`
  (`references_video_id` + `ref_ts_seconds`), not inline `@`-mention tokens. One
  referenced clip + optional timestamp per comment.
- **Source = upload + link.** Reuse both existing video forms (native upload via
  the processing pipeline, and external YouTube/Vimeo/Drive links).
- **Caption = optional**, stored in `videos.description`. The reply is still
  "a clip", with words living in the caption; it does not become a mixed
  text+video reply row.
- **Feed verb = new `VideoReplyPosted`** (distinct from `ThreadCommentPosted`),
  so a video reply is feed-distinguishable from a text comment.

## Existing foundation (already in the codebase)

- `db::videos::VideoParent::Thread(i64)` resolves to `parent_kind='thread'`,
  `thread_id` column. The `videos` table already has the `thread_id` typed
  column and the position/visibility plumbing.
- `db::videos::list_videos_for_parent_global_visible` (currently `#[allow(dead_code)]`)
  reads videos for an arbitrary `VideoParent`, filtered to `deleted_at IS NULL`
  AND `hidden_at IS NULL`.
- **Requirement 2 is already enforced**: `db::threads::validate_anchor` rejects
  starting a thread on a video whose `parent_kind == 'thread'` (CX-010).
- Thread model: a thread is a root post (`threads.body`) plus `thread_comments`
  (text `body`, one level of nesting). Visibility is `broadcast` / `private`
  with `scope_student_id`; `db::threads::viewer_can_see` is the gate.

## Data model changes

### `videos`
No schema change. A video reply is an ordinary `videos` row with
`parent_kind='thread'`, `thread_id=<thread>`. Caption is stored in
`videos.description`. `videos.title` is synthesized (e.g. author display name +
" — video reply") since title is required by the create path but is not a
user-entered field for replies.

### `thread_comments`
Add two nullable columns:

```sql
ALTER TABLE thread_comments ADD COLUMN references_video_id INTEGER
    REFERENCES videos(id);
ALTER TABLE thread_comments ADD COLUMN ref_ts_seconds INTEGER;
```

Constraint (in `config/schema.sql`, declarative migrator):
`CHECK (ref_ts_seconds IS NULL OR references_video_id IS NOT NULL)` — a
timestamp cannot exist without a referenced clip.

Create-time validation (in `db::threads::create_comment`), beyond the FK: the
referenced video must be a **live** (`deleted_at IS NULL`) `parent_kind='thread'`
reply belonging to **this same thread**. Reject otherwise with a validation
error.

## Read model

`db::threads::ThreadView` gains:

```rust
pub video_replies: Vec<VideoReplyView>,
```

where `VideoReplyView` carries `{ id, author_id, author_name, caption (Option),
created_at, deleted_at, video: Video }`. Soft-deleted replies are tombstoned the
same way comments are (`caption`/`video` payload suppressed, marker rendered).

`CommentView` gains:

```rust
pub references_video_id: Option<i64>,
pub ref_ts_seconds: Option<i64>,
pub referenced_caption: Option<String>,  // denormalized for the chip label
```

Reads:

- Video replies for a thread are read via the parent thread surface (the
  existing `list_videos_for_parent_global_visible` for `VideoParent::Thread`, or
  an equivalent thread-scoped read), filtered to `hidden_at IS NULL`.
- The whole `ThreadView` is already gated by `viewer_can_see`, so a viewer who
  cannot see the thread sees no replies. Within a visible thread, the global
  hide flag still applies per clip.
- The frontend merges `comments` and `video_replies` by `created_at` ascending
  into a single rendered timeline.

## Write paths (API, `threads/routes.rs` + `videos/routes.rs`)

### Post a video reply
- `POST /threads/<id>/videos/upload` (native) and
  `POST /threads/<id>/videos/link` (external).
- Both construct `VideoParent::Thread(id)` and reuse the existing
  upload/link machinery (processing pipeline / external-video create).
- Authorization: the caller must pass the existing `get_thread` visibility gate
  for `<id>` (coach, broadcast thread, or the scope student). Else 404/403.
- Side effects: bump `threads.last_activity_at`; emit a `VideoReplyPosted`
  activity row, targeted the same way `ThreadCommentPosted` is (private →
  scope student, broadcast → coach-only / `target_student_id = NULL`), with the
  thread's denormalized deep-link context.
- Caption arrives as the form/body `description` field.

### Reference a clip from a text comment
- `CreateCommentRequest` gains optional `references_video_id` + `ref_ts_seconds`.
- `db::threads::create_comment` validates the reference (same-thread, live,
  `parent_kind='thread'`) before insert.

### Delete a video reply
- Reuse `DELETE /videos/<vid>`. Verify/extend its author + `ManageThreads`
  (or video-owner) permission check so a thread reply's author and a moderator
  can delete it. A comment referencing a now-deleted reply renders
  "clip removed" (its `referenced_caption`/target resolves to a tombstone).

## Security fix (must-do)

`db::videos::video_visible_to_student_anywhere` currently falls back to the
global `hidden_at` rule for any non-syllabus `parent_kind`, which would let any
student play/download a **private** thread reply by guessing its id. Fix: for
`parent_kind='thread'`, resolve the parent thread and apply `viewer_can_see`
(broadcast OR `scope_student_id == viewer`; coaches bypass) instead of the naive
global-`hidden_at` fallback. This gates both
`GET /videos/<vid>/playback-url` and `GET /videos/<vid>/download-url`.

## Permissions

Posting a video reply requires the same access as posting a text comment on the
thread: whoever passes the `get_thread` gate. No new permission is introduced.

## Frontend

- `components/threads/thread-view.tsx`: render the merged comment + video-reply
  timeline ordered by `created_at`. A video reply renders the clip
  (player / `VideoRow`) plus its optional caption. A video reply clip must
  **not** show any "start thread" / comment-count affordance (requirement 2).
- A text comment with a reference renders a `[▶ clip @0:32]` chip above the body
  that opens and seeks the referenced reply.
- Reply composer: add a thread-scoped two-tab (upload / link) video-reply Sheet
  next to the text reply box (mirrors `AddVideoButton` but parented to the
  thread). The text reply box gains an optional "refer to a clip" picker:
  choose one of this thread's video replies + an optional timestamp.

## Out of scope / non-goals

- No nested replies under a video reply (the one-level nesting rule is unchanged;
  references are the mechanism for "responding to" a clip).
- No per-student / per-syllabus visibility overrides on thread replies (CX-019:
  thread/profile/loose videos honour only the global hide; the thread's own
  visibility does the scoping).
- No reordering UI for video replies (chronological only).

## Testing

Backend:
- Create a thread video reply via upload and via link; both land as
  `parent_kind='thread'` rows and appear in `ThreadView.video_replies`.
- Visibility: a student cannot see, play, or download another student's private
  thread reply (the security fix); the scope student and coaches can.
- CX-010 still blocks starting a thread on a thread-reply video.
- Comment reference validation: reject a reference to a video in another thread,
  to a non-thread video, and a `ref_ts_seconds` with no `references_video_id`.
- Deleting a video reply tombstones it; a referencing comment renders the
  removed state.
- Feed: posting a video reply emits `VideoReplyPosted` with correct targeting.

Frontend:
- Merged timeline orders comments and video replies by `created_at`.
- The reference chip seeks the referenced reply.
- A video-reply clip shows no start-thread / comment affordance.

## Likely phasing

- **Phase 1 — backend**: `thread_comments` columns + CHECK, `VideoReplyPosted`
  verb, thread video create paths (upload + link), `ThreadView` read merge,
  comment-reference validation, the `video_visible_to_student_anywhere`
  security fix, and tests.
- **Phase 2 — frontend**: merged timeline render, the video-reply composer
  (upload/link Sheet), and the reference chip + clip picker.
