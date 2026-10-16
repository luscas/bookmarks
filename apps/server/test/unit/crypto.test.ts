import { describe, expect, it } from "vitest";
import { decryptApiKey, encryptApiKey } from "../../src/lib/crypto.js";

function base64Key(fill: number): string {
  return btoa(String.fromCharCode(...new Uint8Array(32).fill(fill)));
}

const KEY = base64Key(7);

describe("crypto", () => {
  it("round-trips a secret", async () => {
    const encrypted = await encryptApiKey("sk-test-123", KEY);
    expect(encrypted.ciphertext).not.toContain("sk-test-123");
    expect(encrypted.iv.length).toBeGreaterThan(0);
    await expect(decryptApiKey(encrypted, KEY)).resolves.toBe("sk-test-123");
  });

  it("uses a fresh IV for every encryption", async () => {
    const first = await encryptApiKey("same value", KEY);
    const second = await encryptApiKey("same value", KEY);
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("rejects decryption with the wrong key", async () => {
    const encrypted = await encryptApiKey("secret", KEY);
    await expect(decryptApiKey(encrypted, base64Key(9))).rejects.toBeDefined();
  });

  it("rejects a key that is not 32 bytes", async () => {
    const shortKey = btoa(String.fromCharCode(...new Uint8Array(16)));
    await expect(encryptApiKey("value", shortKey)).rejects.toThrow(/32 bytes/);
  });

  it("rejects a key that is not valid base64", async () => {
    await expect(encryptApiKey("value", "not base64!!")).rejects.toThrow(/base64/);
  });
});
