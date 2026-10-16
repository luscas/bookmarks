/**
 * AES-GCM helpers for encrypting per-user AI provider keys at rest.
 *
 * The key is supplied as a base64-encoded 32-byte secret
 * (`env.AI_KEY_ENCRYPTION_SECRET`). The 12-byte IV is random per encryption and
 * stored alongside the ciphertext; both are base64 strings so they fit the
 * `ai_settings` text columns.
 */

const AES_KEY_BYTES = 32;
const IV_BYTES = 12;

/** A ciphertext and its initialization vector, both base64. */
export interface EncryptedValue {
  ciphertext: string;
  iv: string;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** Import a base64 AES-GCM key, rejecting anything that is not 32 bytes. */
async function importAesKey(base64Key: string): Promise<CryptoKey> {
  let raw: Uint8Array;
  try {
    raw = base64ToBytes(base64Key);
  } catch {
    throw new Error("AI_KEY_ENCRYPTION_SECRET must be valid base64");
  }
  if (raw.length !== AES_KEY_BYTES) {
    throw new Error(`AI_KEY_ENCRYPTION_SECRET must decode to ${AES_KEY_BYTES} bytes`);
  }
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** Encrypt a plaintext string with AES-GCM and a fresh random IV. */
export async function encryptApiKey(plaintext: string, base64Key: string): Promise<EncryptedValue> {
  const key = await importAesKey(base64Key);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const data = new TextEncoder().encode(plaintext);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  return {
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    iv: bytesToBase64(iv),
  };
}

/**
 * Decrypt a value produced by {@link encryptApiKey}. Throws when the key is
 * wrong or the ciphertext/IV was tampered with (AES-GCM authentication).
 */
export async function decryptApiKey(value: EncryptedValue, base64Key: string): Promise<string> {
  const key = await importAesKey(base64Key);
  const iv = base64ToBytes(value.iv);
  const data = base64ToBytes(value.ciphertext);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(decrypted);
}
