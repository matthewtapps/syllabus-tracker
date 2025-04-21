CREATE TABLE IF NOT EXISTS techniques (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    coach_id INTEGER,
    coach_name TEXT,
    FOREIGN KEY (coach_id) REFERENCES users (id)
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL
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

INSERT OR IGNORE INTO users (username, role)
SELECT
    'coach1',
    'coach'
WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE role = 'coach'
);


INSERT OR IGNORE INTO users (username, role)
SELECT
    'student1',
    'student'
WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE role = 'student'
);


INSERT INTO techniques (name, description, coach_id, coach_name)
VALUES ('test technique', 'practice', 1, 'coach1');
