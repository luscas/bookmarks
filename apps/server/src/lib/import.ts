/**
 * Parser for the Netscape bookmark file format exported by Chrome, Firefox,
 * Edge and Safari. It is deliberately a small state machine over regex tokens
 * rather than a DOM parser, because Workers have no `DOMParser`.
 *
 * Structure handled:
 *
 *   <DL><p>
 *     <DT><H3>Folder</H3>
 *     <DL><p>
 *       <DT><A HREF="https://example.com" ADD_DATE="1700000000">Example</A>
 *     </DL>
 *   </DL>
 */

export interface ParsedBookmark {
  url: string;
  title?: string;
  /** ANCESTORS INCLUDING THE ROOT, e.g. `["Bookmarks Bar", "Dev"]`. */
  folderPath: string[];
  addedAt?: string;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function codePointToString(code: number): string | undefined {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) {
    return undefined;
  }
  try {
    return String.fromCodePoint(code);
  } catch {
    return undefined;
  }
}

/** Decode the HTML entities that appear in bookmark exports. */
export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      return codePointToString(Number.parseInt(entity.slice(2), 16)) ?? match;
    }
    if (entity.startsWith("#")) {
      return codePointToString(Number.parseInt(entity.slice(1), 10)) ?? match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Remove any tags from a fragment of anchor or heading text. */
export function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}

export function readAttribute(attributes: string, name: string): string | undefined {
  const pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = attributes.match(pattern);
  if (!match) {
    return undefined;
  }
  return match[1] ?? match[2] ?? match[3];
}

const TOKEN_PATTERN =
  "<dl\\b[^>]*>|<\\/dl\\s*>|<h3\\b[^>]*>([\\s\\S]*?)<\\/h3>|<a\\b([^>]*)>([\\s\\S]*?)<\\/a>";

/** Parse a Netscape bookmark export into a flat list of bookmarks. */
export function parseNetscapeBookmarks(html: string): ParsedBookmark[] {
  const items: ParsedBookmark[] = [];
  const stack: Array<string | null> = [];
  let pendingFolder: string | null = null;
  // A fresh regex per call keeps `lastIndex` from leaking between invocations.
  const tokenRe = new RegExp(TOKEN_PATTERN, "gi");
  let match: RegExpExecArray | null = tokenRe.exec(html);

  while (match !== null) {
    const token = match[0];

    if (/^<dl\b/i.test(token)) {
      stack.push(pendingFolder);
      pendingFolder = null;
    } else if (/^<\/dl/i.test(token)) {
      stack.pop();
    } else if (/^<h3\b/i.test(token)) {
      const name = decodeHtmlEntities(stripTags(match[1] ?? "")).trim();
      pendingFolder = name.length > 0 ? name : null;
    } else {
      const attributes = match[2] ?? "";
      const href = readAttribute(attributes, "href");
      const url = href ? decodeHtmlEntities(href).trim() : "";
      if (url.length > 0) {
        const title = decodeHtmlEntities(stripTags(match[3] ?? "")).trim();
        const addedAt = readAttribute(attributes, "add_date");
        const folderPath = stack.filter((entry): entry is string => entry !== null);
        const item: ParsedBookmark = { url, folderPath };
        if (title.length > 0) {
          item.title = title;
        }
        if (addedAt) {
          item.addedAt = addedAt;
        }
        items.push(item);
      }
    }

    match = tokenRe.exec(html);
  }

  return items;
}

/** Byte length of an HTML string, for upload size checks. */
export function htmlByteLength(html: string): number {
  return new TextEncoder().encode(html).byteLength;
}
