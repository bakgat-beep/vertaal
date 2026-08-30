import { getDb } from "./db";
import { encryptSecret, decryptSecret } from "./crypto";

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

export async function getGithubToken(): Promise<string | null> {
  const db = await getDb();
  const rows = (await db.select("SELECT github_token FROM user_settings WHERE id = 1")) as {
    github_token: string | null;
  }[];
  const stored = rows[0]?.github_token ?? null;
  return stored ? await decryptSecret(stored) : null;
}

export async function setGithubToken(token: string): Promise<void> {
  const db = await getDb();
  const encrypted = await encryptSecret(token);
  await db.execute("UPDATE user_settings SET github_token = $1 WHERE id = 1", [encrypted]);
}