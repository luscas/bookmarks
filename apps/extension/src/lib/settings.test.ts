import { describe, expect, it, type vi } from "vitest";
import {
  isConfigured,
  originPattern,
  parseSettings,
  readSettings,
  requestHostPermission,
  settingsIssues,
  writeSettings,
} from "./settings";

describe("parseSettings", () => {
  it("defaults to empty strings when nothing is stored", () => {
    expect(parseSettings(undefined)).toEqual({ serverUrl: "", apiKey: "" });
    expect(parseSettings({})).toEqual({ serverUrl: "", apiKey: "" });
  });

  it("trims stored values", () => {
    expect(parseSettings({ serverUrl: " https://x.test ", apiKey: " k " })).toEqual({
      serverUrl: "https://x.test",
      apiKey: "k",
    });
  });

  it("ignores unknown stored keys", () => {
    expect(parseSettings({ serverUrl: "https://x.test", apiKey: "k", other: 1 })).toEqual({
      serverUrl: "https://x.test",
      apiKey: "k",
    });
  });
});

describe("isConfigured", () => {
  it("requires both fields", () => {
    expect(isConfigured({ serverUrl: "https://x.test", apiKey: "k" })).toBe(true);
    expect(isConfigured({ serverUrl: "https://x.test", apiKey: "" })).toBe(false);
    expect(isConfigured({ serverUrl: "", apiKey: "k" })).toBe(false);
  });
});

describe("settingsIssues", () => {
  it("reports an invalid URL and a missing key", () => {
    expect(settingsIssues({ serverUrl: "não é url", apiKey: "" }).length).toBeGreaterThan(0);
  });

  it("accepts a valid configuration", () => {
    expect(settingsIssues({ serverUrl: "https://x.test", apiKey: "k" })).toEqual([]);
  });
});

describe("originPattern", () => {
  it("returns the host match pattern regardless of the path", () => {
    expect(originPattern("https://x.test/some/path")).toBe("https://x.test/*");
  });

  it("drops the port, which Chrome match patterns do not support", () => {
    expect(originPattern("http://localhost:8787")).toBe("http://localhost/*");
  });

  it("rejects non-http schemes and garbage", () => {
    expect(originPattern("ftp://x.test")).toBeNull();
    expect(originPattern("nope")).toBeNull();
  });
});

describe("storage round-trip", () => {
  it("writes and reads the settings", async () => {
    await writeSettings({ serverUrl: "https://x.test", apiKey: "secret" });
    await expect(readSettings()).resolves.toEqual({
      serverUrl: "https://x.test",
      apiKey: "secret",
    });
  });
});

describe("requestHostPermission", () => {
  it("asks Chrome for the origin when it is not granted yet", async () => {
    const request = chrome.permissions.request as unknown as ReturnType<typeof vi.fn>;
    request.mockResolvedValueOnce(true);

    await expect(requestHostPermission("https://x.test")).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith({ origins: ["https://x.test/*"] });
  });

  it("does not ask again when the permission already exists", async () => {
    const contains = chrome.permissions.contains as unknown as ReturnType<typeof vi.fn>;
    const request = chrome.permissions.request as unknown as ReturnType<typeof vi.fn>;
    contains.mockResolvedValueOnce(true);

    await expect(requestHostPermission("https://x.test")).resolves.toBe(true);
    expect(request).not.toHaveBeenCalled();
  });

  it("returns false for an invalid URL without touching Chrome", async () => {
    const request = chrome.permissions.request as unknown as ReturnType<typeof vi.fn>;
    await expect(requestHostPermission("não é url")).resolves.toBe(false);
    expect(request).not.toHaveBeenCalled();
  });
});
