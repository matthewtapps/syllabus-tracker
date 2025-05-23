pub const CURRENT_SCHEMA: &str = r#"
PRAGMA foreign_keys = 1;

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL,
    password TEXT NOT NULL DEFAULT '',
    display_name TEXT,
    archived BOOLEAN NOT NULL DEFAULT FALSE
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
    FOREIGN KEY (technique_id) REFERENCES techniques (id),
    FOREIGN KEY (student_id) REFERENCES users (id)
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
"#;
