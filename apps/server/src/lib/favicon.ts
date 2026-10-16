import { hostnameOf } from "@bookmarks/shared";
import type { Env } from "../env.js";
import { readAttribute } from "./import.js";

/** R2 key prefix for stored favicons. */
export const FAVICON_PREFIX = "favicons/";
const MAX_FAVICON_BYTES = 256 * 1024;
const FETCH_TIMEOUT_MS = 5_000;
const LINK_TAG_RE = /<link\b[^>]*>/gi;

const PRIVATE_HOST_RE = /^(localhost|.*\.local|.*\.internal)$/i;
const PRIVATE_IP_RE =
  /^(0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|::1|\[::1\])$/;

export interface Favicon {
  body: ArrayBuffer;
  contentType: string;
}

/**
 * Reject obviously non-public hostnames before making an outbound request, so
 * the favicon proxy cannot be pointed at localhost or a private network.
 */
export function isPublicHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host.length === 0) {
    return false;
  }
  return !PRIVATE_HOST_RE.test(host) && !PRIVATE_IP_RE.test(host);
}

/** Favicon storage key for a URL, or `null` when the host is unusable. */
export function faviconKeyFor(url: string): string | null {
  const host = hostnameOf(url);
  if (!host || !isPublicHostname(host)) {
    return null;
  }
  return host;
}

function isImageContentType(contentType: string): boolean {
  return contentType.startsWith("image/") || contentType.includes("icon");
}

async function fetchIcon(url: string): Promise<Favicon | null> {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "image/*,*/*;q=0.8" },
    });
    if (!response.ok) {
      return null;
    }
    const contentType = response.headers.get("content-type") ?? "image/x-icon";
    if (!isImageContentType(contentType)) {
      return null;
    }
    const body = await response.arrayBuffer();
    if (body.byteLength === 0 || body.byteLength > MAX_FAVICON_BYTES) {
      return null;
    }
    return { body, contentType };
  } catch {
    return null;
  }
}

async function discoverIconUrl(hostname: string): Promise<string | null> {
  try {
    const response = await fetch(`https://${hostname}/`, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "text/html" },
    });
    if (!response.ok) {
      return null;
    }
    const text = await response.text();
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
        return new URL(href, `https://${hostname}/`).toString();
      } catch {
        // Ignore an unparseable href and try the next <link> tag.
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Return the favicon for `hostname`, fetching and caching it in R2 on first
 * use. Returns `null` when nothing usable can be found.
 */
export async function resolveFavicon(env: Env, hostname: string): Promise<Favicon | null> {
  if (!isPublicHostname(hostname)) {
    return null;
  }
  const key = `${FAVICON_PREFIX}${hostname}`;
  const stored = await env.FAVICONS.get(key);
  if (stored) {
    return {
      body: await stored.arrayBuffer(),
      contentType: stored.httpMetadata?.contentType ?? "image/x-icon",
    };
  }

  const candidates = [`https://${hostname}/favicon.ico`];
  const discovered = await discoverIconUrl(hostname);
  if (discovered) {
    candidates.push(discovered);
  }

  for (const candidate of candidates) {
    const icon = await fetchIcon(candidate);
    if (icon) {
      await env.FAVICONS.put(key, icon.body, {
        httpMetadata: { contentType: icon.contentType },
      });
      return icon;
    }
  }
  return null;
}
