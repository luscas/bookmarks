import { ApiError, NotConfiguredError, saveBookmark } from "../lib/api";
import { isConfigured, readSettings } from "../lib/settings";
import "./popup.css";

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`Elemento #${id} não encontrado.`);
  }
  return node as T;
}

function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

function describeError(error: unknown): string {
  if (error instanceof ApiError || error instanceof NotConfiguredError) {
    return error.message;
  }
  return "Não foi possível salvar o favorito.";
}

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

async function init(): Promise<void> {
  const page = element("page");
  const loading = element("loading");
  const form = element<HTMLFormElement>("form");
  const titleInput = element<HTMLInputElement>("title");
  const tagsInput = element<HTMLInputElement>("tags");
  const submit = element<HTMLButtonElement>("submit");
  const favicon = element<HTMLImageElement>("favicon");
  const pageTitle = element("page-title");
  const pageUrl = element("page-url");
  const notice = element("notice");
  const status = element("status");
  const openOptions = element<HTMLButtonElement>("open-options");

  openOptions.addEventListener("click", () => {
    void chrome.runtime.openOptionsPage();
  });

  const settings = await readSettings();
  const configured = isConfigured(settings);
  if (!configured) {
    notice.hidden = false;
    notice.textContent = "Configure o servidor e a chave de API para começar.";
    openOptions.hidden = false;
  }

  const tab = await activeTab();
  loading.hidden = true;

  const url = tab?.url ?? "";
  const title = tab?.title ?? "";

  if (url.length > 0) {
    page.hidden = false;
    pageUrl.textContent = url;
    pageTitle.textContent = title.length > 0 ? title : url;
    if (tab?.favIconUrl) {
      favicon.src = tab.favIconUrl;
      favicon.addEventListener("error", () => {
        favicon.hidden = true;
      });
    } else {
      favicon.hidden = true;
    }
  } else {
    notice.hidden = false;
    notice.textContent = "Esta página não pode ser salva.";
  }

  if (!configured || url.length === 0) {
    return;
  }

  titleInput.value = title;
  form.hidden = false;
  titleInput.focus();

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitBookmark();
  });

  async function submitBookmark(): Promise<void> {
    status.hidden = true;
    submit.disabled = true;
    submit.textContent = "Salvando…";
    try {
      const value = titleInput.value.trim();
      const result = await saveBookmark({
        url,
        ...(value.length > 0 ? { title: value } : {}),
        tags: parseTags(tagsInput.value),
      });
      status.hidden = false;
      status.dataset.kind = "success";
      status.textContent = result.created ? "Favorito salvo!" : "Este favorito já estava salvo.";
      if (result.created) {
        tagsInput.value = "";
      }
    } catch (error) {
      status.hidden = false;
      status.dataset.kind = "error";
      status.textContent = describeError(error);
      if (error instanceof NotConfiguredError) {
        openOptions.hidden = false;
      }
    } finally {
      submit.disabled = false;
      submit.textContent = "Salvar";
    }
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    void init();
  });
} else {
  void init();
}
