import { aiSettings } from "@bookmarks/db";
import {
  aiOrganizeRequestSchema,
  aiSettingsInputSchema,
  aiTagRequestSchema,
} from "@bookmarks/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { getOrProvisionAiSettings, isDevelopment } from "../lib/ai-config.js";
import { createAiJob, getAiJobById, listAiJobs, toJobSummary } from "../lib/ai-jobs.js";
import { encryptApiKey } from "../lib/crypto.js";
import { notFound } from "../lib/http.js";
import { parseJsonBody } from "../lib/validation.js";
import type { AppBindings } from "../middleware/session.js";
import { requireUser, sessionMiddleware } from "../middleware/session.js";

export const aiRoutes = new Hono<AppBindings>();

aiRoutes.use("*", sessionMiddleware);

aiRoutes.get("/settings", async (c) => {
  const user = requireUser(c);
  // Provision the dev Ollama when needed so the UI shows the pre-configured
  // model; production still reports `null` until the user configures one.
  const row = await getOrProvisionAiSettings(c.env, c.get("db"), user.id);
  // The dev-only default for the import page's "organise with AI" checkbox;
  // production always reports `false`, so its behaviour is unchanged.
  const autoTagByDefault = isDevelopment(c.env);
  if (!row) {
    return c.json({ settings: null, autoTagByDefault });
  }
  return c.json({
    settings: {
      provider: row.provider,
      model: row.model,
      baseUrl: row.baseUrl ?? null,
      reasoningEffort: row.reasoningEffort ?? null,
      hasApiKey: Boolean(row.apiKeyCiphertext),
      updatedAt: row.updatedAt.toISOString(),
    },
    autoTagByDefault,
  });
});

aiRoutes.put("/settings", async (c) => {
  const user = requireUser(c);
  const input = await parseJsonBody(c, aiSettingsInputSchema);
  const db = c.get("db");

  let ciphertext: string | null | undefined;
  let iv: string | null | undefined;
  if (input.apiKey) {
    const encrypted = await encryptApiKey(input.apiKey, c.env.AI_KEY_ENCRYPTION_SECRET);
    ciphertext = encrypted.ciphertext;
    iv = encrypted.iv;
  }

  const now = new Date();
  const existing = await db.select().from(aiSettings).where(eq(aiSettings.userId, user.id)).get();

  const nextCiphertext = ciphertext ?? existing?.apiKeyCiphertext ?? null;
  const nextIv = iv ?? existing?.apiKeyIv ?? null;
  const baseUrl = input.baseUrl ?? null;
  // Mirrors `baseUrl`: omitting the field on the wire clears it.
  const reasoningEffort = input.reasoningEffort ?? null;

  await db
    .insert(aiSettings)
    .values({
      userId: user.id,
      provider: input.provider,
      model: input.model,
      baseUrl,
      reasoningEffort,
      apiKeyCiphertext: nextCiphertext,
      apiKeyIv: nextIv,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: aiSettings.userId,
      set: {
        provider: input.provider,
        model: input.model,
        baseUrl,
        reasoningEffort,
        apiKeyCiphertext: nextCiphertext,
        apiKeyIv: nextIv,
        updatedAt: now,
      },
    });

  return c.json({
    settings: {
      provider: input.provider,
      model: input.model,
      baseUrl,
      reasoningEffort,
      hasApiKey: nextCiphertext !== null,
      updatedAt: now.toISOString(),
    },
  });
});

aiRoutes.post("/tags", async (c) => {
  const user = requireUser(c);
  const input = await parseJsonBody(c, aiTagRequestSchema);
  const jobId = await createAiJob(c.env, c.get("db"), user.id, "tag_bookmarks", {
    bookmarkIds: input.bookmarkIds,
  });
  return c.json({ jobId }, 202);
});

aiRoutes.post("/organize", async (c) => {
  const user = requireUser(c);
  const input = await parseJsonBody(c, aiOrganizeRequestSchema);
  const jobId = await createAiJob(c.env, c.get("db"), user.id, "organize_taxonomy", {
    scope: input.scope,
  });
  return c.json({ jobId }, 202);
});

aiRoutes.get("/jobs", async (c) => {
  const user = requireUser(c);
  const rows = await listAiJobs(c.get("db"), user.id);
  return c.json({ items: rows.map(toJobSummary) });
});

aiRoutes.get("/jobs/:id", async (c) => {
  const user = requireUser(c);
  const row = await getAiJobById(c.get("db"), user.id, c.req.param("id"));
  if (!row) {
    throw notFound("AI job not found");
  }
  return c.json({ job: toJobSummary(row) });
});
