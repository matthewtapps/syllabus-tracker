UPDATE users SET archived = FALSE
WHERE archived IS NULL;

CREATE TABLE users_new (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL,
    password TEXT NOT NULL DEFAULT '',
    display_name TEXT,
    archived BOOLEAN NOT NULL DEFAULT FALSE
);

INSERT INTO users_new (id, username, role, password, display_name, archived)
SELECT
    id,
    username,
    role,
    password,
    display_name,
    COALESCE(archived, FALSE)
FROM users;

DROP TABLE users;

ALTER TABLE users_new RENAME TO users;
