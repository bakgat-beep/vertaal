DELETE FROM translations
WHERE id NOT IN (
  SELECT MAX(id) FROM translations GROUP BY string_key, game_id
);

CREATE UNIQUE INDEX idx_translations_unique ON translations(string_key, game_id);