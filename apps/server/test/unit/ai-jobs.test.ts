import { describe, expect, it } from "vitest";
import { toProviderConfig } from "../../src/lib/ai-jobs.js";

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
