# Segurança

## Escopo e modelo de ameaça

Aplicativo self-hosted **multi-usuário** executado em um Cloudflare Worker:

- **Servidor** (`apps/server`): API REST + Better Auth + assets da SPA. Cada
  usuário só enxerga os próprios favoritos, tags, importações e chaves de API.
- **Extensão Chromium** (`apps/extension`): MV3, autenticada por chave de API;
  não há servidor embutido e nenhuma permissão de host fixa.
- **IA**: bring-your-own-key por usuário; a chave do provider é cifrada com
  AES-GCM antes de ir para o banco e só é decifrada em memória, no momento da
  chamada.

## Registro aberto por padrão

**Qualquer pessoa que alcançar a instância pode criar uma conta** (comportamento
atual; não há convites/aprovação). Se a instância não deve ser pública, coloque-a
atrás de Cloudflare Access, um tunnel com autenticação ou outra camada de
controle de acesso antes de expor o domínio.

## CORS `chrome-extension://*`

Origens `chrome-extension://<id>` são aceitas automaticamente. Aceitamos o
curinga por enquanto porque o ID de uma extensão self-hosted (carregada
descompactada) muda a cada instalação. **Ao publicar na Chrome Web Store, o ID
fica estável e o curinga deve ser substituído pelo ID exato** em
`TRUSTED_ORIGINS`.

## Rate limiting

- **Per-IP** (janela fixa no D1, compartilhada entre isolates), via
  `CF-Connecting-IP`: 10 tentativas / 10 min em sign-in, 5 / hora em sign-up,
  60 / min no proxy de favicons. Requisições sem o cabeçalho (dev local) passam.
- **Por chave de API**: 5.000 requisições / hora (plugin `apiKey`).
- **Residual**: o limiter interno do Better Auth mantém estado em memória, por
  isolate — sozinho não frearia um brute-force distribuído. É por isso que o
  limite per-IP acima existe na borda e é a defesa efetiva.

## Como reportar vulnerabilidades

Não divulgue publicamente antes de uma correção. Reporte em privado para:
`SECURITY_CONTACT` (placeholder — o mantenedor deve substituir pelo canal
desejado, ex.: e-mail ou issue privada de security advisory no GitHub).

## Segredos

Gere com `openssl rand` (veja `.dev.vars.example`); nunca reutilize entre
ambientes:

```bash
openssl rand -hex 32    # BETTER_AUTH_SECRET (≥ 32 chars; o boot falha se menor)
openssl rand -base64 32 # AI_KEY_ENCRYPTION_SECRET (base64 de 32 bytes)
```

- `BETTER_AUTH_SECRET`: assina sessões/tokens; abaixo de 32 caracteres o Worker
  recusa iniciar (falha rápida, sem fallback silencioso).
- `AI_KEY_ENCRYPTION_SECRET`: chave AES-GCM das chaves de IA dos usuários;
  valores que não decodifiquem em 32 bytes são rejeitados.
- Em produção, defina via `wrangler secret put` — `vars`/`.dev.vars` não são
  para segredos.

## Dependências

Os advisories restantes do `pnpm audit` estão em ferramentas de desenvolvimento
(vite/vitest/esbuild/drizzle-kit, alcançados por peer-deps opcionais de
`better-auth`). Nenhum desses módulos é importado pelo Worker em tempo de
execução — nada disso vai para o bundle publicado.
