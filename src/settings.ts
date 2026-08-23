import { getDb } from "./db";

export async function getContributorName(): Promise<string | null> {
  const db = await getDb();
  const rows = (await db.select("SELECT contributor_name FROM user_settings WHERE id = 1")) as {
    contributor_name: string | null;
  }[];
  return rows[0]?.contributor_name ?? null;
}

export async function setContributorName(name: string): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE user_settings SET contributor_name = $1 WHERE id = 1", [name]);
}