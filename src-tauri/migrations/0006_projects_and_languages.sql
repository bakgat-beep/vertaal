-- A "project" is a saved game + source language + target language + mod configuration.
-- The welcome screen's project list will be rows from this table.
CREATE TABLE projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id TEXT NOT NULL,
    source_language TEXT NOT NULL DEFAULT 'english',
    target_language TEXT NOT NULL,
    mod_name TEXT NOT NULL,
    output_path TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed a project representing your existing EU5 → Afrikaans work, so nothing is orphaned.
INSERT INTO projects (game_id, source_language, target_language, mod_name, output_path)
VALUES ('eu5', 'english', 'afrikaans', 'Afrikaans Translation', NULL);

-- Every translation now belongs to a specific target language, not just a string+game.
-- Existing rows default to 'afrikaans', which is accurate for everything translated so far.
ALTER TABLE translations ADD COLUMN target_language TEXT NOT NULL DEFAULT 'afrikaans';

-- Replace the old uniqueness rule (one translation per string+game) with one that also
-- accounts for language, so French and Afrikaans translations of the same string can coexist.
DROP INDEX IF EXISTS idx_translations_unique;
CREATE UNIQUE INDEX idx_translations_unique ON translations(string_key, game_id, target_language);

ALTER TABLE translation_history ADD COLUMN target_language TEXT NOT NULL DEFAULT 'afrikaans';

-- Glossary becomes game-specific with shared fallback: game_id = NULL means "applies to all games".
-- Also renamed afrikaans_term -> translated_term, since it's no longer Afrikaans-specific.
ALTER TABLE glossary ADD COLUMN game_id TEXT;
ALTER TABLE glossary ADD COLUMN target_language TEXT NOT NULL DEFAULT 'afrikaans';
ALTER TABLE glossary RENAME COLUMN afrikaans_term TO translated_term;