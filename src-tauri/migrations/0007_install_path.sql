ALTER TABLE projects ADD COLUMN install_path TEXT;

UPDATE projects
SET install_path = 'C:\Program Files (x86)\Steam\steamapps\common\Europa Universalis V\game'
WHERE game_id = 'eu5' AND install_path IS NULL;