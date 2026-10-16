import { describe, expect, it } from "vitest";
import {
  decodeHtmlEntities,
  htmlByteLength,
  parseNetscapeBookmarks,
  stripTags,
} from "../../src/lib/import.js";

const SAMPLE = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1700000000" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks Bar</H3>
    <DL><p>
        <DT><A HREF="https://example.com" ADD_DATE="1700000001">Example &amp; Co</A>
        <DT><H3>Dev</H3>
        <DL><p>
            <DT><A HREF="https://react.dev" ADD_DATE="1700000002">React</A>
        </DL><p>
    </DL><p>
    <DT><A HREF="https://root.example" ADD_DATE="1700000003">Root</A>
</DL><p>`;

describe("parseNetscapeBookmarks", () => {
  it("extracts bookmarks with their ancestor folder paths", () => {
    const items = parseNetscapeBookmarks(SAMPLE);
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({
      url: "https://example.com",
      title: "Example & Co",
      folderPath: ["Bookmarks Bar"],
      addedAt: "1700000001",
    });
    expect(items[1]?.folderPath).toEqual(["Bookmarks Bar", "Dev"]);
    expect(items[2]?.folderPath).toEqual([]);
  });

  it("decodes entities and strips markup from titles", () => {
    const html = `<DL><p><DT><A HREF="https://x.test">Tom&#39;s <b>page</b></A></DL>`;
    const [item] = parseNetscapeBookmarks(html);
    expect(item?.title).toBe("Tom's page");
  });

  it("ignores anchors without an href and handles unbalanced DL tags", () => {
    const html = `<DL><p></DL></DL><DT><A NAME="x">no href</A><DT><A HREF="">empty</A>`;
    expect(parseNetscapeBookmarks(html)).toHaveLength(0);
  });

  it("reads single-quoted attributes", () => {
    const html = `<DL><p><DT><A HREF='https://single.test'>Single</A></DL>`;
    expect(parseNetscapeBookmarks(html)[0]?.url).toBe("https://single.test");
  });
});

describe("html helpers", () => {
  it("decodes named and numeric entities", () => {
    expect(decodeHtmlEntities("a &amp; b &#65; &#x42;")).toBe("a & b A B");
    expect(decodeHtmlEntities("keep &unknown; as is")).toBe("keep &unknown; as is");
  });

  it("strips tags", () => {
    expect(stripTags("<b>bold</b> text")).toBe("bold text");
  });

  it("measures utf-8 byte length", () => {
    expect(htmlByteLength("abc")).toBe(3);
    expect(htmlByteLength("é")).toBe(2);
  });
});
