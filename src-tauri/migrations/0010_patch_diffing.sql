ALTER TABLE translations ADD COLUMN source_hash_at_translation TEXT;

-- Existing translations have no recorded "translated against" hash yet.
-- Assume they're current as of today, so nothing gets flagged as outdated
-- retroactively — only future patches will trigger the new detection.
UPDATE translations
SET source_hash_at_translation = (
  SELECT source_text_hash FROM strings s
  WHERE s.key = translations.string_key AND s.game_id = translations.game_id
)
WHERE source_hash_at_translation IS NULL;