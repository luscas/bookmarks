import { MAX_TAG_NAME_LENGTH } from "@bookmarks/shared";
import { describe, expect, it } from "vitest";
import { capAiTagNames, toProviderConfig } from "../../src/lib/ai-jobs.js";

const base = {
  provider: "openai-compatible",
  model: "qwen3.5:4b",
  baseUrl: null,
  reasoningEffort: null,
} as const;

describe("toProviderConfig", () => {
  it("carries a configured reasoningEffort into the provider config", () => {
    const config = toProviderConfig({ ...base, reasoningEffort: "none" }, "k");

    expect(config.reasoningEffort).toBe("none");
  });

  it("omits reasoningEffort when the settings row has none", () => {
    const config = toProviderConfig(base, "k");

    expect("reasoningEffort" in config).toBe(false);
  });

  it("omits baseUrl when the settings row has none", () => {
    const config = toProviderConfig(base, "k");

    expect("baseUrl" in config).toBe(false);
  });
});

describe("capAiTagNames", () => {
  it("keeps names within the manual-path cap", () => {
    expect(capAiTagNames(["react", "web-dev"])).toEqual(["react", "web-dev"]);
  });

  it("silently drops over-long provider suggestions", () => {
    const names = ["ok", "x".repeat(MAX_TAG_NAME_LENGTH + 1)];

    expect(capAiTagNames(names)).toEqual(["ok"]);
  });

  it("accepts a name exactly at the cap", () => {
    expect(capAiTagNames(["y".repeat(MAX_TAG_NAME_LENGTH)])).toEqual(["y".repeat(100)]);
  });

  it("drops empty names", () => {
    expect(capAiTagNames(["", "real"])).toEqual(["real"]);
  });
});
