import { MAX_IMPORT_HTML_BYTES, createImportSchema } from "@bookmarks/shared";
import { Hono } from "hono";
import { notFound } from "../lib/http.js";
import { getImportById, listImports, runImport } from "../lib/imports.js";
import { parseJsonBody } from "../lib/validation.js";
import type { AppBindings } from "../middleware/session.js";
import { requireUser, sessionMiddleware } from "../middleware/session.js";

export const importsRoutes = new Hono<AppBindings>();

importsRoutes.use("*", sessionMiddleware);

importsRoutes.get("/", async (c) => {
  const user = requireUser(c);
  const items = await listImports(c.get("db"), user.id);
  return c.json({ items });
});

importsRoutes.post("/", async (c) => {
  const user = requireUser(c);
  // The import envelope legitimately carries up to 10 MiB of HTML, so it opts
  // out of the default 1 MiB JSON cap explicitly.
  const input = await parseJsonBody(c, createImportSchema, MAX_IMPORT_HTML_BYTES);
  const summary = await runImport(c.env, c.get("db"), user.id, input);
  return c.json({ import: summary }, 201);
});

importsRoutes.get("/:id", async (c) => {
  const user = requireUser(c);
  const summary = await getImportById(c.get("db"), user.id, c.req.param("id"));
  if (!summary) {
    throw notFound("Import not found");
  }
  return c.json({ import: summary });
});
