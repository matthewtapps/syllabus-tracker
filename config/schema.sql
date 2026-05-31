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
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_videos_technique_position
    ON videos (technique_id, position);
CREATE INDEX IF NOT EXISTS idx_videos_status
    ON videos (processing_status);

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
