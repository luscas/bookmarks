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
just start-all      # deps + segredos + migrações D1, depois API (:8787) + SPA (:3000) + extensão (watch)
```

`just start-all` gera `apps/server/.dev.vars` com segredos aleatórios na primeira execução — edite o arquivo para trocá-los.
Rode `just --list` para as receitas individuais (`dev-server`, `dev-web`, `dev-extension`, `test`, `check`, `build`).

## Deploy

```bash
pnpm --filter @bookmarks/server deploy
```

See `docs/specs/` for the design spec.
