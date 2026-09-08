
ALTER TABLE projects ADD COLUMN project_type TEXT NOT NULL DEFAULT 'vanilla';
ALTER TABLE projects ADD COLUMN parent_game_id TEXT;
ALTER TABLE projects ADD COLUMN source_mod_name TEXT;
ALTER TABLE projects ADD COLUMN source_mod_identifier TEXT;

UPDATE projects SET parent_game_id = game_id WHERE parent_game_id IS NULL;