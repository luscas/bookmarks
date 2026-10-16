# Developer entrypoints for the bookmarks monorepo.
#
#   just start-all      # tudo: deps, segredos, migrações, API + SPA + extensão
#   just --list         # lista todas as receitas
#
# Stop `start-all` with Ctrl+C.

set shell := ["bash", "-euo", "pipefail", "-c"]

server := "@bookmarks/server"
web := "@bookmarks/web"
extension := "@bookmarks/extension"

# List recipes.
default:
    @just --list

# ── Setup ──────────────────────────────────────────────────────────────────────

# Install workspace dependencies.
install:
    pnpm install

# Create apps/server/.dev.vars from the example, generating real secrets on first run.
env:
    #!/usr/bin/env bash
    set -euo pipefail
    file="apps/server/.dev.vars"
    if [ -f "$file" ]; then
      echo "==> $file já existe — mantendo como está"
      exit 0
    fi
    echo "==> gerando $file com segredos aleatórios"
    auth_secret="$(openssl rand -hex 32)"
    enc_secret="$(openssl rand -base64 32 | tr -d '\n')"
    sed -e "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=${auth_secret}|" \
        -e "s|^AI_KEY_ENCRYPTION_SECRET=.*|AI_KEY_ENCRYPTION_SECRET=${enc_secret}|" \
        .dev.vars.example > "$file"

# Apply pending D1 migrations to the local dev database.
migrate:
    pnpm db:migrate:local

# Apply pending D1 migrations to the remote (deployed) database.
migrate-remote:
    pnpm db:migrate:remote

# Generate a new Drizzle migration from schema changes.
db-generate:
    pnpm db:generate

# ── Run individually ───────────────────────────────────────────────────────────

# Run the API worker (wrangler dev) on :8787.
dev-server:
    pnpm --filter {{server}} dev

# Run the SPA dev server on :3000.
dev-web:
    pnpm --filter {{web}} dev

# Rebuild the Chromium extension into apps/extension/dist on change.
dev-extension:
    pnpm --filter {{extension}} exec rsbuild build --watch

# ── Run everything ─────────────────────────────────────────────────────────────

# Install, generate secrets, migrate, then run API + SPA + extension together.
start-all: install env migrate
    #!/usr/bin/env bash
    set -euo pipefail
    set -m # job control: each background job becomes its own process group

    api_port=8787
    web_port=3000
    api_url="http://localhost:${api_port}"
    web_url="http://localhost:${web_port}"
    pids=()

    ensure_free_port() {
      if lsof -ti:"${1}" >/dev/null 2>&1; then
        echo "==> erro: a porta ${1} já está em uso por:"
        lsof -i:"${1}" | sed -n '2,4p'
        echo "    Encerre o processo acima (ex.: lsof -ti:${1} | xargs kill) e tente de novo."
        exit 1
      fi
    }

    cleanup() {
      trap - EXIT INT TERM
      echo ""
      echo "==> encerrando serviços…"
      local pid
      for pid in "${pids[@]:-}"; do
        [ -n "${pid}" ] || continue
        kill -TERM -- "-${pid}" 2>/dev/null || kill -TERM "${pid}" 2>/dev/null || true
      done
      sleep 0.3
      # A stopped process ignores SIGTERM until continued, so finish with SIGKILL.
      for pid in "${pids[@]:-}"; do
        [ -n "${pid}" ] || continue
        kill -KILL -- "-${pid}" 2>/dev/null || kill -KILL "${pid}" 2>/dev/null || true
      done
      wait 2>/dev/null || true
      echo "==> pronto."
    }
    trap cleanup EXIT INT TERM

    ensure_free_port "${api_port}"
    ensure_free_port "${web_port}"

    wait_for_api() {
      for _ in {1..120}; do
        if curl -fsS "${api_url}/api/health" >/dev/null 2>&1; then
          return 0
        fi
        sleep 0.5
      done
      echo "==> erro: a API não respondeu em ${api_url}/api/health após 60s." >&2
      local log
      log="$(ls -t "${HOME}"/.wrangler/logs/wrangler-*.log 2>/dev/null | head -1 || true)"
      if [ -n "${log}" ]; then
        echo "    Últimas linhas de ${log}:" >&2
        tail -n 8 "${log}" >&2 || true
      fi
      exit 1
    }

    echo "==> API        ${api_url}"
    # stdin from /dev/null: with job control ("set -m") a background job that reads
    # the terminal is stopped by SIGTTIN — which made `wrangler dev` hang forever.
    pnpm --filter "@bookmarks/server" dev </dev/null &
    pids+=("$!")

    echo "==> aguardando a API ficar pronta…"
    wait_for_api

    echo "==> SPA        ${web_url}"
    pnpm --filter "@bookmarks/web" dev </dev/null &
    pids+=("$!")

    echo "==> extensão   apps/extension/dist (watch) — carregue em chrome://extensions"
    pnpm --filter "@bookmarks/extension" exec rsbuild build --watch </dev/null &
    pids+=("$!")

    echo ""
    echo "==> tudo rodando. Ctrl+C para encerrar."
    echo ""
    wait

# ── Quality gates ──────────────────────────────────────────────────────────────

# Lint + typecheck + tests.
check:
    pnpm lint
    pnpm typecheck
    pnpm test

# Run Biome with autofix.
fmt:
    pnpm format

# Run the test suites.
test:
    pnpm test

# Typecheck every package.
typecheck:
    pnpm typecheck

# Lint every package.
lint:
    pnpm lint

# Build the SPA, the extension and the worker bundle.
build:
    pnpm build

# Deploy the worker (requires wrangler auth).
deploy:
    pnpm --filter {{server}} deploy

# Remove build artifacts and caches.
clean:
    rm -rf apps/*/dist packages/*/dist .turbo apps/*/.turbo packages/*/.turbo
