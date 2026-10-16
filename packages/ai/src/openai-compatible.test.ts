import { MAX_AI_RESPONSE_BYTES } from "@bookmarks/shared";
import { describe, expect, it } from "vitest";
import { AiProviderError } from "./errors.js";
import { createProvider } from "./index.js";
import { createOpenAiCompatibleProvider, extractJsonContent } from "./openai-compatible.js";
import type { BookmarkForAi } from "./types.js";

interface RecordedBody {
  model: string;
  messages: Array<{ role: string; content: string }>;
  response_format: {
    type: string;
    json_schema: { name: string; strict: boolean; schema: unknown };
  };
}

interface RecordedCall {
  url: string;
  method: string;
  headers: Headers;
  body: RecordedBody;
}

type Responder = (call: RecordedCall, index: number) => Response;

function createFakeFetch(responder: Responder): {
  fetchImpl: typeof fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = JSON.parse(String(init?.body ?? "{}")) as RecordedBody;
    const call: RecordedCall = {
      url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body,
    };
    const index = calls.length;
    calls.push(call);
    return responder(call, index);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function completionResponse(content: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function firstCall(calls: RecordedCall[]): RecordedCall {
  const call = calls[0];
  if (!call) {
    throw new Error("expected at least one fetch call");
  }
  return call;
}

function userPayload(call: RecordedCall): {
  existingTags: string[];
  bookmarks: Array<{ id: string }>;
} {
  const message = call.body.messages[1];
  if (!message) {
    throw new Error("expected a user message");
  }
  return JSON.parse(message.content);
}

const ONE_BOOKMARK: BookmarkForAi[] = [{ id: "b1", url: "https://example.com" }];

describe("createOpenAiCompatibleProvider request", () => {
  it("POSTs to <baseUrl>/chat/completions with auth, model and json_schema format", async () => {
    const { fetchImpl, calls } = createFakeFetch(() =>
      completionResponse(JSON.stringify({ suggestions: [] })),
    );
    const provider = createOpenAiCompatibleProvider({
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      baseUrl: "https://api.example.com/v1/",
      fetchImpl,
    });

    await provider.suggestTags(
      [{ id: "b1", url: "https://example.com", title: "Example" }],
      ["dev"],
    );

    expect(calls).toHaveLength(1);
    const call = firstCall(calls);
    expect(call.url).toBe("https://api.example.com/v1/chat/completions");
    expect(call.method).toBe("POST");
    expect(call.headers.get("authorization")).toBe("Bearer sk-test");
    expect(call.headers.get("content-type")).toBe("application/json");
    expect(call.body.model).toBe("gpt-4o-mini");
    expect(call.body.response_format).toMatchObject({
      type: "json_schema",
      json_schema: { name: "tag_suggestions", strict: true },
    });
    expect(call.body.messages[0]?.role).toBe("system");
    expect(call.body.messages[1]?.role).toBe("user");
  });

  it("defaults to the OpenAI base URL", async () => {
    const { fetchImpl, calls } = createFakeFetch(() =>
      completionResponse(JSON.stringify({ suggestions: [] })),
    );
    const provider = createOpenAiCompatibleProvider({
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      fetchImpl,
    });

    await provider.suggestTags(ONE_BOOKMARK, []);

    expect(firstCall(calls).url).toBe("https://api.openai.com/v1/chat/completions");
  });
});

describe("createOpenAiCompatibleProvider parsing", () => {
  it("parses a well-formed JSON response into TagSuggestion[]", async () => {
    const content = JSON.stringify({
      suggestions: [
        { bookmarkId: "b1", tags: ["dev/react", "web"], confidence: 0.9, suggestedTitle: null },
      ],
    });
    const { fetchImpl } = createFakeFetch(() => completionResponse(content));
    const provider = createOpenAiCompatibleProvider({ apiKey: "k", model: "m", fetchImpl });

    const result = await provider.suggestTags(ONE_BOOKMARK, []);

    expect(result).toEqual([{ bookmarkId: "b1", tags: ["dev/react", "web"], confidence: 0.9 }]);
  });

  it("extracts JSON wrapped in a ```json code fence", async () => {
    const fenced = `\`\`\`json\n${JSON.stringify({
      suggestions: [{ bookmarkId: "b1", tags: ["a"] }],
    })}\n\`\`\``;
    const { fetchImpl } = createFakeFetch(() => completionResponse(fenced));
    const provider = createOpenAiCompatibleProvider({ apiKey: "k", model: "m", fetchImpl });

    const result = await provider.suggestTags(ONE_BOOKMARK, []);

    expect(result).toEqual([{ bookmarkId: "b1", tags: ["a"] }]);
  });

  it("extracts JSON from a fenced payload with surrounding prose", () => {
    const wrapped = 'Here you go:\n```json\n{"suggestions":[]}\n```\nEnjoy!';
    expect(extractJsonContent(wrapped)).toBe('{"suggestions":[]}');
  });

  it("throws when a 2xx response has no content", async () => {
    const empty = new Response(JSON.stringify({ choices: [{ message: { role: "assistant" } }] }), {
      status: 200,
    });
    const { fetchImpl } = createFakeFetch(() => empty);
    const provider = createOpenAiCompatibleProvider({ apiKey: "k", model: "m", fetchImpl });

    await expect(provider.suggestTags(ONE_BOOKMARK, [])).rejects.toBeInstanceOf(AiProviderError);
  });

  it("maps a taxonomy response correctly", async () => {
    const content = JSON.stringify({
      tags: [{ name: "dev", description: "Development" }, { name: "web" }],
      assignments: [{ bookmarkId: "b1", tags: ["dev"] }],
    });
    const { fetchImpl, calls } = createFakeFetch(() => completionResponse(content));
    const provider = createOpenAiCompatibleProvider({ apiKey: "k", model: "m", fetchImpl });

    const result = await provider.proposeTaxonomy(ONE_BOOKMARK, []);

    expect(result).toEqual({
      tags: [{ name: "dev", description: "Development" }, { name: "web" }],
      assignments: [{ bookmarkId: "b1", tags: ["dev"] }],
    });
    expect(firstCall(calls).body.response_format.json_schema.name).toBe("taxonomy_proposal");
  });
});

describe("createOpenAiCompatibleProvider batching", () => {
  it("splits 45 bookmarks into 3 calls (20/20/5) and concatenates results", async () => {
    const { fetchImpl, calls } = createFakeFetch((call) =>
      completionResponse(
        JSON.stringify({
          suggestions: userPayload(call).bookmarks.map((bookmark) => ({
            bookmarkId: bookmark.id,
            tags: ["x"],
          })),
        }),
      ),
    );
    const provider = createOpenAiCompatibleProvider({ apiKey: "k", model: "m", fetchImpl });
    const bookmarks: BookmarkForAi[] = Array.from({ length: 45 }, (_, index) => ({
      id: `b${index}`,
      url: `https://example.com/${index}`,
    }));

    const result = await provider.suggestTags(bookmarks, []);

    expect(calls).toHaveLength(3);
    expect(calls.map((call) => userPayload(call).bookmarks.length)).toEqual([20, 20, 5]);
    expect(result).toHaveLength(45);
    expect(result[44]?.bookmarkId).toBe("b44");
  });
});

describe("createOpenAiCompatibleProvider retries", () => {
  it("retries once on 429 and then succeeds", async () => {
    const { fetchImpl, calls } = createFakeFetch((_call, index) =>
      index === 0
        ? new Response("rate limited", { status: 429 })
        : completionResponse(JSON.stringify({ suggestions: [{ bookmarkId: "b1", tags: ["x"] }] })),
    );
    const provider = createOpenAiCompatibleProvider({ apiKey: "k", model: "m", fetchImpl });

    const result = await provider.suggestTags(ONE_BOOKMARK, []);

    expect(calls).toHaveLength(2);
    expect(result).toEqual([{ bookmarkId: "b1", tags: ["x"] }]);
  });

  it("throws AiProviderError with status after a persistent 500", async () => {
    const { fetchImpl, calls } = createFakeFetch(() => new Response("boom", { status: 500 }));
    const provider = createOpenAiCompatibleProvider({ apiKey: "k", model: "m", fetchImpl });

    await expect(provider.suggestTags(ONE_BOOKMARK, [])).rejects.toMatchObject({
      name: "AiProviderError",
      status: 500,
    });
    // Original attempt plus MAX_RETRIES (2) retries.
    expect(calls).toHaveLength(3);
  });

  it("does not retry non-retryable client errors", async () => {
    const { fetchImpl, calls } = createFakeFetch(
      () => new Response("bad response_format", { status: 400 }),
    );
    const provider = createOpenAiCompatibleProvider({ apiKey: "k", model: "m", fetchImpl });

    await expect(provider.suggestTags(ONE_BOOKMARK, [])).rejects.toMatchObject({ status: 400 });
    expect(calls).toHaveLength(1);
  });
});

describe("createProvider", () => {
  it("builds an openai-compatible provider", async () => {
    const { fetchImpl, calls } = createFakeFetch(() =>
      completionResponse(JSON.stringify({ suggestions: [] })),
    );
    const provider = createProvider({
      provider: "openai-compatible",
      apiKey: "k",
      model: "m",
      fetchImpl,
    });

    await provider.suggestTags(ONE_BOOKMARK, []);

    expect(calls).toHaveLength(1);
  });
});

describe("createOpenAiCompatibleProvider response cap", () => {
  it("rejects a body larger than the cap instead of buffering it", async () => {
    const huge = "x".repeat(MAX_AI_RESPONSE_BYTES + 1024);
    const { fetchImpl } = createFakeFetch(
      () => new Response(huge, { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const provider = createOpenAiCompatibleProvider({ apiKey: "k", model: "m", fetchImpl });

    await expect(provider.suggestTags(ONE_BOOKMARK, [])).rejects.toMatchObject({
      name: "AiProviderError",
    });
  });

  it("rejects an oversized stub body when the response has no stream", async () => {
    const huge = "x".repeat(MAX_AI_RESPONSE_BYTES + 1024);
    const stub = {
      ok: true,
      status: 200,
      headers: new Headers(),
      body: null,
      text: async () => huge,
    } as unknown as Response;
    const { fetchImpl } = createFakeFetch(() => stub);
    const provider = createOpenAiCompatibleProvider({ apiKey: "k", model: "m", fetchImpl });

    await expect(provider.suggestTags(ONE_BOOKMARK, [])).rejects.toMatchObject({
      name: "AiProviderError",
    });
  });
});
