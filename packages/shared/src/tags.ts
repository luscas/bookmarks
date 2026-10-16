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
 * Slug used for uniqueness within a user. Keeps `/` so `dev/react` and
 * `dev/vue` stay distinct, and strips everything that is not a word character
 * or slash.
 */
export function slugifyTag(name: string): string {
  return normalizeTagName(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "") // strip combining marks (diacritics)
    .replace(/\s*\/\s*/g, "/") // collapse spaces around the hierarchy separator
    .replace(/[^a-z0-9/_\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/\/{2,}/g, "/")
    .replace(/^[-/]+|[-/]+$/g, "");
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
