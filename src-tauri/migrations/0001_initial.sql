CREATE TABLE games (
    game_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    detected_version TEXT
);

CREATE TABLE strings (
    key TEXT NOT NULL,
    game_id TEXT NOT NULL,
    source_text TEXT NOT NULL,
    source_text_hash TEXT NOT NULL,
    file_path TEXT,
    context_label TEXT,
    PRIMARY KEY (key, game_id),
    FOREIGN KEY (game_id) REFERENCES games(game_id)
);

CREATE TABLE translations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    string_key TEXT NOT NULL,
    game_id TEXT NOT NULL,
    translated_text TEXT,
    status TEXT NOT NULL DEFAULT 'untranslated',
    translated_by TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (string_key, game_id) REFERENCES strings(key, game_id)
);

CREATE TABLE translation_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    string_key TEXT NOT NULL,
    game_id TEXT NOT NULL,
    old_text TEXT,
    new_text TEXT,
    changed_by TEXT,
    changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE glossary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    english_term TEXT NOT NULL,
    afrikaans_term TEXT NOT NULL,
    notes TEXT
);

CREATE TABLE contributors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'translator'
);

CREATE TABLE app_settings (
    schema_version INTEGER NOT NULL
);

INSERT INTO app_settings (schema_version) VALUES (1);