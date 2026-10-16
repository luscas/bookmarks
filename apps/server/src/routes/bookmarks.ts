import {
  bulkBookmarksSchema,
  createBookmarkSchema,
  listBookmarksQuerySchema,
  setBookmarkTagsSchema,
  updateBookmarkSchema,
} from "@bookmarks/shared";
import { Hono } from "hono";
import {
  bulkCreateBookmarks,
  createBookmark,
  deleteBookmark,
  getBookmarkById,
  updateBookmark,
} from "../lib/bookmarks.js";
import { notFound } from "../lib/http.js";
import { listBookmarks } from "../lib/listing.js";
import { toBookmark } from "../lib/mappers.js";
import { setBookmarkTags, tagsForBookmarks } from "../lib/tags.js";
import { parseJsonBody, parseQuery } from "../lib/validation.js";
import type { AppBindings } from "../middleware/session.js";
import { requireUser, sessionMiddleware } from "../middleware/session.js";

export const bookmarksRoutes = new Hono<AppBindings>();

bookmarksRoutes.use("*", sessionMiddleware);

bookmarksRoutes.get("/", async (c) => {
  const user = requireUser(c);
  const query = parseQuery(c, listBookmarksQuerySchema);
  const page = await listBookmarks(c.get("db"), user.id, query);
  return c.json(page);
});

bookmarksRoutes.post("/", async (c) => {
  const user = requireUser(c);
  const input = await parseJsonBody(c, createBookmarkSchema);
  const { bookmark, created } = await createBookmark(c.get("db"), user.id, input);
  const tags = await tagsForBookmarks(c.get("db"), user.id, [bookmark.id]);
  return c.json(
    { bookmark: toBookmark(bookmark, tags.get(bookmark.id) ?? []), created },
    created ? 201 : 200,
  );
});

bookmarksRoutes.post("/bulk", async (c) => {
  const user = requireUser(c);
  const input = await parseJsonBody(c, bulkBookmarksSchema);
  const result = await bulkCreateBookmarks(c.get("db"), user.id, input);
  return c.json(result);
});

bookmarksRoutes.get("/:id", async (c) => {
  const user = requireUser(c);
  const row = await getBookmarkById(c.get("db"), user.id, c.req.param("id"));
  if (!row) {
    throw notFound("Bookmark not found");
  }
  const tags = await tagsForBookmarks(c.get("db"), user.id, [row.id]);
  return c.json({ bookmark: toBookmark(row, tags.get(row.id) ?? []) });
});

bookmarksRoutes.patch("/:id", async (c) => {
  const user = requireUser(c);
  const input = await parseJsonBody(c, updateBookmarkSchema);
  const updated = await updateBookmark(c.get("db"), user.id, c.req.param("id"), input);
  if (!updated) {
    throw notFound("Bookmark not found");
  }
  const tags = await tagsForBookmarks(c.get("db"), user.id, [updated.id]);
  return c.json({ bookmark: toBookmark(updated, tags.get(updated.id) ?? []) });
});

bookmarksRoutes.delete("/:id", async (c) => {
  const user = requireUser(c);
  const deleted = await deleteBookmark(c.get("db"), user.id, c.req.param("id"));
  if (!deleted) {
    throw notFound("Bookmark not found");
  }
  return c.body(null, 204);
});

bookmarksRoutes.put("/:id/tags", async (c) => {
  const user = requireUser(c);
  const input = await parseJsonBody(c, setBookmarkTagsSchema);
  const existing = await getBookmarkById(c.get("db"), user.id, c.req.param("id"));
  if (!existing) {
    throw notFound("Bookmark not found");
  }
  await setBookmarkTags(c.get("db"), user.id, existing.id, input.tags);
  const tags = await tagsForBookmarks(c.get("db"), user.id, [existing.id]);
  return c.json({ bookmark: toBookmark(existing, tags.get(existing.id) ?? []) });
});
