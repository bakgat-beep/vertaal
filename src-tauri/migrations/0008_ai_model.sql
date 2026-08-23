ALTER TABLE projects ADD COLUMN ai_model TEXT;

UPDATE projects SET ai_model = 'translategemma:4b' WHERE ai_model IS NULL;