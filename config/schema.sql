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
    reset_requested_at TIMESTAMP,
    belt TEXT,
    stripes INTEGER,
    last_graded_at TIMESTAMP
);

-- Append-only log of rank changes. Read by the activity feed (M5) to
-- emit one-off `rank_change` items per the implementation plan, and
-- as a record of which coach awarded each grading.
CREATE TABLE IF NOT EXISTS rank_audit (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    belt TEXT,
    stripes INTEGER,
    last_graded_at TIMESTAMP,
    changed_by_id INTEGER NOT NULL REFERENCES users(id),
    changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_rank_audit_user_changed
    ON rank_audit(user_id, changed_at DESC);

-- Pinned techniques (M6 / SD-003). A student "pins" a global library
-- technique to their personal working-on list, independent of any
-- syllabus assignment. `unpinned_at` is the soft-delete column so
-- threads and comments tied to a pinned context survive an unpin
-- (re-pinning later restores the row by setting unpinned_at = NULL).
CREATE TABLE IF NOT EXISTS pinned_techniques (
    id INTEGER PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    technique_id INTEGER NOT NULL REFERENCES techniques(id) ON DELETE CASCADE,
    pinned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    unpinned_at TIMESTAMP,
    UNIQUE (student_id, technique_id)
);
CREATE INDEX IF NOT EXISTS idx_pinned_techniques_student_active
    ON pinned_techniques(student_id, pinned_at DESC) WHERE unpinned_at IS NULL;

-- Shared (student, technique) notes (M6 / SD-004). Notes are keyed by
-- the pair, not by the syllabus assignment row, so the same text
-- appears across syllabus / pinned / camp views of the same technique
-- for the same student. Dual-read during the M6 migration window:
-- callers read from here first, fall back to the legacy
-- student_techniques.{student,coach}_notes columns when the row is
-- absent, and write to BOTH until the M16 cleanup drops the legacy
-- columns.
CREATE TABLE IF NOT EXISTS technique_notes (
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    technique_id INTEGER NOT NULL REFERENCES techniques(id) ON DELETE CASCADE,
    student_notes TEXT,
    coach_notes TEXT,
    last_coach_update_at TIMESTAMP,
    last_coach_update_by_id INTEGER REFERENCES users(id),
    last_student_update_at TIMESTAMP,
    last_student_update_by_id INTEGER REFERENCES users(id),
    PRIMARY KEY (student_id, technique_id)
);
CREATE INDEX IF NOT EXISTS idx_technique_notes_student_coach_update
    ON technique_notes(student_id, last_coach_update_at DESC);

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
    technique_id INTEGER NOT NULL REFERENCES techniques (id) ON DELETE CASCADE,
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
    -- M7 video parent polymorphism (CX-018). Until M16 cleanup, both
    -- `technique_id` (legacy) and `(parent_kind, parent_id)` are kept in
    -- sync so legacy read paths still work while new ones (camps, matches,
    -- threads, profile, loose) flow through the polymorphic columns.
    -- parent_kind ∈ {technique, camp, match, profile, thread, loose}.
    -- parent_id is NULL only for `loose`. The migrate binary backfills
    -- `parent_id = technique_id` after the columns land.
    parent_kind TEXT NOT NULL DEFAULT 'technique',
    parent_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_videos_technique_position
    ON videos (technique_id, position);
CREATE INDEX IF NOT EXISTS idx_videos_status
    ON videos (processing_status);
CREATE INDEX IF NOT EXISTS idx_videos_alive_by_technique
    ON videos (technique_id) WHERE deleted_at IS NULL;
-- Per-kind indexes for the polymorphic parent. The legacy
-- `idx_videos_technique_position` / `idx_videos_alive_by_technique` indexes
-- above stay until the M16 cleanup drops `videos.technique_id`.
CREATE INDEX IF NOT EXISTS idx_videos_parent_position
    ON videos (parent_kind, parent_id, position);
CREATE INDEX IF NOT EXISTS idx_videos_alive_by_parent
    ON videos (parent_kind, parent_id) WHERE deleted_at IS NULL;

-- Per-student visibility override for a single video. A row exists only
-- when a coach has explicitly set a non-default visibility for that
-- (student, video). `visible = 1` forces the video to show even when the
-- global hide is set; `visible = 0` forces it hidden even when the global
-- default is visible. Absence of a row = follow the global default.
-- Per-(video, student) visibility overrides scoped to the syllabus
-- context. Layered on top of `videos.hidden_at` (the global hide).
-- The `Camp(camp_id)` context (M8) will live in a separate table
-- (`camp_video_visibility`) so a video hidden for a student in one
-- camp doesn't ripple into other contexts. Library / thread / pinned
-- contexts only check `videos.hidden_at`; per-student overrides do
-- not apply there.
-- Historically named `video_student_visibility` — kept as-is to avoid
-- a destructive rename migration. Code refers to this table via the
-- `Syllabus` arm of `VisibilityContext`.
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

-- Litestream-owned bookkeeping tables. Declared here only so the migration
-- engine recognises them as expected and doesn't try to drop them. Litestream
-- creates and maintains the rows; the app never reads or writes them.
CREATE TABLE IF NOT EXISTS _litestream_lock (id INTEGER);
CREATE TABLE IF NOT EXISTS _litestream_seq (id INTEGER PRIMARY KEY, seq INTEGER);
