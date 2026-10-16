/**
 * Opaque keyset-pagination cursor. The payload is a small JSON object
 * (`{ v, id }`) that is base64-encoded so clients treat it as opaque. Encoding
 * goes through UTF-8 bytes so titles with non-Latin characters survive.
 */

export interface CursorPayload {
  /** The sort key value of the last row (milliseconds, or a title string). */
  v: string | number;
  /** Tie-breaker id of the last row. */
  id: string;
}

function bytesToBinary(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return binary;
}

export function encodeCursor(payload: CursorPayload): string {
  return btoa(bytesToBinary(new TextEncoder().encode(JSON.stringify(payload))));
}

export function decodeCursor(cursor: string): CursorPayload | null {
  let parsed: unknown;
  try {
    const bytes = Uint8Array.from(atob(cursor), (character) => character.charCodeAt(0));
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const id = record.id;
  const value = record.v;
  if (typeof id !== "string") {
    return null;
  }
  if (typeof value === "string" || typeof value === "number") {
    return { v: value, id };
  }
  return null;
}
