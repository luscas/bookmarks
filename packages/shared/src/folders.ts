import { normalizeTagName } from "./tags.js";

/**
 * Browser root folder names that carry no meaning as a tag. Chromium uses the
 * English names; localized exports use the translations below.
 */
const ROOT_FOLDER_NAMES: ReadonlySet<string> = new Set(
  [
    "bookmarks bar",
    "bookmarks toolbar",
    "other bookmarks",
    "mobile bookmarks",
    "favorites",
    "favorites bar",
    "barra de favoritos",
    "barra de favoritos",
    "outros favoritos",
    "favoritos",
    "outros marcadores",
    "marcadores moveis",
  ].map((name) => name.toLowerCase()),
);

function isRootFolder(segment: string): boolean {
  return ROOT_FOLDER_NAMES.has(normalizeTagName(segment).toLowerCase());
}

/**
 * Turn a browser folder path into a single hierarchical tag name.
 *
 * Root folders are dropped; the remaining segments are joined with `/`.
 * Returns `undefined` when nothing meaningful is left, so callers can skip it.
 */
export function folderPathToTagName(folderPath: readonly string[] | undefined): string | undefined {
  if (!folderPath || folderPath.length === 0) return undefined;

  const parts = folderPath
    .map(normalizeTagName)
    .filter((part) => part.length > 0 && !isRootFolder(part));
  if (parts.length === 0) return undefined;

  return parts.join("/");
}
