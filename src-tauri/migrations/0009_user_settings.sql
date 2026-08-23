CREATE TABLE user_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    contributor_name TEXT
);

INSERT INTO user_settings (id, contributor_name) VALUES (1, NULL);