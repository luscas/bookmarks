/**
 * ULID-like identifiers: 48-bit timestamp (10 chars) followed by 80 bits of
 * randomness (16 chars), Crockford Base32 encoded. IDs are lexicographically
 * sortable by creation time, which keeps keyset pagination simple, and are
 * generated in application code so they work identically on D1 and in tests.
 */

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ENCODING_LENGTH = ENCODING.length;
const TIME_LENGTH = 10;
const RANDOM_LENGTH = 16;

function encodeTime(timestamp: number, length: number): string {
  let remaining = timestamp;
  let output = "";
  for (let index = 0; index < length; index += 1) {
    const mod = remaining % ENCODING_LENGTH;
    output = ENCODING.charAt(mod) + output;
    remaining = Math.floor(remaining / ENCODING_LENGTH);
  }
  return output;
}

function encodeRandom(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let output = "";
  for (let index = 0; index < length; index += 1) {
    const byte = bytes[index] ?? 0;
    output += ENCODING.charAt(byte % ENCODING_LENGTH);
  }
  return output;
}

/** Generate a new ULID-like, URL-safe, lexicographically time-ordered id. */
export function newId(): string {
  return encodeTime(Date.now(), TIME_LENGTH) + encodeRandom(RANDOM_LENGTH);
}
