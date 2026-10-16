# Bookmarks

A self-hosted, open-source bookmark manager: import your browser bookmarks, and let an
optional AI organize them into tags.

- **Stack:** Cloudflare Workers · Hono · Better Auth · D1 (SQLite + FTS5) · R2 · Cloudflare Queues
- **Frontend:** React + RSBuild (+ TanStack Router/Query, Tailwind, shadcn/ui)
- **Extension:** Chromium MV3 (Chrome/Edge/Brave), built with RSBuild
- **AI:** bring-your-own API key, pluggable providers (OpenAI-compatible first)

## Layout

```
apps/server       Worker: /api REST + Better Auth + static assets + AI job consumer
apps/web          React SPA (RSBuild)
apps/extension    Chromium MV3 extension (RSBuild)
packages/shared   zod schemas, types, URL normalization
packages/db       Drizzle schema + D1 migrations (incl. FTS5)
packages/ai       AI provider interface + adapters
```

## Develop

```bash
pnpm install
pnpm dev            # runs server, web and extension in watch mode
```

The Worker needs local secrets — copy `.dev.vars.example` to `.dev.vars` and fill it in.

## Deploy

```bash
pnpm --filter @bookmarks/server deploy
```

See `docs/specs/` for the design spec.
