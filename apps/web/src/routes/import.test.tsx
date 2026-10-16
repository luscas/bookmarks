import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ui/toast";
import { type AiSettings, api } from "../lib/api";
import { ImportPage } from "./import";

const settings: AiSettings = {
  provider: "openai-compatible",
  model: "gpt-4o-mini",
  baseUrl: null,
  hasApiKey: true,
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ImportPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const checkbox = () => screen.getByRole("checkbox");

beforeEach(() => {
  vi.spyOn(api.imports, "list").mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ImportPage auto-tag checkbox default", () => {
  it("starts checked when the server reports autoTagByDefault (development)", async () => {
    vi.spyOn(api.ai, "getSettings").mockResolvedValue({ settings, autoTagByDefault: true });

    renderPage();

    await waitFor(() => expect(checkbox()).toBeChecked());
  });

  it("stays unchecked when autoTagByDefault is false even if AI settings exist (production)", async () => {
    // The old default checked the box whenever settings existed; production must
    // not send `autoTag: true`, so it follows `autoTagByDefault` instead.
    vi.spyOn(api.ai, "getSettings").mockResolvedValue({ settings, autoTagByDefault: false });

    renderPage();

    // Wait for both queries to settle so the default-applying effect has run.
    await waitFor(() => expect(api.ai.getSettings).toHaveBeenCalledTimes(1));
    await screen.findByText("Nenhuma importação ainda");
    expect(checkbox()).not.toBeChecked();
  });
});
