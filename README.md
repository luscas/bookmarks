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

Antes do primeiro deploy de produção, configure (veja `SECURITY.md` para os
detalhes de cada um):

```bash
# Segredos — gere com openssl rand (hex/base64 32 bytes)
pnpm --filter @bookmarks/server exec wrangler secret put BETTER_AUTH_SECRET
pnpm --filter @bookmarks/server exec wrangler secret put AI_KEY_ENCRYPTION_SECRET

# Configuração por ambiente (não são segredos): defina como vars no dashboard
# do Cloudflare, ou via `wrangler secret put` se preferir manter tudo na CLI.
#   BETTER_AUTH_URL=https://favoritos.seu-dominio.com   (sempre https)
#   TRUSTED_ORIGINS=https://favoritos.seu-dominio.com
```

O registro é aberto por padrão: qualquer pessoa que alcançar a instância pode
criar conta. Se isso não for desejado, coloque-a atrás de Cloudflare Access ou
outro controle de acesso (veja `SECURITY.md`).

## Segurança

- Consulte [`SECURITY.md`](SECURITY.md) para o modelo de ameaça, rate limiting,
  CORS e como reportar vulnerabilidades.
- Licença: [AGPL-3.0](LICENSE). Em resumo: você pode usar, estudar, modificar e
  redistribuir, mas distribuições (incluindo serviços oferecidos a terceiros)
  precisam manter o código-fonte aberto sob a mesma licença.
- Permissões da extensão — cada uma existe por um motivo específico:
  - `activeTab` — ler URL/título da aba ativa ao salvar (concedido só no clique);
  - `storage` — guardar a URL do servidor e a chave de API em
    `chrome.storage.local`;
  - `bookmarks` — importar a árvore de favoritos do navegador;
  - `contextMenus` — item "Salvar nos bookmarks" no menu de contexto;
  - `optional_host_permissions` (`http://*/*`, `https://*/*`) — acesso ao seu
    servidor, concedido em tempo de execução pelo usuário.
- Status: projeto em desenvolvimento — use por sua conta e risco.

See `docs/specs/` for the design spec.
