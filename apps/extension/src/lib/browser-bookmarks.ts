import { folderPathToTagName } from "@bookmarks/shared";

/**
 * The minimal shape of a `chrome.bookmarks.BookmarkTreeNode` used here. Kept
 * local so the conversion is pure and testable without the `chrome` types or
 * a browser.
 */
export interface BrowserBookmarkNode {
  id: string;
  title: string;
  url?: string;
  children?: BrowserBookmarkNode[];
}

export interface BrowserBookmarkItem {
  url: string;
  title: string;
  /** Folder path as Chrome reports it, root folders included. */
  folderPath: string[];
  /**
   * Hierarchical tag derived with `folderPathToTagName` (the same helper the
   * server uses), e.g. `["Dev/React"]`. Empty when the path has no meaning.
   */
  tags: string[];
}

/**
 * Walk a `chrome.bookmarks.getTree()` result and turn every bookmark (a node
 * with a `url`) into an item with its folder path and derived hierarchical
 * tag. Folders contribute their title to the path of their descendants; root
 * folders are dropped later by `folderPathToTagName`.
 */
export function bookmarkTreeToItems(tree: readonly BrowserBookmarkNode[]): BrowserBookmarkItem[] {
  const items: BrowserBookmarkItem[] = [];

  const walk = (nodes: readonly BrowserBookmarkNode[], folderPath: string[]): void => {
    for (const node of nodes) {
      if (typeof node.url === "string" && node.url.length > 0) {
        const tag = folderPathToTagName(folderPath);
        items.push({
          url: node.url,
          title: node.title ?? "",
          folderPath: [...folderPath],
          tags: tag ? [tag] : [],
        });
      }

      const children = node.children;
      if (children && children.length > 0) {
        const name = node.title?.trim() ?? "";
        // Anonymous containers (the synthetic root) and blank folders are not
        // meaningful path segments, so they do not extend the path.
        const nextPath = name.length > 0 ? [...folderPath, name] : folderPath;
        walk(children, nextPath);
      }
    }
  };

  walk(tree, []);
  return items;
}
