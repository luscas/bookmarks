import { bookmarks, tags, user as userTable } from "@bookmarks/db";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { parseJsonBody } from "../lib/validation.js";
import type { AppBindings } from "../middleware/session.js";
import { requireBrowserSession, requireUser, sessionMiddleware } from "../middleware/session.js";

const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(200),
});

const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
});

export const meRoutes = new Hono<AppBindings>();

meRoutes.use("*", sessionMiddleware);

meRoutes.get("/", async (c) => {
  const user = requireUser(c);
  const db = c.get("db");
  const bookmarkCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(bookmarks)
    .where(eq(bookmarks.userId, user.id))
    .get();
  const tagCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(tags)
    .where(eq(tags.userId, user.id))
    .get();

  return c.json({
    user,
    counts: {
      bookmarks: Number(bookmarkCount?.count ?? 0),
      tags: Number(tagCount?.count ?? 0),
    },
  });
});

meRoutes.patch("/", async (c) => {
  const user = requireUser(c);
  const input = await parseJsonBody(c, updateProfileSchema);
  await c
    .get("db")
    .update(userTable)
    .set({ name: input.name, updatedAt: new Date() })
    .where(eq(userTable.id, user.id));

  return c.json({ user: { ...user, name: input.name } });
});

meRoutes.get("/api-keys", async (c) => {
  requireUser(c);
  requireBrowserSession(c);
  const result = await c.get("auth").api.listApiKeys({ headers: c.req.raw.headers });
  return c.json(result);
});

meRoutes.post("/api-keys", async (c) => {
  requireUser(c);
  requireBrowserSession(c);
  const input = await parseJsonBody(c, createApiKeySchema);
  const result = await c.get("auth").api.createApiKey({
    body: { name: input.name ?? "Browser extension" },
    headers: c.req.raw.headers,
  });
  return c.json(result, 201);
});

meRoutes.delete("/api-keys/:id", async (c) => {
  requireUser(c);
  requireBrowserSession(c);
  await c.get("auth").api.deleteApiKey({
    body: { keyId: c.req.param("id") },
    headers: c.req.raw.headers,
  });
  return c.json({ success: true });
});
