import { type Bookmark, normalizeUrl } from "@bookmarks/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BookmarkCard } from "./bookmark-card";
import { ToastProvider } from "./ui/toast";

function makeBookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: "bookmark-1",
    url: "https://example.com/page",
    normalizedUrl: "example.com",
    title: "Example",
    description: null,
    notes: null,
    faviconUrl: null,
    source: "manual",
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderCard(bookmark: Bookmark) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <BookmarkCard bookmark={bookmark} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("BookmarkCard", () => {
  it("renders a normalized https href instead of the stored value", () => {
    renderCard(makeBookmark({ url: "example.com/page/" }));

    const link = screen.getByRole("link", { name: "Example" });
    expect(link).toHaveAttribute("href", normalizeUrl("example.com/page/"));
    expect(link).toHaveAttribute("href", "https://example.com/page");
  });

  it("renders no anchor when the stored URL is not a safe http(s) URL", () => {
    renderCard(makeBookmark({ url: "javascript:alert(1)" }));

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    // The card keeps working for everything that is not navigation.
    expect(screen.getByText("Example")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar Example" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Excluir Example" })).toBeInTheDocument();
  });
});
