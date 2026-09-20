-- Compact change tracking.
--
-- Migration 0019 made every translation store a full copy of the source text
-- it was made against. That is exact, but it duplicates every translated
-- string. From now on the old wording is stored ONLY for translations whose
-- source text has actually changed since they were made:
--
--   translations.source_text_at_translation
--     NULL      = translated against the CURRENT source text (nothing extra stored)
--     some text = the earlier source text it was translated against; the string
--                 counts as "changed" while that differs from the current source
--
-- The database keeps this true by itself, using triggers, so it cannot be
-- forgotten by any part of the app. Detection is still an exact, full-text
-- comparison — nothing can slip through, and the editor can still show what
-- changed.

-- 1) Drop the redundant copies that 0019 stored: wherever the stored text is
--    identical to the current source, it carries no information.
UPDATE translations
SET source_text_at_translation = NULL
WHERE source_text_at_translation IS NOT NULL
  AND source_text_at_translation = (
    SELECT s.source_text FROM strings s
    WHERE s.key = translations.string_key AND s.game_id = translations.game_id
  );

-- 2) Whenever a translation is saved together with the source text it was made
--    against, and that text is the same as the current source, store nothing.
--    (Existing save code passes the current source text; this keeps it sparse.)
CREATE TRIGGER trg_translations_compact_insert
AFTER INSERT ON translations
WHEN NEW.source_text_at_translation IS NOT NULL
  AND NEW.source_text_at_translation = (
    SELECT s.source_text FROM strings s
    WHERE s.key = NEW.string_key AND s.game_id = NEW.game_id
  )
BEGIN
  UPDATE translations SET source_text_at_translation = NULL WHERE rowid = NEW.rowid;
END;

CREATE TRIGGER trg_translations_compact_update
AFTER UPDATE OF source_text_at_translation ON translations
WHEN NEW.source_text_at_translation IS NOT NULL
  AND NEW.source_text_at_translation = (
    SELECT s.source_text FROM strings s
    WHERE s.key = NEW.string_key AND s.game_id = NEW.game_id
  )
BEGIN
  UPDATE translations SET source_text_at_translation = NULL WHERE rowid = NEW.rowid;
END;

-- 3) When a string's source text changes (a re-import after a game patch),
--    remember the OLD wording for every translation that was up to date with it
--    (in every language), so it is now recognised as translated against an
--    earlier version. Translations that were already out of date keep the
--    original wording they were made against. If the text changes BACK to what
--    an out-of-date translation was made against, that translation is up to
--    date again. (Placeholder rows with no translation are left alone.)
CREATE TRIGGER trg_strings_source_changed
AFTER UPDATE OF source_text ON strings
WHEN OLD.source_text != NEW.source_text
BEGIN
  UPDATE translations
  SET source_text_at_translation = OLD.source_text
  WHERE string_key = NEW.key AND game_id = NEW.game_id
    AND source_text_at_translation IS NULL
    AND status != 'untranslated';

  UPDATE translations
  SET source_text_at_translation = NULL
  WHERE string_key = NEW.key AND game_id = NEW.game_id
    AND source_text_at_translation = NEW.source_text;
END;