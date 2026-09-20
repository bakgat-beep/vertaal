-- Exact "translated against" tracking.
--
-- Until now Vertaal spotted a changed source string by comparing a short
-- "fingerprint" (the text's length plus its first 20 characters). Any change
-- that kept the length and the opening 20 characters — e.g. "...levies by
-- 10%." becoming "...levies by 15%." — slipped through unnoticed.
--
-- From now on each translation remembers the COMPLETE source text it was made
-- against, and a string counts as "changed" whenever that text is not
-- character-for-character identical to the current source. There is nothing
-- to slip through, and it also lets the editor show exactly what changed.

ALTER TABLE translations ADD COLUMN source_text_at_translation TEXT;

-- 1) Translations the old check considered up to date (their fingerprint still
--    matched), or that never had one recorded: the current source text IS the
--    best record we have of what they were translated against.
UPDATE translations
SET source_text_at_translation = (
  SELECT s.source_text FROM strings s
  WHERE s.key = translations.string_key AND s.game_id = translations.game_id
)
WHERE translated_text IS NOT NULL AND translated_text != ''
  AND (
    source_hash_at_translation IS NULL
    OR source_hash_at_translation = (
      SELECT s.source_text_hash FROM strings s
      WHERE s.key = translations.string_key AND s.game_id = translations.game_id
    )
  );

-- 2) Translations the old check had ALREADY flagged as changed: keep them
--    flagged. The earlier wording was never stored, so this marker stands in
--    for it (the editor explains that it can't show what changed).
--    NOTE: this exact text is also SOURCE_TEXT_UNKNOWN in src/sourceChange.ts.
UPDATE translations
SET source_text_at_translation = '[[vertaal:older-source-not-recorded]]'
WHERE source_text_at_translation IS NULL
  AND translated_text IS NOT NULL AND translated_text != ''
  AND source_hash_at_translation IS NOT NULL;