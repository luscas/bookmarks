# @bookmarks/extension

Extensão MV3 do Chromium (Chrome, Edge, Brave) para salvar a página atual — com
tags — e importar os favoritos do navegador para um servidor de favoritos
auto-hospedado.

A interface é escrita em **TypeScript puro (vanilla)**, sem framework: o popup e
a página de opções são pequenos o suficiente para não justificarem o peso do
React no bundle. O service worker de background também é TypeScript.

## Desenvolvimento

A partir da raiz do monorepo:

```bash
pnpm install
pnpm --filter @bookmarks/extension build     # gera apps/extension/dist
pnpm --filter @bookmarks/extension typecheck
pnpm --filter @bookmarks/extension test
```

Para desenvolver com rebuild automático:

```bash
pnpm --filter @bookmarks/extension dev
```

> O modo `dev` roda o servidor do Rsbuild, útil para recarregar as páginas de
> popup/opções. Para testar de fato como extensão, use `build` e carregue a
> pasta `dist` (veja abaixo).

## Carregar como extensão descompactada

1. Rode `pnpm --filter @bookmarks/extension build`.
2. Abra `chrome://extensions`.
3. Ative o **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactação** / **Load unpacked** e selecione
   `apps/extension/dist`.
5. A extensão aparece na barra de ferramentas. Clique no ícone para abrir o
   popup.

Sempre que rodar `build` novamente, clique em **Atualizar** (⟳) no cartão da
extensão em `chrome://extensions`.

## Criar uma chave de API

A extensão nunca usa cookies: ela autentica com uma chave de API enviada como
`Authorization: Bearer <chave>`.

1. Abra o aplicativo web no seu servidor e faça login.
2. Vá em **Configurações → Chaves de API** (`/settings/api-keys`).
3. Crie uma chave (ex.: "Extensão do navegador") e **copie-a na hora** — ela não
   é exibida novamente.
4. Abra as opções da extensão (clique com o botão direito no ícone → **Opções**,
   ou o botão **Abrir configurações** no popup) e cole a chave ali.

## Conceder permissão de acesso ao servidor

A extensão **não** declara nenhum host fixo. O acesso ao seu servidor é uma
permissão opcional (`optional_host_permissions`), concedida em tempo de
execução:

1. Na página de opções, informe a **URL do servidor**
   (ex.: `https://favoritos.exemplo.com`).
2. Clique em **Testar conexão** ou **Salvar**. O Chrome exibe um diálogo
   pedindo acesso ao domínio; confirme.
3. Se a URL mudar no futuro, salve novamente para conceder a permissão do novo
   domínio.

Se a permissão for negada, o Chrome ainda assim mantém a extensão instalada, mas
as chamadas à API falharão; o popup mostra o erro e o serviço de background
exibe um selo `!`.

## Importar os favoritos do navegador

Na página de opções, clique em **Importar favoritos deste navegador**. A
extensão lê `chrome.bookmarks.getTree()`, converte cada favorito em um item com
o caminho de pastas e envia em lotes (via `POST /api/bookmarks/bulk`):

- cada pasta vira uma **tag hierárquica** (`Dev/React`), do mesmo modo que o
  servidor faz com `folderPathToTagName`;
- pastas-raiz ("Barra de favoritos", "Outros favoritos", …) são descartadas;
- itens já existentes (mesma URL normalizada) são ignorados e contados em
  `Ignorados`.

O tamanho de cada lote usa `BULK_IMPORT_CHUNK_SIZE` de `@bookmarks/shared`, para
nunca divergir dos limites do servidor.

## Estrutura

```
src/
  manifest.json            # MV3; copiado para dist/manifest.json no build
  background.ts            # menu de contexto + selo de "não configurado"
  lib/
    api.ts                 # cliente HTTP tipado (Bearer, /api/...)
    settings.ts            # leitura/escrita/validação + permissão de host
    browser-bookmarks.ts   # chrome.bookmarks.getTree() → itens com tags
  popup/                   # popup (salvar página atual)
  options/                 # opções (conexão + importação)
  test/setup.ts            # mock mínimo de `chrome` para o Vitest
```

O `manifest.json` fica em `src/` e é emitido na raiz do `dist` por uma cópia do
Rsbuild. Os nomes de arquivo não recebem hash porque o manifesto referencia
`background.js` por um caminho fixo.

## Privacidade

- A chave de API é guardada apenas em `chrome.storage.local` e enviada no
  cabeçalho `Authorization`. Ela nunca é registrada em log nem incluída em
  mensagens de erro.
- Nenhum servidor padrão é embutido; o usuário aponta a extensão para a própria
  instância e concede o host correspondente.
