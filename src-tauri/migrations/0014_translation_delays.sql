ALTER TABLE projects ADD COLUMN retry_delay_ms INTEGER;
ALTER TABLE projects ADD COLUMN google_translate_delay_ms INTEGER;

UPDATE projects SET retry_delay_ms = 2000 WHERE retry_delay_ms IS NULL;
UPDATE projects SET google_translate_delay_ms = 500 WHERE google_translate_delay_ms IS NULL;