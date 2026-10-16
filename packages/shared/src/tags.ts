/**
 * Tag naming helpers. Tags are stored flat; hierarchy is expressed with a
 * `/` separator (e.g. `dev/react`) so the UI can render a tree later without a
 * second table.
 */

/** Normalize a tag display name: trim and collapse internal whitespace. */
export function normalizeTagName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/**
 * Percent-encode a segment's UTF-8 bytes. Used only when a segment has no
 * ASCII-safe characters left, so a non-Latin name still maps to a stable,
 * non-empty and collision-free slug (`%` never appears in an ASCII slug).
 */
function encodeSlugSegment(segment: string): string {
  let encoded = "";
  for (const byte of new TextEncoder().encode(segment)) {
    encoded += `%${byte.toString(16).padStart(2, "0").toUpperCase()}`;
  }
  return encoded;
}

/** Slugify one segment, falling back to percent-encoding for non-Latin text. */
function slugifySegment(segment: string): string {
  const ascii = segment
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "") // strip combining marks (diacritics)
    .replace(/[^a-z0-9_ -]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii.length > 0 ? ascii : encodeSlugSegment(segment.trim());
}

/**
 * Slug used for uniqueness within a user. Keeps `/` so `dev/react` and
 * `dev/vue` stay distinct, and strips everything that is not a word character
 * or slash. Segments that would otherwise slugify to nothing (e.g. `東京`) are
 * percent-encoded instead of collapsing to an empty slug.
 */
export function slugifyTag(name: string): string {
  const normalized = normalizeTagName(name);
  const segments = normalized
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return segments.map(slugifySegment).join("/");
}

/** True when a tag name carries hierarchy. */
export function isHierarchicalTag(name: string): boolean {
  return name.includes("/");
}

/** Split a hierarchical tag into its ancestor names, root first. */
export function tagAncestors(name: string): string[] {
  const parts = normalizeTagName(name)
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}
