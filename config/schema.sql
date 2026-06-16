CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT UNIQUE,
    role TEXT NOT NULL,
    password TEXT NOT NULL DEFAULT '',
    display_name TEXT,
    archived BOOLEAN NOT NULL DEFAULT FALSE,
    graduated_at TIMESTAMP,
    graduated_by_id INTEGER REFERENCES users(id),
    email TEXT,
    claimed_at TIMESTAMP,
    approved_at TIMESTAMP,
    first_name TEXT,
    last_name TEXT,
    reset_requested_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS techniques (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    coach_id INTEGER,
    coach_name TEXT,
    FOREIGN KEY (coach_id) REFERENCES users (id)
);

CREATE TABLE IF NOT EXISTS student_techniques (
    id INTEGER PRIMARY KEY,
    technique_id INTEGER,
    technique_name TEXT,
    technique_description TEXT,
    student_id INTEGER,
    status TEXT DEFAULT 'red',
    student_notes TEXT,
    coach_notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_coach_update_at TIMESTAMP,
    last_coach_update_by_id INTEGER,
    last_student_update_at TIMESTAMP,
    last_student_update_by_id INTEGER,
    collection_id INTEGER,
    FOREIGN KEY (technique_id) REFERENCES techniques (id),
    FOREIGN KEY (student_id) REFERENCES users (id),
    FOREIGN KEY (last_coach_update_by_id) REFERENCES users (id),
    FOREIGN KEY (last_student_update_by_id) REFERENCES users (id),
    FOREIGN KEY (collection_id) REFERENCES collections (id)
);

CREATE TABLE IF NOT EXISTS student_technique_views (
    student_technique_id INTEGER NOT NULL REFERENCES student_techniques(id) ON DELETE CASCADE,
    user_id              INTEGER NOT NULL REFERENCES users(id)              ON DELETE CASCADE,
    seen_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (student_technique_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_stv_user ON student_technique_views(user_id);

CREATE TABLE IF NOT EXISTS collections (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    coach_id INTEGER REFERENCES users (id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS collection_techniques (
    collection_id INTEGER NOT NULL REFERENCES collections (id) ON DELETE CASCADE,
    technique_id INTEGER NOT NULL REFERENCES techniques (id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (collection_id, technique_id)
);

CREATE TABLE IF NOT EXISTS invite_tokens (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_sessions (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS technique_tags (
    technique_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (technique_id, tag_id),
    FOREIGN KEY (technique_id) REFERENCES techniques (id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attempts (
    id INTEGER PRIMARY KEY,
    student_technique_id INTEGER NOT NULL REFERENCES student_techniques (id) ON DELETE CASCADE,
    recorded_by_id INTEGER NOT NULL REFERENCES users (id),
    attempted_at TIMESTAMP NOT NULL,
    coach_note TEXT,
    coach_note_by_id INTEGER REFERENCES users (id),
    coach_note_at TIMESTAMP,
    student_note TEXT,
    student_note_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_attempts_student_technique
    ON attempts (student_technique_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_attempts_recorder
    ON attempts (recorded_by_id, attempted_at DESC);

CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY,
    -- Parent is polymorphic (typed-column pattern, mirrors threads.anchor_kind).
    -- DEFAULT 'technique' so the declarative table-rebuild backfills existing
    -- rows (which all have technique_id set) into the technique branch.
    parent_kind TEXT NOT NULL DEFAULT 'technique' CHECK (parent_kind IN (
        'technique', 'student_profile', 'thread', 'loose'
    )),
    technique_id INTEGER REFERENCES techniques (id) ON DELETE CASCADE,
    student_id INTEGER REFERENCES users (id) ON DELETE CASCADE,
    thread_id INTEGER REFERENCES threads (id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    kind TEXT NOT NULL,
    processing_status TEXT NOT NULL,
    processing_error TEXT,
    storage_key TEXT,
    bytes INTEGER,
    duration_seconds INTEGER,
    width INTEGER,
    height INTEGER,
    external_url TEXT,
    external_host TEXT,
    external_video_id TEXT,
    uploaded_by_id INTEGER NOT NULL REFERENCES users (id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- Soft delete. Set to mark a video gone from the UI while keeping the
    -- row, storage_key, and watch history intact so it can be recovered.
    -- All read queries must filter `deleted_at IS NULL`. There is no UI to
    -- undelete yet; a coach who deletes by mistake currently needs an
    -- operator to clear this column out of band.
    deleted_at TIMESTAMP,
    -- Global hide. When set, students don't see the video at all (unless
    -- they have an explicit per-student override row pointing the other
    -- way). Coaches still see the video, badged "Hidden".
    hidden_at TIMESTAMP,
    CHECK (
      (parent_kind = 'technique'       AND technique_id IS NOT NULL AND student_id IS NULL     AND thread_id IS NULL) OR
      (parent_kind = 'student_profile' AND student_id IS NOT NULL    AND technique_id IS NULL   AND thread_id IS NULL) OR
      (parent_kind = 'thread'          AND thread_id IS NOT NULL      AND technique_id IS NULL   AND student_id IS NULL) OR
      (parent_kind = 'loose'           AND technique_id IS NULL       AND student_id IS NULL     AND thread_id IS NULL)
    )
);
CREATE INDEX IF NOT EXISTS idx_videos_technique_position
    ON videos (technique_id, position);
CREATE INDEX IF NOT EXISTS idx_videos_status
    ON videos (processing_status);
CREATE INDEX IF NOT EXISTS idx_videos_alive_by_technique
    ON videos (technique_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_videos_parent
    ON videos (parent_kind, technique_id, student_id, thread_id);

-- Per-student visibility override for a single video. A row exists only
-- when a coach has explicitly set a non-default visibility for that
-- (student, video). `visible = 1` forces the video to show even when the
-- global hide is set; `visible = 0` forces it hidden even when the global
-- default is visible. Absence of a row = follow the global default.
CREATE TABLE IF NOT EXISTS video_student_visibility (
    video_id INTEGER NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    visible BOOLEAN NOT NULL,
    set_by_id INTEGER REFERENCES users (id),
    set_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (video_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_vsv_student
    ON video_student_visibility (student_id);

CREATE TABLE IF NOT EXISTS video_watch_events (
    id INTEGER PRIMARY KEY,
    video_id INTEGER NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    event TEXT NOT NULL,
    seconds_watched INTEGER,
    play_id TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_watch_events_video_user
    ON video_watch_events (video_id, user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_watch_events_user
    ON video_watch_events (user_id, created_at);

CREATE TABLE IF NOT EXISTS video_watch_aggregates (
    video_id INTEGER NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    play_count INTEGER NOT NULL DEFAULT 0,
    completed_count INTEGER NOT NULL DEFAULT 0,
    total_seconds_watched INTEGER NOT NULL DEFAULT 0,
    first_watched_at TIMESTAMP,
    last_watched_at TIMESTAMP,
    PRIMARY KEY (video_id, user_id)
);

CREATE TABLE IF NOT EXISTS video_privacy_acks (
    user_id INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    acked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Per-student personal pin list, drawn from the global techniques library.
-- Independent of any syllabus or assignment; the student curates this
-- themselves. Replaces the "I want quick access to these" mental model
-- that the legacy student_techniques table conflated with coach-assigned
-- progress tracking.
CREATE TABLE IF NOT EXISTS student_pinned_techniques (
    student_id   INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    technique_id INTEGER NOT NULL REFERENCES techniques (id) ON DELETE CASCADE,
    pinned_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (student_id, technique_id)
);
CREATE INDEX IF NOT EXISTS idx_spt_student ON student_pinned_techniques (student_id);

-- New "syllabus" stack (PR 3). Parallel to legacy collections /
-- student_techniques / attempts. From PR 3 onward all new writes flow
-- through these tables; legacy surfaces are read-only and get deleted
-- in PR 5.

-- Coach-owned, reusable, named collection of techniques. Replaces the
-- conceptual use of `collections` going forward; legacy `collections`
-- stays on disk but loses all UI call sites by PR 5.
CREATE TABLE IF NOT EXISTS syllabi (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    description   TEXT,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by_id INTEGER REFERENCES users (id),
    updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Membership of techniques in a syllabus, with display ordering.
CREATE TABLE IF NOT EXISTS syllabus_techniques (
    syllabus_id  INTEGER NOT NULL REFERENCES syllabi (id) ON DELETE CASCADE,
    technique_id INTEGER NOT NULL REFERENCES techniques (id) ON DELETE CASCADE,
    position     INTEGER NOT NULL DEFAULT 0,
    added_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    added_by_id  INTEGER REFERENCES users (id),
    PRIMARY KEY (syllabus_id, technique_id)
);
CREATE INDEX IF NOT EXISTS idx_st_position
    ON syllabus_techniques (syllabus_id, position);

-- Which student has been assigned which syllabus. UNIQUE on
-- (student_id, syllabus_id) holds even across soft-unassign: re-assigning
-- the same pair clears `unassigned_at` rather than creating a new row, so
-- the per-(assignment, technique) SST history is preserved.
CREATE TABLE IF NOT EXISTS syllabus_assignments (
    id               INTEGER PRIMARY KEY,
    student_id       INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    syllabus_id      INTEGER NOT NULL REFERENCES syllabi (id) ON DELETE CASCADE,
    assigned_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    assigned_by_id   INTEGER REFERENCES users (id),
    unassigned_at    TIMESTAMP,
    unassigned_by_id INTEGER REFERENCES users (id),
    graduated_at     TIMESTAMP,
    graduated_by_id  INTEGER REFERENCES users (id),
    UNIQUE (student_id, syllabus_id)
);
CREATE INDEX IF NOT EXISTS idx_sa_student_active
    ON syllabus_assignments (student_id) WHERE unassigned_at IS NULL;

-- Per-(assignment, technique) progress row. UNIQUE(assignment_id,
-- technique_id) holds. Eager materialization: on assign (or re-assign),
-- one row per current `syllabus_techniques` member is inserted with
-- default `status = 'red'`. On re-assign, existing rows are preserved
-- including `hidden_at` so coach curation isn't silently undone.
--
-- `coach_notes` is student-readable (matches legacy `student_techniques`).
-- The `last_coach_update_*` and `last_student_update_*` pairs are bumped
-- by the SST update helper based on the *actor's role*, not on which
-- field changed: a coach writing student_notes (rare, but allowed when
-- editing a graduated assignment) still bumps the coach pair.
CREATE TABLE IF NOT EXISTS student_syllabus_techniques (
    id                        INTEGER PRIMARY KEY,
    assignment_id             INTEGER NOT NULL REFERENCES syllabus_assignments (id) ON DELETE CASCADE,
    technique_id              INTEGER NOT NULL REFERENCES techniques (id) ON DELETE CASCADE,
    status                    TEXT NOT NULL DEFAULT 'red'
                                    CHECK (status IN ('red', 'amber', 'green')),
    student_notes             TEXT,
    coach_notes               TEXT,
    hidden_at                 TIMESTAMP,
    hidden_by_id              INTEGER REFERENCES users (id),
    created_at                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_coach_update_at      TIMESTAMP,
    last_coach_update_by_id   INTEGER REFERENCES users (id),
    last_student_update_at    TIMESTAMP,
    last_student_update_by_id INTEGER REFERENCES users (id),
    UNIQUE (assignment_id, technique_id)
);
CREATE INDEX IF NOT EXISTS idx_sst_assignment
    ON student_syllabus_techniques (assignment_id);

-- Attempts logged against an SST row. Parallel to legacy `attempts`,
-- which now stays dormant. `attempted_at` is client-supplied (coaches
-- can log "attempt on last Tuesday"); the handler validates it is not
-- in the future. `created_at` is server-set.
CREATE TABLE IF NOT EXISTS syllabus_attempts (
    id                            INTEGER PRIMARY KEY,
    student_syllabus_technique_id INTEGER NOT NULL REFERENCES student_syllabus_techniques (id) ON DELETE CASCADE,
    recorded_by_id                INTEGER NOT NULL REFERENCES users (id),
    attempted_at                  TIMESTAMP NOT NULL,
    coach_note                    TEXT,
    coach_note_by_id              INTEGER REFERENCES users (id),
    coach_note_at                 TIMESTAMP,
    student_note                  TEXT,
    student_note_at               TIMESTAMP,
    created_at                    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sat_sst
    ON syllabus_attempts (student_syllabus_technique_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_sat_recorder
    ON syllabus_attempts (recorded_by_id, attempted_at DESC);

-- Per-(student, syllabus, video) visibility overrides. Replaces the
-- legacy per-(student, video) override table for syllabus context.
-- Library context (PR 1) ignores these and shows global visibility.
CREATE TABLE IF NOT EXISTS student_syllabus_video_visibility (
    student_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    syllabus_id   INTEGER NOT NULL REFERENCES syllabi (id) ON DELETE CASCADE,
    video_id      INTEGER NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
    visible       BOOLEAN NOT NULL,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by_id INTEGER REFERENCES users (id),
    PRIMARY KEY (student_id, syllabus_id, video_id)
);
CREATE INDEX IF NOT EXISTS idx_ssvv_student_syllabus
    ON student_syllabus_video_visibility (student_id, syllabus_id);

CREATE TABLE IF NOT EXISTS activity (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    occurred_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    verb              TEXT    NOT NULL,
    actor_user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_student_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    technique_id      INTEGER REFERENCES techniques(id) ON DELETE SET NULL,
    syllabus_id       INTEGER REFERENCES syllabi(id)    ON DELETE SET NULL,
    sst_id            INTEGER REFERENCES student_syllabus_techniques(id) ON DELETE SET NULL,
    video_id          INTEGER REFERENCES videos(id)     ON DELETE SET NULL,
    thread_id         INTEGER REFERENCES threads(id)    ON DELETE SET NULL,
    payload_json      TEXT,
    -- Names the surface a student was on when the activity happened, so the
    -- feed can deep-link back to it without inferring from which reference
    -- column is non-null. NULL when the verb implies its own context
    -- (attempts/notes are always syllabus-scoped). Today: 'library' | 'syllabus'.
    context_kind TEXT
);

CREATE INDEX IF NOT EXISTS idx_activity_student
    ON activity (target_student_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_activity_syllabus
    ON activity (syllabus_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_activity_technique
    ON activity (technique_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_activity_recent
    ON activity (occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_activity_coalesce
    ON activity (actor_user_id, verb, occurred_at DESC);

CREATE TABLE IF NOT EXISTS activity_cursors (
    viewer_user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    max_seen_id    INTEGER NOT NULL DEFAULT 0,
    updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS activity_seen_overrides (
    viewer_user_id INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    activity_id    INTEGER NOT NULL REFERENCES activity(id) ON DELETE CASCADE,
    seen           BOOLEAN NOT NULL,
    PRIMARY KEY (viewer_user_id, activity_id)
);
CREATE INDEX IF NOT EXISTS idx_aso_viewer ON activity_seen_overrides (viewer_user_id);

CREATE TABLE IF NOT EXISTS threads (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body            TEXT NOT NULL,

    anchor_kind     TEXT NOT NULL CHECK (anchor_kind IN (
                        'student_profile','technique','video',
                        'video_timestamp','sst','pinned_technique')),

    student_id      INTEGER REFERENCES users(id)                       ON DELETE CASCADE,
    technique_id    INTEGER REFERENCES techniques(id)                  ON DELETE CASCADE,
    video_id        INTEGER REFERENCES videos(id)                      ON DELETE CASCADE,
    video_ts_seconds INTEGER,
    sst_id          INTEGER REFERENCES student_syllabus_techniques(id) ON DELETE CASCADE,

    visibility      TEXT NOT NULL DEFAULT 'broadcast'
                        CHECK (visibility IN ('broadcast','private')),
    scope_student_id INTEGER REFERENCES users(id) ON DELETE CASCADE,

    last_activity_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at      TIMESTAMP,
    deleted_by_id   INTEGER REFERENCES users(id),

    CHECK (
      (anchor_kind='student_profile'  AND student_id IS NOT NULL AND technique_id IS NULL AND video_id IS NULL AND video_ts_seconds IS NULL AND sst_id IS NULL) OR
      (anchor_kind='technique'        AND technique_id IS NOT NULL AND student_id IS NULL AND video_id IS NULL AND video_ts_seconds IS NULL AND sst_id IS NULL) OR
      (anchor_kind='video'            AND video_id IS NOT NULL AND video_ts_seconds IS NULL AND student_id IS NULL AND technique_id IS NULL AND sst_id IS NULL) OR
      (anchor_kind='video_timestamp'  AND video_id IS NOT NULL AND video_ts_seconds IS NOT NULL AND student_id IS NULL AND technique_id IS NULL AND sst_id IS NULL) OR
      (anchor_kind='sst'              AND sst_id IS NOT NULL AND student_id IS NULL AND technique_id IS NULL AND video_id IS NULL AND video_ts_seconds IS NULL) OR
      (anchor_kind='pinned_technique' AND student_id IS NOT NULL AND technique_id IS NOT NULL AND video_id IS NULL AND video_ts_seconds IS NULL AND sst_id IS NULL)
    ),
    CHECK (
      (visibility='private'   AND scope_student_id IS NOT NULL) OR
      (visibility='broadcast' AND scope_student_id IS NULL)
    ),
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
    parent_comment_id INTEGER REFERENCES thread_comments(id) ON DELETE CASCADE,
    author_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body              TEXT NOT NULL,
    created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    edited_at         TIMESTAMP,
    deleted_at        TIMESTAMP,
    deleted_by_id     INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_thread_comments_thread ON thread_comments(thread_id, created_at);

-- Litestream-owned bookkeeping tables. Declared here only so the migration
-- engine recognises them as expected and doesn't try to drop them. Litestream
-- creates and maintains the rows; the app never reads or writes them.
CREATE TABLE IF NOT EXISTS _litestream_lock (id INTEGER);
CREATE TABLE IF NOT EXISTS _litestream_seq (id INTEGER PRIMARY KEY, seq INTEGER);
