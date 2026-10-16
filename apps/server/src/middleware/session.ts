import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { Auth } from "../auth.js";
import { createAuth } from "../auth.js";
import type { Db } from "../db.js";
import { getDb } from "../db.js";
import type { Env } from "../env.js";
import { forbidden, unauthorized } from "../lib/http.js";

/** The subset of the Better Auth user the API exposes. */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  username: string | null;
  image: string | null;
}

/** Hono bindings and context variables shared by every route. */
export interface AppBindings {
  Bindings: Env;
  Variables: {
    db: Db;
    auth: Auth;
    user: SessionUser | null;
    viaApiKey: boolean;
  };
}

const API_KEY_HEADER = "x-api-key";

function requestUsesApiKey(headers: Headers): boolean {
  if (headers.get(API_KEY_HEADER)) {
    return true;
  }
  const authorization = headers.get("authorization");
  return authorization !== null && /^bearer /i.test(authorization);
}

function toSessionUser(user: {
  id: string;
  email: string;
  name: string;
  username?: unknown;
  image?: unknown;
}): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    username: typeof user.username === "string" ? user.username : null,
    image: typeof user.image === "string" ? user.image : null,
  };
}

/**
 * Build the per-request Drizzle client and Better Auth instance, then resolve
 * the caller's session. API keys authenticate through the same path because the
 * `apiKey` plugin is configured with `enableSessionForAPIKeys`.
 */
export const sessionMiddleware = createMiddleware<AppBindings>(async (c, next) => {
  const db = getDb(c.env);
  const auth = createAuth(c.env);
  c.set("db", db);
  c.set("auth", auth);
  c.set("viaApiKey", requestUsesApiKey(c.req.raw.headers));

  let user: SessionUser | null = null;
  try {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    user = session ? toSessionUser(session.user) : null;
  } catch (error) {
    console.error("Failed to resolve session", error);
    user = null;
  }
  c.set("user", user);

  await next();
});

/** Return the authenticated user, or throw a 401. */
export function requireUser(c: Context<AppBindings>): SessionUser {
  const user = c.get("user");
  if (!user) {
    throw unauthorized();
  }
  return user;
}

/** Guard routes that must not be driven by an API key (API key management). */
export function requireBrowserSession(c: Context<AppBindings>): void {
  if (c.get("viaApiKey")) {
    throw forbidden("API keys cannot be managed with an API key");
  }
}
