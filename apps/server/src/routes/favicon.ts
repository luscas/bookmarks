import { Hono } from "hono";
import { FAVICON_PREFIX, faviconKeyFor, resolveFavicon } from "../lib/favicon.js";
import { badRequest, notFound } from "../lib/http.js";
import type { AppBindings } from "../middleware/session.js";

const CACHE_CONTROL = "public, max-age=604800, immutable";

/**
 * Public favicon proxy. It is intentionally unauthenticated so that `<img>`
 * tags work without credentials; keys are hostnames, not user data.
 */
export const faviconRoutes = new Hono<AppBindings>();

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
    headers: { "content-type": icon.contentType, "cache-control": CACHE_CONTROL },
  });
});

faviconRoutes.get("/:key", async (c) => {
  const object = await c.env.FAVICONS.get(`${FAVICON_PREFIX}${c.req.param("key")}`);
  if (!object) {
    throw notFound("Favicon not found");
  }
  return new Response(await object.arrayBuffer(), {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "image/x-icon",
      "cache-control": CACHE_CONTROL,
    },
  });
});
