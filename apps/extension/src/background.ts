import { ApiError, NotConfiguredError, saveBookmark } from "./lib/api";
import { isConfigured, readSettings } from "./lib/settings";

const MENU_ID = "save-bookmark";
const BADGE_COLOR = "#dc2626";
const SUCCESS_COLOR = "#16a34a";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create(
    { id: MENU_ID, title: "Salvar nos bookmarks", contexts: ["page", "link"] },
    () => {
      // Reading `lastError` marks it as handled when the item already exists.
      void chrome.runtime.lastError;
    },
  );
  void syncBadge();
});

/** Show a persistent red `!` badge while the extension has no settings. */
async function syncBadge(): Promise<void> {
  const settings = await readSettings();
  if (isConfigured(settings)) {
    await chrome.action.setBadgeText({ text: "" });
    return;
  }
  await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  await chrome.action.setBadgeText({ text: "!" });
}

function flashBadge(text: string, color: string): void {
  void chrome.action
    .setBadgeBackgroundColor({ color })
    .then(() => chrome.action.setBadgeText({ text }));
  setTimeout(() => {
    void chrome.action.setBadgeText({ text: "" });
  }, 2500);
}

async function handleContextMenu(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined,
): Promise<void> {
  if (info.menuItemId !== MENU_ID) {
    return;
  }
  const url = info.linkUrl ?? info.pageUrl ?? tab?.url ?? "";
  if (url.length === 0) {
    return;
  }
  const title = info.linkUrl
    ? info.selectionText && info.selectionText.length > 0
      ? info.selectionText
      : url
    : (tab?.title ?? url);

  try {
    await saveBookmark({ url, title });
    flashBadge("✓", SUCCESS_COLOR);
  } catch (error) {
    if (error instanceof NotConfiguredError) {
      await syncBadge();
      return;
    }
    if (error instanceof ApiError && error.isUnauthorized) {
      flashBadge("!", BADGE_COLOR);
      return;
    }
    flashBadge("!", BADGE_COLOR);
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void handleContextMenu(info, tab);
});

// With `default_popup` set Chrome opens the popup itself. This listener is a
// defensive fallback for environments where the popup is not shown.
chrome.action.onClicked.addListener(() => {
  void openPopup();
});

async function openPopup(): Promise<void> {
  try {
    await chrome.action.openPopup();
  } catch {
    // No user gesture, or the popup is already open — nothing to do.
  }
}

// Clear the "unconfigured" badge as soon as the user saves settings.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }
  if ("serverUrl" in changes || "apiKey" in changes) {
    void syncBadge();
  }
});

chrome.runtime.onStartup?.addListener(() => {
  void syncBadge();
});
