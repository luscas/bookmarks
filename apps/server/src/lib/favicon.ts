import { MAX_FAVICON_BYTES, MAX_FAVICON_HTML_BYTES } from "@bookmarks/shared";
import type { Env } from "../env.js";
import { readAttribute } from "./import.js";

/** R2 key prefix for stored favicons. */
export const FAVICON_PREFIX = "favicons/";
const FETCH_TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;
const LINK_TAG_RE = /<link\b[^>]*>/gi;

/**
 * Hostnames that must never be reached: local names and cloud metadata
 * endpoints. Suffixes are matched after the URL parser has lowercased the host
 * and stripped any trailing dot, so `localhost.` and `foo.local.` are covered.
 */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
]);
const BLOCKED_SUFFIXES = [".local", ".internal", ".localhost", ".home.arpa"];

export interface Favicon {
  body: ArrayBuffer;
  contentType: string;
}

/** Flatten a hostname for comparison: trim, lowercase, drop trailing dots. */
function normalizeHost(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.+$/, "");
}

function parseIpv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const value = Number(part);
    if (value > 255) {
      return null;
    }
    bytes.push(value);
  }
  return bytes;
}

function isPublicIpv4(bytes: readonly number[]): boolean {
  const a = bytes[0] ?? 0;
  const b = bytes[1] ?? 0;
  const c = bytes[2] ?? 0;
  if (a === 0) return false; // 0.0.0.0/8 "this network"
  if (a === 10) return false; // 10.0.0.0/8 private
  if (a === 100 && b >= 64 && b <= 127) return false; // 100.64.0.0/10 CGNAT
  if (a === 127) return false; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return false; // 169.254.0.0/16 link-local + metadata
  if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12 private
  if (a === 192 && b === 0 && c === 0) return false; // 192.0.0.0/24
  if (a === 192 && b === 0 && c === 2) return false; // TEST-NET-1
  if (a === 192 && b === 168) return false; // 192.168.0.0/16 private
  if (a === 198 && (b === 18 || b === 19)) return false; // 198.18.0.0/15 benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false; // TEST-NET-3
  if (a >= 224) return false; // multicast + reserved (224.0.0.0/4, 240.0.0.0/4)
  return true;
}

/** Parse an IPv6 literal into eight 16-bit groups, expanding `::`. */
function parseIpv6(input: string): number[] | null {
  let work = input;
  const lastColon = work.lastIndexOf(":");
  if (lastColon !== -1 && work.slice(lastColon + 1).includes(".")) {
    const embedded = parseIpv4(work.slice(lastColon + 1));
    if (!embedded) {
      return null;
    }
    const hi = ((embedded[0] ?? 0) << 8) | (embedded[1] ?? 0);
    const lo = ((embedded[2] ?? 0) << 8) | (embedded[3] ?? 0);
    work = `${work.slice(0, lastColon + 1)}${hi.toString(16)}:${lo.toString(16)}`;
  }

  const halves = work.split("::");
  if (halves.length > 2) {
    return null;
  }

  const parseSegment = (segment: string): number[] | null => {
    if (segment.length === 0) {
      return [];
    }
    const groups: number[] = [];
    for (const part of segment.split(":")) {
      if (!/^[0-9a-f]{1,4}$/i.test(part)) {
        return null;
      }
      groups.push(Number.parseInt(part, 16));
    }
    return groups;
  };

  const head = parseSegment(halves[0] ?? "");
  if (!head) {
    return null;
  }
  if (halves.length === 1) {
    return head.length === 8 ? head : null;
  }

  const tail = parseSegment(halves[1] ?? "");
  if (!tail) {
    return null;
  }
  const zeros = 8 - head.length - tail.length;
  if (zeros < 1) {
    return null;
  }
  return [...head, ...new Array<number>(zeros).fill(0), ...tail];
}

function embeddedIpv4(hi: number, lo: number): number[] {
  return [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff];
}

function isPublicIpv6(groups: readonly number[]): boolean {
  if (groups.length !== 8) {
    return false;
  }
  const g0 = groups[0] ?? 0;
  const g1 = groups[1] ?? 0;
  const g5 = groups[5] ?? 0;
  const g6 = groups[6] ?? 0;
  const g7 = groups[7] ?? 0;

  if (groups.every((group) => group === 0)) return false; // ::
  if (g6 === 0 && g7 === 1 && groups.slice(0, 6).every((group) => group === 0)) return false; // ::1
  if ((g0 & 0xfe00) === 0xfc00) return false; // fc00::/7 unique-local
  if ((g0 & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((g0 & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return false; // 2001:db8::/32 documentation

  // IPv4-mapped (::ffff:0:0/96) and IPv4-compatible (deprecated) addresses.
  if (g5 === 0xffff && groups.slice(0, 5).every((group) => group === 0)) {
    return isPublicIpv4(embeddedIpv4(g6, g7));
  }
  if (groups.slice(0, 6).every((group) => group === 0)) {
    return isPublicIpv4(embeddedIpv4(g6, g7));
  }
  // NAT64 well-known prefix 64:ff9b::/96.
  if (g0 === 0x0064 && g1 === 0xff9b && groups.slice(2, 6).every((group) => group === 0)) {
    return isPublicIpv4(embeddedIpv4(g6, g7));
  }
  return true;
}

function isBlockedHostname(host: string): boolean {
  if (BLOCKED_HOSTNAMES.has(host)) {
    return true;
  }
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return true;
  }
  // A public host always carries a TLD, so a single-label name is unreachable.
  return !host.includes(".");
}

/**
 * Reject hostnames that must never be reached over the public internet: loopback
 * and private/link-local addresses (v4 and v6, including IPv4-mapped forms),
 * cloud metadata endpoints, credential-free hostnames and local-only names.
 */
export function isPublicHostname(hostname: string): boolean {
  const host = normalizeHost(hostname);
  if (host.length === 0) {
    return false;
  }
  if (host.startsWith("[") || host.includes(":")) {
    const groups = parseIpv6(host.replace(/^\[/, "").replace(/\]$/, ""));
    return groups !== null && isPublicIpv6(groups);
  }
  if (/^[0-9.]+$/.test(host)) {
    const ipv4 = parseIpv4(host);
    return ipv4 !== null && isPublicIpv4(ipv4);
  }
  return !isBlockedHostname(host);
}

/** Parse an `http(s)` URL whose host is public and which carries no credentials. */
export function safeUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return null;
  }
  if (!isPublicHostname(url.hostname)) {
    return null;
  }
  return url;
}

/** Favicon storage key for a URL, or `null` when the host is unusable. */
export function faviconKeyFor(url: string): string | null {
  const parsed = safeUrl(url);
  if (!parsed) {
    return null;
  }
  const host = normalizeHost(parsed.hostname);
  return host.length > 0 ? host : null;
}

/**
 * Media types we are willing to serve from our own origin. Everything else is
 * dropped — notably `image/svg+xml`, which as a same-origin document can run
 * script. This proxy is unauthenticated and served from the app origin, so
 * echoing a host-controlled SVG type would be a stored-XSS vector.
 */
const ALLOWED_ICON_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/** Lowercase a media type and drop its parameters: `image/png; charset=x` → `image/png`. */
export function normalizeContentType(contentType: string): string {
  return (contentType.split(";")[0] ?? "").trim().toLowerCase();
}

/** True when a media type may be served from our origin (raster/icon only). */
export function isAllowedIconContentType(contentType: string): boolean {
  return ALLOWED_ICON_TYPES.has(normalizeContentType(contentType));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/**
 * Read at most `maxBytes` from a response body, aborting mid-stream once the
 * budget is exceeded so an attacker-controlled host cannot exhaust memory.
 */
async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    return null;
  }
  if (!response.body) {
    return new Uint8Array(0);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/**
 * Fetch a URL, following at most `MAX_REDIRECTS` hops. Every hop is re-validated
 * with `safeUrl`, so a public host cannot redirect the worker at a private one.
 */
export async function fetchPublicUrl(rawUrl: string, accept: string): Promise<Response | null> {
  let target = safeUrl(rawUrl);
  if (!target) {
    return null;
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(target.toString(), {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return null;
      }
      let next: URL | null = null;
      try {
        next = safeUrl(new URL(location, target).toString());
      } catch {
        next = null;
      }
      if (!next) {
        return null;
      }
      target = next;
      continue;
    }
    return response;
  }
  return null;
}

async function fetchIcon(url: string): Promise<Favicon | null> {
  try {
    const response = await fetchPublicUrl(url, "image/*,*/*;q=0.8");
    if (!response?.ok) {
      return null;
    }
    const declaredType = response.headers.get("content-type");
    const contentType = declaredType ? normalizeContentType(declaredType) : "image/x-icon";
    if (!isAllowedIconContentType(contentType)) {
      return null;
    }
    const bytes = await readCapped(response, MAX_FAVICON_BYTES);
    if (!bytes || bytes.byteLength === 0) {
      return null;
    }
    return { body: toArrayBuffer(bytes), contentType };
  } catch {
    return null;
  }
}

async function discoverIconUrl(hostname: string): Promise<string | null> {
  try {
    const response = await fetchPublicUrl(`https://${hostname}/`, "text/html");
    if (!response?.ok) {
      return null;
    }
    const bytes = await readCapped(response, MAX_FAVICON_HTML_BYTES);
    if (!bytes) {
      return null;
    }
    const text = new TextDecoder().decode(bytes);
    const base = `https://${hostname}/`;
    for (const tag of text.match(LINK_TAG_RE) ?? []) {
      const rel = (readAttribute(tag, "rel") ?? "").toLowerCase();
      if (!rel.includes("icon")) {
        continue;
      }
      const href = readAttribute(tag, "href");
      if (!href) {
        continue;
      }
      try {
        const resolved = new URL(href, base).toString();
        if (safeUrl(resolved)) {
          return resolved;
        }
      } catch {
        // Ignore an unparseable href and try the next <link> tag.
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function readStoredFavicon(env: Env, key: string): Promise<Favicon | null> {
  try {
    const stored = await env.FAVICONS.get(key);
    if (!stored) {
      return null;
    }
    const contentType = normalizeContentType(stored.httpMetadata?.contentType ?? "");
    if (!isAllowedIconContentType(contentType)) {
      // Treat a cached non-raster entry as a miss so the caller refetches and
      // overwrites it with a sanitized type instead of serving it.
      return null;
    }
    return { body: await stored.arrayBuffer(), contentType };
  } catch {
    return null;
  }
}

/**
 * Return the favicon for `hostname`, fetching and caching it in R2 on first use.
 * Returns `null` when nothing usable can be found; never throws.
 */
export async function resolveFavicon(env: Env, hostname: string): Promise<Favicon | null> {
  if (!isPublicHostname(hostname)) {
    return null;
  }
  const key = `${FAVICON_PREFIX}${hostname}`;
  const stored = await readStoredFavicon(env, key);
  if (stored) {
    return stored;
  }

  const candidates = [`https://${hostname}/favicon.ico`];
  const discovered = await discoverIconUrl(hostname);
  if (discovered) {
    candidates.push(discovered);
  }

  for (const candidate of candidates) {
    const icon = await fetchIcon(candidate);
    if (icon) {
      try {
        await env.FAVICONS.put(key, icon.body, {
          httpMetadata: { contentType: icon.contentType },
        });
      } catch {
        // Serving the icon matters more than caching it; ignore write failures.
      }
      return icon;
    }
  }
  return null;
}
