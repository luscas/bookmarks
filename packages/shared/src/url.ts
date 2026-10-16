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

/** Any `scheme:` prefix, including opaque forms like `javascript:alert(1)`. */
const ANY_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * ASCII control characters (C0 controls plus DEL) that the WHATWG URL parser
 * silently strips. A tab inside `java\tscript://…` is how the scheme smuggles
 * past a naive `startsWith`/scheme check, so they are removed before parsing.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping these exact characters is the security fix
const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;

/**
 * Schemes that execute or inline content when a browser renders them in an
 * `href`. They are rejected outright, before any `https://` fallback could
 * disguise them. Other non-http(s) schemes either fail to parse as an https
 * URL (opaque payloads make invalid ports/hosts) or normalize into an inert
 * https navigation, which the final protocol check already rejects.
 */
const EXECUTABLE_SCHEMES = new Set(["javascript", "data", "vbscript"]);

/**
 * Normalize a URL into its canonical, dedupe-stable form.
 * Throws when the input cannot be parsed as a URL.
 */
export function normalizeUrl(input: string): string {
  // Strip control characters first so the parser below and every check on this
  // string see exactly the characters a browser would see.
  const raw = input.replace(CONTROL_CHARS, "").trim();
  if (raw.length === 0) {
    throw new Error("Cannot normalize an empty URL");
  }

  // After stripping, a smuggled `javascript:`/`data:` prefix is visible as a
  // real scheme; reject it before the https fallback can mask it.
  const schemeMatch = raw.match(ANY_SCHEME_RE);
  if (schemeMatch) {
    const scheme = schemeMatch[0].slice(0, -1).toLowerCase();
    if (EXECUTABLE_SCHEMES.has(scheme)) {
      throw new Error(`Unsupported URL scheme: ${scheme}:`);
    }
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
