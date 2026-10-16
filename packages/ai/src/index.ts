import type { AiProviderId } from "@bookmarks/shared";
import { AiProviderError } from "./errors.js";
import { createOpenAiCompatibleProvider } from "./openai-compatible.js";
import type { AiProvider, AiProviderConfig } from "./types.js";

export * from "./errors.js";
export * from "./openai-compatible.js";
export * from "./prompts.js";
export * from "./types.js";

/** Configuration accepted by {@link createProvider}. */
export interface CreateProviderConfig extends AiProviderConfig {
  provider: AiProviderId;
}

/**
 * Build the provider named by `config.provider`. The switch is exhaustive, so
 * adding an id to `AiProviderId` without a branch is a compile error.
 */
export function createProvider(config: CreateProviderConfig): AiProvider {
  switch (config.provider) {
    case "openai-compatible":
      return createOpenAiCompatibleProvider(config);
    default: {
      const unsupported: never = config.provider;
      throw new AiProviderError(`Unsupported AI provider: ${String(unsupported)}`);
    }
  }
}
