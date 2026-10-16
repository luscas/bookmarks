import { BULK_IMPORT_CHUNK_SIZE, type BulkBookmarkItem } from "@bookmarks/shared";
import { ApiError, NotConfiguredError, bulkImport, createApiClient } from "../lib/api";
import { bookmarkTreeToItems } from "../lib/browser-bookmarks";
import {
  type Settings,
  isConfigured,
  readSettings,
  requestHostPermission,
  settingsIssues,
  writeSettings,
} from "../lib/settings";
import "./options.css";

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`Elemento #${id} não encontrado.`);
  }
  return node as T;
}

type StatusKind = "success" | "error" | "info";

function setStatus(node: HTMLElement, message: string, kind: StatusKind): void {
  node.hidden = false;
  node.dataset.kind = kind;
  node.textContent = message;
}

function describeError(error: unknown): string {
  if (error instanceof ApiError || error instanceof NotConfiguredError) {
    return error.message;
  }
  return "Ocorreu um erro inesperado.";
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

async function init(): Promise<void> {
  const form = element<HTMLFormElement>("settings-form");
  const serverUrlInput = element<HTMLInputElement>("server-url");
  const apiKeyInput = element<HTMLInputElement>("api-key");
  const saveButton = element<HTMLButtonElement>("save");
  const testButton = element<HTMLButtonElement>("test");
  const settingsStatus = element("settings-status");
  const importButton = element<HTMLButtonElement>("import");
  const importStatus = element("import-status");

  const stored = await readSettings();
  serverUrlInput.value = stored.serverUrl;
  apiKeyInput.value = stored.apiKey;

  function readForm(): Settings {
    return { serverUrl: serverUrlInput.value.trim(), apiKey: apiKeyInput.value.trim() };
  }

  async function save(): Promise<void> {
    const input = readForm();
    const issues = settingsIssues(input);
    if (issues.length > 0) {
      setStatus(settingsStatus, issues.join(" "), "error");
      return;
    }
    const granted = await requestHostPermission(input.serverUrl);
    if (!granted) {
      setStatus(settingsStatus, "Permissão de acesso ao servidor não concedida.", "error");
      return;
    }
    saveButton.disabled = true;
    try {
      await writeSettings(input);
      setStatus(settingsStatus, "Configurações salvas.", "success");
    } catch (error) {
      setStatus(settingsStatus, describeError(error), "error");
    } finally {
      saveButton.disabled = false;
    }
  }

  async function testConnection(): Promise<void> {
    const input = readForm();
    const issues = settingsIssues(input);
    if (issues.length > 0) {
      setStatus(settingsStatus, issues.join(" "), "error");
      return;
    }
    const granted = await requestHostPermission(input.serverUrl);
    if (!granted) {
      setStatus(settingsStatus, "Permissão de acesso ao servidor não concedida.", "error");
      return;
    }
    setStatus(settingsStatus, "Testando…", "info");
    testButton.disabled = true;
    try {
      const me = await createApiClient(input).getMe();
      setStatus(
        settingsStatus,
        `Conectado como ${me.user.name} (${me.user.email}) — ${me.counts.bookmarks} favorito(s).`,
        "success",
      );
    } catch (error) {
      setStatus(settingsStatus, describeError(error), "error");
    } finally {
      testButton.disabled = false;
    }
  }

  async function runImport(): Promise<void> {
    const settings = await readSettings();
    if (!isConfigured(settings)) {
      setStatus(importStatus, "Salve a conexão antes de importar.", "error");
      return;
    }
    const granted = await requestHostPermission(settings.serverUrl);
    if (!granted) {
      setStatus(importStatus, "Permissão de acesso ao servidor não concedida.", "error");
      return;
    }

    const tree = await chrome.bookmarks.getTree();
    const items = bookmarkTreeToItems(tree);
    if (items.length === 0) {
      setStatus(importStatus, "Nenhum favorito encontrado neste navegador.", "info");
      return;
    }

    importButton.disabled = true;
    let imported = 0;
    let skipped = 0;
    try {
      const batches = chunk(items, BULK_IMPORT_CHUNK_SIZE);
      for (let index = 0; index < batches.length; index += 1) {
        const batch = batches[index];
        if (!batch) {
          continue;
        }
        setStatus(importStatus, `Enviando ${index + 1}/${batches.length}…`, "info");
        const payload: BulkBookmarkItem[] = batch.map((item) => ({
          url: item.url,
          ...(item.title.length > 0 ? { title: item.title } : {}),
          folderPath: item.folderPath,
        }));
        const result = await bulkImport(payload);
        imported += result.imported;
        skipped += result.skipped;
      }
      setStatus(importStatus, `Importados: ${imported}. Ignorados: ${skipped}.`, "success");
    } catch (error) {
      setStatus(importStatus, describeError(error), "error");
    } finally {
      importButton.disabled = false;
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void save();
  });
  testButton.addEventListener("click", () => {
    void testConnection();
  });
  importButton.addEventListener("click", () => {
    void runImport();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    void init();
  });
} else {
  void init();
}
