import { createTagSchema, mergeTagsSchema, updateTagSchema } from "@bookmarks/shared";
import { Hono } from "hono";
import { notFound } from "../lib/http.js";
import { toTag } from "../lib/mappers.js";
import { createTag, deleteTag, listTagsWithCounts, mergeTags, updateTag } from "../lib/tags.js";
import { parseJsonBody } from "../lib/validation.js";
import type { AppBindings } from "../middleware/session.js";
import { requireUser, sessionMiddleware } from "../middleware/session.js";

export const tagsRoutes = new Hono<AppBindings>();

tagsRoutes.use("*", sessionMiddleware);

tagsRoutes.get("/", async (c) => {
  const user = requireUser(c);
  const items = await listTagsWithCounts(c.get("db"), user.id);
  return c.json({ items });
});

tagsRoutes.post("/", async (c) => {
  const user = requireUser(c);
  const input = await parseJsonBody(c, createTagSchema);
  const row = await createTag(c.get("db"), user.id, input.name, input.color);
  return c.json({ tag: toTag(row, 0) }, 201);
});

tagsRoutes.post("/merge", async (c) => {
  const user = requireUser(c);
  const input = await parseJsonBody(c, mergeTagsSchema);
  const tag = await mergeTags(c.get("db"), user.id, input.sourceTagIds, input.targetTagId);
  if (!tag) {
    throw notFound("Target tag not found");
  }
  return c.json({ tag });
});

tagsRoutes.patch("/:id", async (c) => {
  const user = requireUser(c);
  const input = await parseJsonBody(c, updateTagSchema);
  const row = await updateTag(c.get("db"), user.id, c.req.param("id"), input);
  if (!row) {
    throw notFound("Tag not found");
  }
  return c.json({ tag: toTag(row) });
});

tagsRoutes.delete("/:id", async (c) => {
  const user = requireUser(c);
  const deleted = await deleteTag(c.get("db"), user.id, c.req.param("id"));
  if (!deleted) {
    throw notFound("Tag not found");
  }
  return c.body(null, 204);
});
