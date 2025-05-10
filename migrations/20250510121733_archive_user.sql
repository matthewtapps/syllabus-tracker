ALTER TABLE users ADD COLUMN archived BOOLEAN;

UPDATE users SET archived = FALSE;
