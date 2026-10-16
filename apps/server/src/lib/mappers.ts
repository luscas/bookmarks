import type { BookmarkRow } from "@bookmarks/db";
import type { Bookmark, Tag, TagKind } from "@bookmarks/shared";

/** API-relative URL for a stored favicon, or `null` when the host is unknown. */
function faviconUrl(faviconKey: string | null): string | null {
  return faviconKey ? `/api/favicon/${faviconKey}` : null;
}

/** Map a bookmark row plus its tags to the API response shape. */
export function toBookmark(row: BookmarkRow, tags: Tag[]): Bookmark {
  return {
    id: row.id,
    url: row.url,
    normalizedUrl: row.normalizedUrl,
    title: row.title ?? null,
    description: row.description ?? null,
    notes: row.notes ?? null,
    faviconUrl: faviconUrl(row.faviconKey ?? null),
    source: row.source,
    tags,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The columns needed to render a tag, satisfied by any partial select. */
export interface TagLike {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  kind: TagKind;
}

/** Map a tag row to the API response shape, optionally with its usage count. */
export function toTag(row: TagLike, bookmarkCount?: number): Tag {
  const tag: Tag = {
    id: row.id,
    name: row.name,
    slug: row.slug,
    color: row.color ?? null,
    kind: row.kind,
  };
  if (bookmarkCount !== undefined) {
    tag.bookmarkCount = bookmarkCount;
  }
  return tag;
}
