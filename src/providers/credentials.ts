import { getDb } from "../db";
import { encryptSecret, decryptSecret } from "../crypto";

export interface ProviderCredentials {
  apiKey: string | null;
  baseUrl: string | null;
}

export async function getProviderCredentials(providerId: string): Promise<ProviderCredentials> {
  const db = await getDb();
  const rows = (await db.select(
    "SELECT api_key, base_url FROM provider_credentials WHERE provider_id = $1",
    [providerId]
  )) as { api_key: string | null; base_url: string | null }[];
  if (rows.length === 0) return { apiKey: null, baseUrl: null };
  const apiKey = rows[0].api_key ? await decryptSecret(rows[0].api_key) : null;
  return { apiKey, baseUrl: rows[0].base_url };
}

export async function setProviderCredentials(providerId: string, apiKey: string | null, baseUrl: string | null): Promise<void> {
  const db = await getDb();
  const encryptedKey = apiKey ? await encryptSecret(apiKey) : null;
  await db.execute(
    `INSERT INTO provider_credentials (provider_id, api_key, base_url) VALUES ($1, $2, $3)
     ON CONFLICT(provider_id) DO UPDATE SET api_key = $2, base_url = $3`,
    [providerId, encryptedKey, baseUrl]
  );
}