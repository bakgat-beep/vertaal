-- Stage 8: speed.
-- The editor lists strings ordered by (file_path, key) for one game, so page
-- loads and "next page" had to sort the whole game every time. This index lets
-- the database read them already in order.
CREATE INDEX IF NOT EXISTS idx_strings_game_file_key ON strings(game_id, file_path, key);
-- The History panel looks up one string's versions by key, game and language.
CREATE INDEX IF NOT EXISTS idx_translation_history_lookup ON translation_history(string_key, game_id, target_language);
-- Cost: roughly 47 MB of extra disk space on a database of about 137 MB.