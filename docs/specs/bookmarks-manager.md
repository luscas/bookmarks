# Bookmarks Manager — Especificação da Fase 1

Especificação de design do gerenciador de favoritos auto-hospedado do monorepo
`bookmarks`. Descreve o que a fase 1 implementa, a arquitetura real, o modelo de
dados, a superfície da API, o provedor de IA, a extensão de navegador, as
decisões de segurança e o backlog da fase 2.

Referências de código relevantes: `packages/db/src/schema.ts`,
`packages/db/migrations/0001_fts5.sql`, `apps/server/src/routes/*.ts`,
`packages/ai/src/types.ts` e `apps/extension/src`.

---

## 1. Objetivo e escopo

### Fase 1 (em escopo)

- **Gerenciador de favoritos auto-hospedado**, compatível com navegador: um único
  Worker Cloudflare serve a SPA e a API `/api/*`; o usuário roda a sua própria
  instância (D1 + R2 + Queues).
- **Importação** de favoritos exportados do navegador:
  - HTML no formato Netscape (`source: "html"`), parseado no servidor;
  - árvore do Chrome (`chrome.bookmarks.getTree()`) convertida pela extensão em
    um envio em lote (`source: "chrome-json"`);
  - o caminho de pasta vira uma tag hierárquica (`folderPath → tag`).
- **Login/senha** (Better Auth: e-mail + senha, com plugin `username`) e
  **chaves de API** para a extensão.
- **IA opcional** para organizar listas desorganizadas: o usuário traz a própria
  chave (BYO key), e a IA sugere tags e/ou propõe uma taxonomia em jobs
  assíncronos.

### Fora de escopo na fase 1 (adiado)

- **Firefox** (a extensão é Chromium MV3).
- **Arquivamento de conteúdo** (snapshot da página).
- **Detecção de links mortos**.
- **Aplicativo mobile**.
- **Sincronização bidirecional** com o navegador (fase 1 é importação "mão
  única"; a extensão salva e importa, mas não reconcilia alterações do
  navegador de volta).

---

## 2. Arquitetura

### Layout do monorepo

pnpm workspaces + Turborepo. Scripts raiz (via turbo): `lint`, `typecheck`,
`test`, `build`.

```
apps/server       Worker: /api REST + Better Auth + assets estáticos + consumidor da fila de IA
apps/web          SPA React (Rsbuild) + TanStack Router/Query + Tailwind v4
apps/extension    Extensão Chromium MV3 (Rsbuild)
packages/shared   Schemas zod, tipos, normalização de URL, helpers de tag/pasta
packages/db       Schema Drizzle + migrações D1 (inclui FTS5)
packages/ai       Interface de provedor de IA + adapter OpenAI-compatible
```

### Um único Worker (SPA + API)

`apps/server/src/worker.ts` monta um app Hono:

- `GET /api/health` e todo o restante de `/api/*` na mesma origem da SPA;
- o binding `ASSETS` serve `apps/web/dist`; requisições que não são de API caem
  no fallback SPA (`not_found_handling: "single-page-application"` no
  `wrangler.jsonc`);
- como a SPA é servida pela mesma origem, **não precisa de CORS** para ela. O
  middleware CORS em `/api/*` existe para a extensão e demais origens
  confiáveis, com allowlist derivada de `TRUSTED_ORIGINS` (o padrão
  `chrome-extension://*` é sempre incluído).

### Persistência e serviços

- **D1 (SQLite) + Drizzle ORM**: banco principal; o cliente Drizzle é criado por
  request (`getDb(env)`) e nunca cacheado entre requests.
- **R2**: cache de favicons (`FAVICONS`), chave `favicons/<hostname>`.
- **Cloudflare Queues**: fila `bookmarks-ai` (com DLQ `bookmarks-ai-dlq`) para
  jobs de IA; o Worker consome os lotes em `queue(...)`.

### Autenticação

Better Auth (`apps/server/src/auth.ts`), montado em `/api/auth/*`:

- `emailAndPassword` habilitado;
- plugin `username` (login por nome de usuário);
- plugin `@better-auth/api-key` com:
  - `enableSessionForAPIKeys: true` — uma requisição com chave de API resolve
    para uma sessão, então as rotas não têm caso especial;
  - `customAPIKeyGetter` aceitando `Authorization: Bearer <key>` **e**
    `X-API-Key`;
- `trustedOrigins` a partir de `TRUSTED_ORIGINS` (lista separada por vírgulas) +
  `chrome-extension://*`.

O `sessionMiddleware` (`apps/server/src/middleware/session.ts`) monta o cliente
Drizzle e o Better Auth por request, resolve o usuário e marca `viaApiKey` para
distinguir chave de API de sessão de navegador.

### Fluxo de IA (visão geral)

1. O usuário salva o provedor/modelo/chave em `PUT /api/ai/settings`; a chave é
   cifrada (AES-GCM) antes de ir para `ai_settings`.
2. `POST /api/ai/tags` ou `POST /api/ai/organize` cria uma linha em `ai_jobs`
   com status `queued` e publica `{ jobId, userId, type }` na fila.
3. O consumidor `processAiJob` (`apps/server/src/lib/ai-jobs.ts`) lê a linha,
   descriptografa a chave, instancia o provedor e executa; grava `done`/`failed`
   no próprio job (erros não são re-lançados para evitar retry infinito de falha
   determinística).
4. A UI acompanha via `GET /api/ai/jobs/:id`.

---

## 3. Modelo de dados

Definido em `packages/db/src/schema.ts`. Os IDs das tabelas da aplicação são
`text` gerados na aplicação (ULID-like, `apps/server/src/lib/ids.ts`); as tabelas
do Better Auth também usam IDs `text`, gerados pelo próprio Better Auth. Datas
são `integer` em milissegundos (`timestamp_ms`), com default
`unixepoch('subsecond') * 1000`.

### Tabelas do Better Auth

- **`user`**: `id`, `name`, `email` (único), `email_verified`, `image`,
  `username` (único, do plugin), `created_at`, `updated_at`.
- **`session`**: `id`, `expires_at`, `token` (único), `ip_address`,
  `user_agent`, `user_id → user`.
- **`account`**: `id`, `account_id`, `provider_id`, `user_id`, tokens OAuth,
  `password` (hash), timestamps.
- **`verification`**: `id`, `identifier`, `value`, `expires_at`, timestamps.
- **`apikey`**: `id`, **`config_id`** (default `"default"`) e
  **`reference_id` → user.id** — nomes de coluna correspondentes aos campos
  `configId`/`referenceId` do Better Auth 1.7 (o adapter Drizzle indexa por nome
  de propriedade); além de `name`, `start`, `prefix`, `key` (único),
  `enabled`, `rate_limit_*`, `request_count`, `remaining`, `last_request`,
  `expires_at`, `permissions`, `metadata`. Índices em `reference_id` e
  `config_id`.

### Tabelas da aplicação

- **`bookmarks`**: `id`, `user_id → user`, `url`, `normalized_url`, `url_hash`,
  `title`, `description`, `notes`, `favicon_key`, `source`
  (`manual` | `import`), timestamps. Único por `(user_id, url_hash)` (dedupe por
  URL normalizada) e índice `(user_id, created_at)`.
- **`tags`**: `id`, `user_id`, `name`, `slug`, `color`, `kind`
  (`manual` | `ai` | `import`), `created_at`. Único por `(user_id, slug)`.
  Hierarquia é expressa no nome com `/` (`dev/react`), sem tabela própria.
- **`bookmark_tags`**: junção N:N com PK `(bookmark_id, tag_id)`, `source`
  (`manual` | `ai`) e `confidence` (real, opcional).
- **`imports`**: `id`, `user_id`, `source` (`chrome-json` | `html`), `status`
  (`running` | `done` | `failed`), `error` (motivo quando `failed`), `total`,
  `imported`, `skipped`, `created_at`, `finished_at`. Uma falha no meio da
  execução marca a linha como `failed` com o motivo em vez de deixá-la
  `running`.
- **`ai_settings`**: PK `user_id`, `provider` (`openai-compatible`), `model`,
  `base_url`, `api_key_ciphertext`, `api_key_iv`, `updated_at`.
- **`ai_jobs`**: `id`, `user_id`, `type` (`tag_bookmarks` |
  `organize_taxonomy`), `status` (`queued` | `running` | `done` | `failed`),
  `payload` (JSON), `result` (JSON, opcional), `error`, `created_at`,
  `finished_at`; índice `(user_id, created_at)`.

### Índice FTS5

`packages/db/migrations/0001_fts5.sql` cria a tabela virtual de busca em texto
completo:

- **`bookmarks_fts`** com `title`, `description`, `notes`, `url`;
- `content='bookmarks'`, `content_rowid='rowid'`,
  `tokenize='unicode61 remove_diacritics 2'` (external content);
- triggers `bookmarks_fts_ai` (insert), `bookmarks_fts_ad` (delete) e
  `bookmarks_fts_au` (update) mantêm o índice em sincronia, mais um `rebuild`
  inicial.

A busca (`apps/server/src/lib/fts.ts` + `listing.ts`) sanitiza a entrada
envolvendo cada termo em aspas duplas (AND implícito) e filtra por
`rowid in (select rowid from bookmarks_fts where bookmarks_fts match ?)`.

As migrações são versionadas em `packages/db/migrations/` e embutidas em
`packages/db/src/migrations.ts` (um Worker não consegue ler arquivos do disco).
`runMigrations` aplica cada migração uma única vez, registrando-a na tabela de
controle `__migrations` e pulando as já registradas — assim migrações não
idempotentes (`ALTER TABLE`, reconstrução de tabela) rodam exatamente uma vez.
Um teste garante que o SQL embutido e *todos* os arquivos `.sql` do diretório
permaneçam idênticos e completos. No runtime o D1 é migrado pelo wrangler
(`db:migrate:local`/`db:migrate:remote`); `runMigrations` hoje é exercitado pela
suíte de testes, não em produção.

---

## 4. Superfície da API

Convenções:

- Todas as rotas abaixo, exceto `/api/health`, `/api/auth/*` e `/api/favicon*`,
  exigem sessão de navegador **ou** chave de API; respondem `401` sem credencial.
- Erros seguem `{ error: { message, issues? } }`; o Better Auth pode devolver
  `{ message }` simples.
- Datas são ISO-8601 (`toISOString()`).
- Validação de corpo e query com zod (`parseJsonBody`/`parseQuery`), retornando
  `400` com a lista de `issues`.
- Listagem é paginada por cursor opaco (keyset, nunca `OFFSET`).

### Saúde e autenticação

| Método | Caminho | Descrição |
| --- | --- | --- |
| `GET` | `/api/health` | `{ status: "ok", timestamp }` (público). |
| `POST` | `/api/auth/sign-up/email` | Cadastro: `{ email, password, name, username }` → sessão Better Auth. |
| `POST` | `/api/auth/sign-in/email` | Login: `{ email, password }` → sessão. |
| `POST` | `/api/auth/sign-out` | Encerra a sessão. |
| `*` | `/api/auth/api-key/*` | Endpoints do plugin de chave de API (Better Auth); aceita `Authorization: Bearer` e `X-API-Key`. |

### Bookmarks

| Método | Caminho | Corpo / resposta |
| --- | --- | --- |
| `GET` | `/api/bookmarks` | Query `q?`, `tag?` (repetível), `sort=createdAt\|updatedAt\|title`, `cursor?`, `limit?` → `{ items: Bookmark[], nextCursor: string\|null }`. |
| `POST` | `/api/bookmarks` | `{ url, title?, description?, notes?, tags?[] }` → `{ bookmark, created }` (`201` se criado, `200` se já existia). |
| `POST` | `/api/bookmarks/bulk` | `{ source?: "manual"\|"import", items: [{ url, title?, folderPath?, addedAt? }] }` → `{ imported, skipped, bookmarkIds }`. |
| `GET` | `/api/bookmarks/:id` | → `{ bookmark }` ou `404`. |
| `PATCH` | `/api/bookmarks/:id` | `{ title?, description?, notes? }` (anuláveis) → `{ bookmark }`. |
| `DELETE` | `/api/bookmarks/:id` | → `204`. |
| `PUT` | `/api/bookmarks/:id/tags` | `{ tags: string[] }` (substitui o conjunto) → `{ bookmark }`. |

### Tags

| Método | Caminho | Corpo / resposta |
| --- | --- | --- |
| `GET` | `/api/tags` | → `{ items: Tag[] }` (com `bookmarkCount`). |
| `POST` | `/api/tags` | `{ name, color? }` → `{ tag }` (`201`); `409` se o slug já existe. |
| `POST` | `/api/tags/merge` | `{ sourceTagIds, targetTagId }` → `{ tag }` (reaponta os vínculos e apaga as tags de origem). |
| `PATCH` | `/api/tags/:id` | `{ name?, color? }` → `{ tag }`. |
| `DELETE` | `/api/tags/:id` | → `204`. |

### Importações

| Método | Caminho | Corpo / resposta |
| --- | --- | --- |
| `GET` | `/api/imports` | → `{ items: ImportSummary[] }` (mais recentes primeiro; `ImportSummary` inclui `status` e `error: string\|null`). |
| `POST` | `/api/imports` | `{ source: "html"\|"chrome-json", items?, html?, autoTag? }` (exige `items` ou `html`) → `{ import }` (`201`). `413` se o HTML exceder 10 MiB. |
| `GET` | `/api/imports/:id` | → `{ import }` ou `404`. |

- Em `NODE_ENV=development` o servidor pré-configura um Ollama local
  (`qwen3.5:4b` em `http://localhost:11434/v1`) e dispara a organização por IA
  na importação por padrão; isso nunca se aplica em produção.

### IA

| Método | Caminho | Corpo / resposta |
| --- | --- | --- |
| `GET` | `/api/ai/settings` | → `{ settings: { provider, model, baseUrl, hasApiKey, updatedAt } \| null }`. |
| `PUT` | `/api/ai/settings` | `{ provider, model, baseUrl?, apiKey? }` → `{ settings }`; omitir `apiKey` mantém a chave atual. |
| `POST` | `/api/ai/tags` | `{ bookmarkIds: string[] }` → `{ jobId }` (`202`). |
| `POST` | `/api/ai/organize` | `{ scope: "untagged"\|"all" }` → `{ jobId }` (`202`). |
| `GET` | `/api/ai/jobs` | → `{ items: AiJob[] }` (até 20, mais recentes primeiro). |
| `GET` | `/api/ai/jobs/:id` | → `{ job: AiJob }` ou `404`. |

### Usuário e chaves de API

| Método | Caminho | Corpo / resposta |
| --- | --- | --- |
| `GET` | `/api/me` | → `{ user, counts: { bookmarks, tags } }`. |
| `PATCH` | `/api/me` | `{ name }` → `{ user }`. |
| `GET` | `/api/me/api-keys` | → `{ apiKeys: [...] }` (somente sessão de navegador). |
| `POST` | `/api/me/api-keys` | `{ name? }` → chave criada incluindo `key` (`201`); somente sessão de navegador. |
| `DELETE` | `/api/me/api-keys/:id` | → `{ success: true }`; somente sessão de navegador. |

> As rotas `/api/me/api-keys*` usam `requireBrowserSession`: uma chave de API
> não pode gerenciar chaves de API.

### Favicon (público)

| Método | Caminho | Descrição |
| --- | --- | --- |
| `GET` | `/api/favicon?url=<url>` | Resolve o host da URL, busca/cacheia no R2 e devolve os bytes da imagem. Sem autenticação (uso em `<img>`). |
| `GET` | `/api/favicon/:key` | Devolve o favicon já armazenado no R2. |

---

## 5. Provedor de IA plugável

- **Interface** (`packages/ai/src/types.ts`): `AiProvider` com
  `suggestTags(bookmarks, existingTags)` e
  `proposeTaxonomy(bookmarks, existingTags)`; tipos de entrada/saída
  (`BookmarkForAi`, `TagSuggestion`, `TaxonomyProposal`, `AiProviderConfig`).
  Nenhum detalhe de transporte vaza para `@bookmarks/shared`.
- **Factory** (`createProvider`): switch exaustivo sobre `AiProviderId`. Na fase
  1 só existe `openai-compatible`.
- **Adapter OpenAI-compatible** (`packages/ai/src/openai-compatible.ts`):
  `POST {baseUrl or https://api.openai.com/v1}/chat/completions` com
  `Authorization: Bearer <apiKey>` e `response_format: { type: "json_schema" }`
  (cobre OpenAI, OpenRouter, Groq e servidores locais compatíveis). Extrai o
  conteúdo tolerando cercas markdown e valida o JSON.
- **BYO API key cifrada em repouso**: a chave é cifrada com **AES-GCM**
  (`apps/server/src/lib/crypto.ts`) usando `AI_KEY_ENCRYPTION_SECRET` (base64,
  32 bytes) e IV aleatório de 12 bytes, ambos armazenados nas colunas
  `api_key_ciphertext`/`api_key_iv` de `ai_settings`.
- **Jobs assíncronos**: `createAiJob` grava o job e publica na Queue; o
  consumidor `processAiJob` (`apps/server/src/lib/ai-jobs.ts`) executa
  `tag_bookmarks` ou `organize_taxonomy`; o payload (ids/escopo) vive na linha
  de `ai_jobs`, não na mensagem.
- **Batching e retry**:
  - lotes de `AI_BATCH_SIZE` (20) bookmarks por chamada de provider
    (`packages/shared/src/constants.ts`), com merge das propostas de taxonomia;
  - até 2 retries (3 tentativas totais) com backoff exponencial (250 ms base)
    para `429`/`5xx`; erros são gravados no job como `failed`.
  - `organize_taxonomy` considera no máximo 200 bookmarks por execução
    (`ORGANIZE_LIMIT`), e tags por favorito são limitadas a
    `MAX_TAGS_PER_BOOKMARK` (12).

---

## 6. Extensão MV3

`apps/extension` (Chromium MV3, Chrome/Edge/Brave), construída com Rsbuild em
três entradas: `popup`, `options` e `background` (service worker, `html: false`,
`type: module`).

- **Manifesto**: `manifest_version: 3`, permissões `activeTab`, `tabs`,
  `storage`, `bookmarks`, `contextMenus`; `optional_host_permissions` para
  `http(s)://*/*` (o usuário concede acesso ao próprio servidor em Options);
  nenhuma URL de servidor fica fixa no manifesto.
- **Auth por chave de API**: configurações em `chrome.storage.local`
  (`serverUrl` + `apiKey`, `apps/extension/src/lib/settings.ts`). Toda requisição
  envia `Authorization: Bearer <apiKey>` (`apps/extension/src/lib/api.ts`), com
  junção `serverUrl + /api + path`. Erros viram `ApiError` tipado
  (incl. `401`/`403`/`404`/`409`).
- **Salvar aba**: o popup envia `POST /api/bookmarks` com a URL/título da aba
  ativa e tags opcionais; o background também registra um item de menu de
  contexto ("Salvar nos bookmarks") que salva página ou link, com feedback via
  badge.
- **Importar `chrome.bookmarks.getTree()`**: em Options, a árvore é convertida
  por `bookmarkTreeToItems` (`apps/extension/src/lib/browser-bookmarks.ts`) em
  itens `{ url, title, folderPath, tags }`; `folderPathToTagName` (mesmo helper
  do servidor) transforma o caminho de pastas em uma tag hierárquica, ignorando
  as pastas raiz. Os itens são enviados em lotes de `BULK_IMPORT_CHUNK_SIZE`
  (200) para `POST /api/bookmarks/bulk`.

---

## 7. Segurança

- **Isolamento por usuário**: toda consulta filtra por `user_id` (ou
  `eq(userId)` combinado ao id), e operações sobre recursos inexistentes/alheios
  retornam `404` em vez de vazar existência.
- **Cifra da chave de IA**: AES-GCM com `AI_KEY_ENCRYPTION_SECRET`; a chave em
  texto claro nunca é persistida nem devolvida pela API (`hasApiKey` apenas).
- **SSRF guard no favicon** (`apps/server/src/lib/favicon.ts`): rejeita hosts
  privados (`localhost`, `*.local`, `*.internal`, faixas RFC1918, `::1`),
  `redirect: "follow"` com timeout de 5 s, aceita apenas `content-type` de uma
  allowlist raster (`png`, `x-icon`/`vnd.microsoft.icon`, `jpeg`, `gif`, `webp`)
  e corta o corpo em um tamanho máximo antes de gravar no R2.
- **Validação zod** na borda (corpo, query e envio da extensão), com mensagens
  estruturadas (`issues`).
- **Trusted origins**: CORS em `/api/*` com allowlist e `trustedOrigins` do
  Better Auth derivados de `TRUSTED_ORIGINS`; `chrome-extension://*` sempre
  permitido. A extensão pede permissão de host opcional em vez de declarar hosts
  fixos.
- **Chaves de API restritas**: `/api/me/api-keys*` exige sessão de navegador; a
  chave nunca é logada e só trafega no cabeçalho `Authorization`.

---

## 8. Decisões adotadas

- **Licença**: AGPL-3.0.
- **Multi-usuário**: um único deploy atende várias contas, com isolamento por
  `user_id`.
- **Drizzle ORM** sobre D1 (schema tipado + migrações versionadas).
- **TanStack Router + TanStack Query** na SPA.
- **Tailwind v4 + componentes estilo shadcn/ui** (Radix + CVA).
- **pt-BR com strings centralizadas** na UI, preparado para i18n.
- **pnpm + Turborepo + Biome** (lint/format únicos no repositório).
- **Importação unidirecional e IA opt-in**: a fase 1 importa do navegador (mão
  única) e a IA usa a chave do próprio usuário (BYO key).

---

## 9. Backlog — fase 2

- **Firefox**: extensão WebExtensions (a API de favoritos difere do namespace
  `chrome.*`).
- **Arquivamento de conteúdo**: snapshot da página no R2 para preservar o
  conteúdo.
- **Links mortos**: verificação periódica (job/cron) e marcação de favoritos
  quebrados.
- **Mobile**: cliente dedicado (ou PWA) para captura rápida.
- **Sincronização bidirecional**: reconciliar alterações feitas no navegador e
  no servidor (não só importar).
- Extras naturais do que já existe: novos provedores de IA além de
  `openai-compatible`, UI de árvore para tags hierárquicas, e agendamento de
  organização automática.

---

## 10. Como rodar localmente

Requisitos: Node 22 (`.nvmrc`) e pnpm 9 (`.npmrc`).

```bash
pnpm install
```

1. **Segredos do Worker** — copie o exemplo e preencha:

   ```bash
   cp .dev.vars.example .dev.vars
   # BETTER_AUTH_SECRET, BETTER_AUTH_URL (http://localhost:8787),
   # AI_KEY_ENCRYPTION_SECRET (openssl rand -base64 32) e TRUSTED_ORIGINS.
   ```

2. **Migrações no D1 local** — o `wrangler.jsonc` aponta
   `migrations_dir: "../../packages/db/migrations"`:

   ```bash
   pnpm --filter @bookmarks/server exec wrangler d1 migrations apply bookmarks --local
   ```

   > Os atalhos da raiz `db:migrate:local`/`db:migrate:remote` rodam exatamente
   > esse comando do wrangler.

3. **Servidor** (`wrangler dev`, porta 8787):

   ```bash
   pnpm --filter @bookmarks/server dev
   ```

4. **Web** (Rsbuild dev; por padrão em `http://localhost:3000`, com proxy de
   `/api` para `localhost:8787`):

   ```bash
   pnpm --filter @bookmarks/web dev
   ```

   Ajuste `TRUSTED_ORIGINS` para a origem real do dev server da web.

5. **Extensão** (build para uma pasta `dist/` carregável como extensão
   desempacotada):

   ```bash
   pnpm --filter @bookmarks/extension build
   ```

Em Watch para todos os apps de uma vez: `pnpm dev` (turbo).

---

## 11. Limitações conhecidas / riscos aceitos

Decisões conscientes, com o risco residual que cada uma assume:

- **`baseUrl` da IA é controlado pelo usuário e `localhost` é permitido de
  propósito**: o provedor é *bring your own key* (ex.: Ollama ou outro servidor
  local), então endpoints internos são aceitos. Não há guarda anti-SSRF nesse
  caminho; a mitigação é que só o próprio usuário autenticado, com a chave já
  cifrada, consegue disparar requisições.
- **DNS rebinding no host do favicon**: `apps/server/src/lib/favicon.ts` bloqueia
  hostnames e IPs literais privados *antes* do fetch, mas um host que resolva
  para um IP público na validação e para um IP privado no fetch não é detectado —
  sem API de DNS no Workers não há como fixar o IP de destino. O corpo é limitado
  (`MAX_FAVICON_BYTES`) e o `content-type` restrito a uma allowlist raster.
- **Sem suíte de integração com `@cloudflare/vitest-pool-workers`**:
  `apps/server/test/integration/` está vazio. Limites de parâmetros do D1
  (chunking de `IN (...)`/INSERT), corridas de `UNIQUE` e o caminho de falha do
  R2 são cobertos apenas por testes unitários — sem D1/R2 reais.
- **DLQ da fila de IA sem consumidor**: a fila `bookmarks-ai` tem
  `dead_letter_queue: "bookmarks-ai-dlq"` em `apps/server/wrangler.jsonc`, mas
  nenhum Worker consome essa DLQ; mensagens que esgotam `max_retries` ficam
  paradas na fila.
- **`GET /api/ai/settings` com efeito de escrita no modo dev**: em
  `NODE_ENV=development` essa rota provisiona de forma preguiçosa as
  configurações do Ollama local (idempotente: só insere quando o usuário ainda
  não tem linha em `ai_settings`, via `onConflictDoNothing`). É um `GET` com
  efeito colateral, aceito por ser exclusivo de desenvolvimento; em produção é
  um no-op e a rota continua somente-leitura.
- **Sem timeout nem limite de tokens na chamada ao provedor de IA**: o adapter
  OpenAI-compatible (`packages/ai/src/openai-compatible.ts`) não define timeout
  de requisição nem `max_tokens`/teto de tokens. Um modelo "pensante" pode
  consumir latência e tokens sem limite superior. Aceito por ora; deve ser
  resolvido antes de uso em escala com IA habilitada.
- **Lote de `tag_bookmarks` sem fatiamento**: `runImport` passa **todos** os ids
  importados (até `MAX_IMPORT_ITEMS`) em um único job `tag_bookmarks`. Os
  consumidores da fila são processados sequencialmente e estão sujeitos ao
  limite de 15 minutos de wall-clock por invocação do Cloudflare — uma execução
  real levou ~150 s para um lote de apenas 3 favoritos. Aceito por ora; deve ser
  endereçado (fatiar o payload em jobs menores) antes de importações grandes com
  IA habilitada.

