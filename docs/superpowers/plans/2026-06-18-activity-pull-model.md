# Activity Pull-Model Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Replace write-fanout of the five broadcast verbs with single events + read-time relevance, on `feat/social-media-tiles` (PR #84). Wipe the activity table instead of migrating.

**Architecture:** `emit_broadcast` writes one NULL-target row; a shared relevance predicate in the student `feed()` + `unread_count()` decides visibility live; the gym feed (all rows) shows each broadcast once.

Conventions: commit `feat(scope): Past tense.`; no co-author; no em-dashes. Backend: `nix develop .#ci --command env SQLX_OFFLINE=true cargo nextest run --workspace --all-features` and clippy `--all-features -D warnings`; regen `.sqlx/` via `nix develop .#ci --command just sqlx-prepare`. Frontend: `pnpm exec tsc -b && pnpm lint && pnpm vitest run --project node`.

---

## Task A: emit_broadcast + swap call sites

**Files:** `db/activity.rs`, `db/videos.rs`, `db/techniques.rs`, `db/tags.rs`, `db/syllabi.rs`, `.sqlx/`.

- [ ] Add to `db/activity.rs`:
  ```rust
  /// Write a single broadcast activity row (no target student). The event is
  /// about the technique/syllabus; feeds resolve which students see it at read
  /// time (pull model). Replaces emit_fanout for the broadcast verbs.
  pub async fn emit_broadcast(tx: &mut Transaction<'_, Sqlite>, ev: NewActivity) -> Result<(), AppError> {
      let mut row = ev;
      row.target_student_id = None;
      emit(tx, row).await
  }
  ```
- [ ] Swap the 8 `emit_fanout(tx, ev, &affected)` calls to `emit_broadcast(tx, ev)` in videos.rs (3), techniques.rs (1), tags.rs (2), syllabi.rs (2). Remove the now-dead `let affected = affected_students_*(...)` line above each.
- [ ] If `affected_students_for_technique` / `_for_syllabus` and `emit_fanout` are now unused, remove them (clippy `-D warnings` will flag). Keep any still referenced by tests; update those tests.
- [ ] `nix develop .#ci --command just sqlx-prepare` (no query text changed yet, but offline build must pass); `... cargo build --workspace --all-features` clean.
- [ ] Commit: `feat(activity): Emit broadcast events instead of fanning out per student.`

## Task B: Read-time relevance in feed + unread

**Files:** `db/activity_read.rs`, `test/activity_read.rs`, `.sqlx/`.

- [ ] In `feed()` **student** branch, replace `WHERE act.target_student_id = ?` with the relevance block (binds `viewer` 4x in order: targeted, assigned, pinned, syllabus):
  ```sql
  WHERE (
      act.target_student_id = ?
      OR (
        act.target_student_id IS NULL
        AND (
          ( act.verb IN ('video_added','video_visibility_set','technique_edited')
            AND act.technique_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM syllabus_assignments a
                JOIN student_syllabus_techniques sst ON sst.assignment_id = a.id
                WHERE a.student_id = ? AND a.unassigned_at IS NULL
                  AND sst.technique_id = act.technique_id AND sst.hidden_at IS NULL
              UNION
              SELECT 1 FROM student_pinned_techniques p
                WHERE p.student_id = ? AND p.technique_id = act.technique_id
            ) )
          OR
          ( act.verb IN ('syllabus_technique_added','syllabus_technique_removed')
            AND act.syllabus_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM syllabus_assignments a
                WHERE a.student_id = ? AND a.unassigned_at IS NULL
                  AND a.syllabus_id = act.syllabus_id
            ) )
        )
      )
    )
    AND (act.video_id IS NULL OR (v.id IS NOT NULL AND v.deleted_at IS NULL))
    AND (act.thread_id IS NULL OR (th.id IS NOT NULL AND th.deleted_at IS NULL))
    AND (? IS NULL OR (act.occurred_at, act.id) < (?, ?))
  ```
  Add the three new `viewer` binds (assigned, pinned, syllabus) after the existing `target` bind, before the `before_ts/before_id` binds, matching `?` order. The cursor-join `viewer` binds at the top of the query stay first as they are.
- [ ] In `unread_count()` student `feed_predicate`, replace `act.target_student_id = ?` with the same relevance block. Adjust the dynamic bind sequence (it builds `feed_predicate` + verb placeholders) so the extra `viewer` binds are pushed in order.
- [ ] Tests in `test/activity_read.rs`:
  - broadcast `video_added` (NULL target) on technique T: appears for a student with T assigned; for a student with T pinned; NOT for a student without T.
  - broadcast `syllabus_technique_added` on syllabus S: appears only for a student assigned to S.
  - unpinning / unassigning removes it from that student's feed.
  - gym (coach) feed returns the broadcast row exactly once.
  - `unread_count`: broadcast counts as unread for a relevant student, 0 for a non-relevant one.
- [ ] `nix develop .#ci --command just sqlx-prepare`; `... cargo nextest run --workspace --all-features -E 'test(activity)'` green.
- [ ] Commit: `feat(activity): Resolve broadcast-event relevance at read time.`

## Task C: Caption names the video

**Files:** `frontend/src/lib/activity-caption.ts`, `frontend/src/lib/activity-caption.unit.test.ts`.

- [ ] Change the video arms to use the title (fallback to "a video"):
  ```ts
  case "video_watched":
    return { text: row.video_title ? `Watched ${row.video_title}` : "Watched a video" };
  case "video_added":
    return { text: row.video_title ? `Added ${row.video_title}` : "Added a video" };
  ```
- [ ] Update the unit test: `video_watched` with `video_title: "Drill"` -> "Watched Drill"; without -> "Watched a video".
- [ ] `pnpm exec tsc -b && pnpm lint && pnpm vitest run --project node activity-caption` green.
- [ ] Commit: `feat(activity): Name the watched/added video in the tile caption.`

## Task D: Verify, wipe staging, ship

- [ ] Full backend: clippy `--all-features -D warnings`; `cargo nextest run --workspace --all-features` green; `.sqlx/` committed.
- [ ] Full frontend gate green; `pnpm build`.
- [ ] Rebase onto main; push.
- [ ] Deploy staging. After deploy, wipe staging activity: `DELETE FROM activity_seen_overrides; DELETE FROM activity; DELETE FROM activity_cursors;` (via the staging DB), so the feed starts clean under the new model.
- [ ] Smoke: gym feed shows one tile per broadcast event; a student feed shows a broadcast only for techniques they have assigned/pinned; the caption names the video.
