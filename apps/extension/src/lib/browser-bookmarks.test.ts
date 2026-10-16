import { describe, expect, it } from "vitest";
import { type BrowserBookmarkNode, bookmarkTreeToItems } from "./browser-bookmarks";

/**
 * A trimmed-down `chrome.bookmarks.getTree()` result. A node with a `url` is a
 * bookmark; its title is *not* part of the folder path.
 */
const tree: BrowserBookmarkNode[] = [
  {
    id: "0",
    title: "",
    children: [
      {
        id: "1",
        title: "Bookmarks Bar",
        children: [
          {
            id: "2",
            title: "Dev",
            children: [
              {
                id: "3",
                title: "Frontend",
                children: [
                  { id: "4", title: "React", url: "https://react.dev" },
                  { id: "5", title: "TypeScript", url: "https://typescriptlang.org" },
                ],
              },
              { id: "6", title: "Lua", url: "https://lua.org" },
            ],
          },
          { id: "7", title: "News", url: "https://news.test" },
        ],
      },
      {
        id: "8",
        title: "Other Bookmarks",
        children: [
          {
            id: "9",
            title: "Tools",
            children: [{ id: "10", title: "GitHub", url: "https://github.com" }],
          },
          { id: "11", title: "Stray", url: "https://stray.test" },
        ],
      },
    ],
  },
];

describe("bookmarkTreeToItems", () => {
  it("walks nested folders into a hierarchical tag", () => {
    const items = bookmarkTreeToItems(tree);

    expect(items.find((item) => item.url === "https://react.dev")).toEqual({
      url: "https://react.dev",
      title: "React",
      folderPath: ["Bookmarks Bar", "Dev", "Frontend"],
      tags: ["Dev/Frontend"],
    });
    expect(items.find((item) => item.url === "https://typescriptlang.org")?.tags).toEqual([
      "Dev/Frontend",
    ]);
    expect(items.find((item) => item.url === "https://lua.org")?.tags).toEqual(["Dev"]);
  });

  it("drops root folders that carry no meaning as tags", () => {
    const items = bookmarkTreeToItems(tree);

    // Directly under a root folder → no meaningful tag, but the path is kept.
    expect(items.find((item) => item.url === "https://news.test")).toMatchObject({
      folderPath: ["Bookmarks Bar"],
      tags: [],
    });
    expect(items.find((item) => item.url === "https://stray.test")).toMatchObject({
      folderPath: ["Other Bookmarks"],
      tags: [],
    });
  });

  it("keeps ordinary folder names from any root", () => {
    const items = bookmarkTreeToItems(tree);
    expect(items.find((item) => item.url === "https://github.com")?.tags).toEqual(["Tools"]);
  });

  it("returns every bookmark once", () => {
    const items = bookmarkTreeToItems(tree);
    expect(items).toHaveLength(6);
    expect(new Set(items.map((item) => item.url)).size).toBe(6);
  });

  it("handles an empty tree", () => {
    expect(bookmarkTreeToItems([])).toEqual([]);
  });
});
