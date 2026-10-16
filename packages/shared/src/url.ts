/**
 * URL normalization and hashing.
 *
 * The normalized form is what we dedupe on, so it has to be stable and
 * lossless in everything that changes *which page* a URL points to:
 *
 * - a missing scheme becomes `https`
 * - the host is lowercased and a trailing dot removed
 * - the fragment is dropped (it never selects a different document)
 * - tracking query parameters are removed and the rest are sorted
 * - a trailing slash on a non-root path is removed
 * - default ports are removed
 */

/** Query parameters whose only job is tracking; safe to drop for dedupe. */
export const TRACKING_PARAMS: ReadonlySet<string> = new Set([
  "fbclid",
  "gclid",
  "gclsrc",
  "dclid",
  "msclkid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "yclid",
  "twclid",
  "gbraid",
  "wbraid",
  "_hsenc",
  "_hsmi",
  "vero_id",
  "wickedid",
  "oly_anon_id",
  "oly_enc_id",
  "rb_clickid",
  "s_cid",
  "ml_subscriber",
  "ml_subscriber_hash",
  "spm",
  "scm",
]);

/** Parameters dropped when their prefix matches one of these. */
export const TRACKING_PARAM_PREFIXES: readonly string[] = ["utm_", "pk_", "mtm_", "hsa_"];

function isTracking(key: string): boolean {
  const lower = key.toLowerCase();
  if (TRACKING_PARAMS.has(lower)) return true;
  return TRACKING_PARAM_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

/**
 * Normalize a URL into its canonical, dedupe-stable form.
 * Throws when the input cannot be parsed as a URL.
 */
export function normalizeUrl(input: string): string {
  const raw = input.trim();
  if (raw.length === 0) {
    throw new Error("Cannot normalize an empty URL");
  }

  const withScheme = SCHEME_RE.test(raw) ? raw : `https://${raw}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`Invalid URL: ${input}`);
  }

  // Only http(s) pages are meaningful bookmarks here.
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported URL scheme: ${url.protocol}`);
  }

  url.hash = "";

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  url.hostname = host;

  if (
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80")
  ) {
    url.port = "";
  }

  const kept: Array<[string, string]> = [];
  for (const [key, value] of url.searchParams.entries()) {
    if (!isTracking(key)) kept.push([key, value]);
  }
  kept.sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1));

  url.search = "";
  for (const [key, value] of kept) url.searchParams.append(key, value);

  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return url.toString();
}

/**
 * Stable content hash of a normalized URL, used as the per-user uniqueness key.
 * Uses WebCrypto so it runs identically on Workers and Node 20+.
 */
export async function urlHash(normalizedUrl: string): Promise<string> {
  const data = new TextEncoder().encode(normalizedUrl);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Extract a lowercase hostname for grouping/favicon lookups. Returns input on failure. */
export function hostnameOf(url: string): string {
  try {
    return new URL(SCHEME_RE.test(url) ? url : `https://${url}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}
