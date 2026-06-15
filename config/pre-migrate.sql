-- Pre-migration data repairs.
--
-- Idempotent SQL applied (with foreign_keys=ON) by the migrate binary BEFORE
-- the declarative schema sync in schema.sql. Its job is to clean pre-existing
-- FK orphans created in the past when FK enforcement was off, so that a table
-- rebuild's post-rebuild `PRAGMA foreign_key_check` does not roll back the
-- migration. Every statement here must be safe to run on every deploy (a clean
-- DB makes them all no-ops).

-- videos -> techniques: rows whose technique was hard-deleted without the
-- ON DELETE CASCADE firing (FK was off at delete time). The video can never
-- resolve its parent technique, so delete it. With foreign_keys=ON this
-- cascades to watch events/aggregates, per-student visibility overrides, and
-- timestamp threads via their own ON DELETE CASCADE FKs -- i.e. exactly what
-- the technique delete should have done in the first place.
DELETE FROM videos
 WHERE technique_id IS NOT NULL
   AND technique_id NOT IN (SELECT id FROM techniques);

-- videos -> users (uploader): rows whose uploader was deleted. The footage is
-- still good, so keep it and reassign attribution to the lowest-id admin
-- (falling back to the lowest-id user if somehow no admin exists) rather than
-- destroying content.
UPDATE videos
   SET uploaded_by_id = (
        SELECT id FROM users ORDER BY (role = 'admin') DESC, id ASC LIMIT 1
   )
 WHERE uploaded_by_id NOT IN (SELECT id FROM users);

-- activity / threads -> videos: rows that reference a video which no longer
-- exists. The video was hard-deleted without its ON DELETE CASCADE firing,
-- orphaning these rows. They are already hidden from the feed by the read-time
-- orphan filter, but the videos-table rebuild's foreign_key_check would
-- otherwise roll back on them. Delete them (cascading to activity seen-overrides
-- and thread comments) -- the cleanup the video delete should have done.
-- NB: nulling video_id is wrong here -- the feed filter keeps rows where
-- video_id IS NULL, which would resurface them as bare "watched a video" lines.
DELETE FROM activity WHERE video_id IS NOT NULL AND video_id NOT IN (SELECT id FROM videos);
DELETE FROM threads  WHERE video_id IS NOT NULL AND video_id NOT IN (SELECT id FROM videos);
