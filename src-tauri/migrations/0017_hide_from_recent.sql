-- Lets a project be dismissed from the Recent Projects list without deleting
-- it — the project, its settings, and all translated strings stay intact and
-- reopenable; this only controls whether it shows up in the recent list.
ALTER TABLE projects ADD COLUMN hidden_from_recent INTEGER NOT NULL DEFAULT 0;