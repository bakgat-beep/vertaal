ALTER TABLE projects ADD COLUMN translation_provider_id TEXT;
UPDATE projects SET translation_provider_id = 'ollama' WHERE translation_provider_id IS NULL;

-- Provider credentials are account-level (one DeepL key covers every project
-- using DeepL), not per-project — same reasoning as the GitHub token living
-- in user_settings rather than on individual projects.
CREATE TABLE provider_credentials (
    provider_id TEXT PRIMARY KEY,
    api_key TEXT,
    base_url TEXT
);