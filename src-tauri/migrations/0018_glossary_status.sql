-- Manual status for a glossary term. Only ever 'preferred' or 'review' —
-- "untranslated" is never stored here; it's derived in application code
-- whenever translated_term is empty, so status can't contradict the data.
ALTER TABLE glossary ADD COLUMN status TEXT NOT NULL DEFAULT 'preferred';