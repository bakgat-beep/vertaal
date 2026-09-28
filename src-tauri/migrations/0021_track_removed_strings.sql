-- Lets Vertaal tell you when a string that used to exist in the game's (or
-- mod's) files is no longer there — most often because a patch removed it.
-- NULL means "present as of the last import"; a timestamp means "not seen in
-- the last import that scanned this game's files". Reappearing in a later
-- import clears it back to NULL.
ALTER TABLE strings ADD COLUMN removed_at TEXT DEFAULT NULL;