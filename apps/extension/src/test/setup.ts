import { beforeEach, vi } from "vitest";

/**
 * Minimal `chrome` mock. It only implements the surface the extension modules
 * touch in tests: storage round-trips, permissions and the bookmarks tree.
 */
function createChromeMock() {
  const store = new Map<string, unknown>();

  const get = vi.fn(async (keys: string | string[] | null) => {
    const list = keys === null ? [...store.keys()] : Array.isArray(keys) ? keys : [keys];
    const out: Record<string, unknown> = {};
    for (const key of list) {
      if (store.has(key)) {
        out[key] = store.get(key);
      }
    }
    return out;
  });

  const set = vi.fn(async (items: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(items)) {
      store.set(key, value);
    }
  });

  return {
    runtime: {
      lastError: undefined,
      openOptionsPage: vi.fn(async () => undefined),
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
    },
    storage: {
      local: { get, set },
      onChanged: { addListener: vi.fn() },
    },
    permissions: {
      contains: vi.fn(async () => false),
      request: vi.fn(async () => true),
    },
    tabs: {
      query: vi.fn(async () => []),
    },
    bookmarks: {
      getTree: vi.fn(async () => []),
    },
    action: {
      setBadgeText: vi.fn(async () => undefined),
      setBadgeBackgroundColor: vi.fn(async () => undefined),
      onClicked: { addListener: vi.fn() },
      openPopup: vi.fn(async () => undefined),
    },
    contextMenus: {
      create: vi.fn(),
      onClicked: { addListener: vi.fn() },
    },
  };
}

beforeEach(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = createChromeMock();
});
