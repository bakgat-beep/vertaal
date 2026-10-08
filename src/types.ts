export interface EditorRow {
  key: string;
  game_id: string;
  source_text: string;
  source_text_hash: string;
  context_label: string | null;
  translated_text: string | null;
  status: string | null;
  flagged: number | null;
  translated_by: string | null;
  updated_at: string | null;
  file_path?: string | null;
  category?: string | null;
  subcategory?: string | null;
  // The complete source text this translation was made against; compared with
  // source_text to detect that the game's text changed (see sourceChange.ts).
  source_text_at_translation: string | null;
  // Set when the last import that rescanned this string's file no longer
  // found it there (most often a game patch). NULL means it's still present.
  removed_at?: string | null;
}
export interface Project {
  id: number;
  created_at: string;
  game_id: string;
  source_language: string;
  target_language: string;
  mod_name: string;
  output_path: string | null;
  install_path: string | null;
  ai_model: string | null;
  translation_provider_id: string | null;
  retry_delay_ms: number | null;
  google_translate_delay_ms: number | null;
  source_language_code_override: string | null;
  target_language_code_override: string | null;
  project_type: "vanilla" | "mod";
  parent_game_id: string;
  source_mod_name: string | null;
  source_mod_identifier: string | null;
  git_repo_path: string | null;
  git_remote_url: string | null;
  hidden_from_recent: number;
}