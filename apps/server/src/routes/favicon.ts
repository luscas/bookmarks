import { Hono } from "hono";
import {
  FAVICON_PREFIX,
  faviconKeyFor,
  isAllowedIconContentType,
  normalizeContentType,
  resolveFavicon,
} from "../lib/favicon.js";
import { badRequest, notFound } from "../lib/http.js";
import { FAVICON_RATE_LIMIT, ipRateLimit } from "../lib/rate-limit.js";
import type { AppBindings } from "../middleware/session.js";

const CACHE_CONTROL = "public, max-age=604800, immutable";
/** Never let a stored icon be sniffed into something executable. */
const ICON_HEADERS = {
  "cache-control": CACHE_CONTROL,
  "x-content-type-options": "nosniff",
} as const;

/**
 * Public favicon proxy. It is intentionally unauthenticated so that `<img>`
 * tags work without credentials; keys are hostnames, not user data.
 */
export const faviconRoutes = new Hono<AppBindings>();

// The proxy endpoint does remote fetches and R2 writes, so it is rate limited
// per IP (the `/:key` route below only reads cached objects and is not).
faviconRoutes.use("/", ipRateLimit(FAVICON_RATE_LIMIT));

faviconRoutes.get("/", async (c) => {
  const url = c.req.query("url");
  if (!url) {
    throw badRequest("The `url` query parameter is required");
  }
  const hostname = faviconKeyFor(url);
  if (!hostname) {
    throw badRequest("The `url` must point at a public host");
  }
  const icon = await resolveFavicon(c.env, hostname);
  if (!icon) {
    throw notFound("Favicon not found");
  }
  return new Response(icon.body, {
    headers: { "content-type": icon.contentType, ...ICON_HEADERS },
  });
});

faviconRoutes.get("/:key", async (c) => {
  const key = `${FAVICON_PREFIX}${c.req.param("key")}`;
  let body: ArrayBuffer | null = null;
  let contentType = "image/x-icon";
  try {
    const object = await c.env.FAVICONS.get(key);
    if (object) {
      const storedType = normalizeContentType(object.httpMetadata?.contentType ?? "");
      if (isAllowedIconContentType(storedType)) {
        body = await object.arrayBuffer();
        contentType = storedType;
      }
    }
  } catch {
    body = null;
  }
  if (!body) {
    throw notFound("Favicon not found");
  }
  return new Response(body, {
    headers: { "content-type": contentType, ...ICON_HEADERS },
  });
});
