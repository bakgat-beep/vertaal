import Database from "@tauri-apps/plugin-sql";

const DB_PATH = "sqlite:pdx-afrikaans.db";

export async function getDb() {
  return await Database.load(DB_PATH);
}