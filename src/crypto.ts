// Deliberately "light" encryption: protects against casually opening the
// database file and reading secrets in plain text. It does NOT protect
// against someone with access to the app's own source/binary, since the
// passphrase lives there too. A future upgrade path (if ever needed) would
// be an OS-level credential vault instead.
const PASSPHRASE = "vertaal-local-secret-store-v1";

async function deriveKey(salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(PASSPHRASE), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export async function encryptSecret(plainText: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(salt);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plainText));
  return `${toBase64(salt)}.${toBase64(iv)}.${toBase64(new Uint8Array(ciphertext))}`;
}

export async function decryptSecret(stored: string): Promise<string | null> {
  try {
    const [saltB64, ivB64, dataB64] = stored.split(".");
    const key = await deriveKey(fromBase64(saltB64));
    const plainBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(ivB64) }, key, fromBase64(dataB64));
    return new TextDecoder().decode(plainBuffer);
  } catch {
    return null;
  }
}