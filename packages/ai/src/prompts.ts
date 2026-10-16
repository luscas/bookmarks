import type { BookmarkForAi } from "./types.js";

/** Inclusive lower bound on tags suggested per bookmark. */
export const MIN_TAGS_PER_BOOKMARK = 1;

/** Inclusive upper bound on tags suggested per bookmark. */
export const MAX_TAGS_PER_BOOKMARK = 5;

/** A provider prompt split into a system instruction and a user payload. */
export interface Prompt {
  system: string;
  user: string;
}

const TAG_RULES = `You organise bookmarks by assigning tags. Follow these rules:
- Reuse the existing tags provided by the user whenever they fit; only create a new tag when none of the existing ones apply.
- Return between ${MIN_TAGS_PER_BOOKMARK} and ${MAX_TAGS_PER_BOOKMARK} tags per bookmark.
- Keep each tag short (1-3 words) and use the same language as the bookmark title.
- Express hierarchy with a "/" separator, for example "dev/react".
- Only suggest a new title when the current one is empty or misleading.`;

const TAXONOMY_RULES = `You design a tag taxonomy for a set of bookmarks. Follow these rules:
- Reuse the existing tags provided by the user whenever they fit; add new tags only when needed.
- Keep each tag short (1-3 words); express hierarchy with a "/" separator, for example "dev/react".
- Every bookmark in the input must appear exactly once in "assignments".
- Assign between ${MIN_TAGS_PER_BOOKMARK} and ${MAX_TAGS_PER_BOOKMARK} of the proposed tags to each bookmark.`;

function toBookmarkPayload(bookmark: BookmarkForAi): {
  id: string;
  url: string;
  title: string | null;
  description: string | null;
} {
  return {
    id: bookmark.id,
    url: bookmark.url,
    title: bookmark.title ?? null,
    description: bookmark.description ?? null,
  };
}

function toUserPayload(bookmarks: BookmarkForAi[], existingTags: string[]): string {
  return JSON.stringify(
    {
      existingTags,
      bookmarks: bookmarks.map(toBookmarkPayload),
    },
    null,
    2,
  );
}

/** Prompt asking the model to tag a batch of bookmarks. */
export function buildSuggestTagsPrompt(bookmarks: BookmarkForAi[], existingTags: string[]): Prompt {
  return {
    system: TAG_RULES,
    user: toUserPayload(bookmarks, existingTags),
  };
}

/** Prompt asking the model to propose a taxonomy for a batch of bookmarks. */
export function buildProposeTaxonomyPrompt(
  bookmarks: BookmarkForAi[],
  existingTags: string[],
): Prompt {
  return {
    system: TAXONOMY_RULES,
    user: toUserPayload(bookmarks, existingTags),
  };
}
