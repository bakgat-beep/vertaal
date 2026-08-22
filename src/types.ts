export interface EditorRow {
  key: string;
  game_id: string;
  source_text: string;
  context_label: string | null;
  translated_text: string | null;
  status: string | null;
  flagged: number | null;
  translated_by: string | null;
  updated_at: string | null;
  file_path?: string | null;
}

export interface Project {
  id: number;
  game_id: string;
  source_language: string;
  target_language: string;
  mod_name: string;
  output_path: string | null;
  install_path: string | null;
}