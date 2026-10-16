import type { BookmarkSort } from "@bookmarks/shared";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { BookmarkPlus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { BookmarkCard } from "../components/bookmark-card";
import { BookmarkFormDialog } from "../components/bookmark-form-dialog";
import { EmptyState } from "../components/empty-state";
import { ErrorState } from "../components/error-state";
import { PageHeader } from "../components/page-header";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { Skeleton } from "../components/ui/skeleton";
import { api } from "../lib/api";
import { queryKeys } from "../lib/query";
import { useDebouncedValue } from "../lib/use-debounced-value";
import { cn } from "../lib/utils";

const PAGE_SIZE = 30;

const SORT_OPTIONS: ReadonlyArray<{ value: BookmarkSort; label: string }> = [
  { value: "createdAt", label: "Mais recentes" },
  { value: "updatedAt", label: "Atualizados" },
  { value: "title", label: "Título (A–Z)" },
];

function BookmarkSkeleton() {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-4">
      <Skeleton className="size-5" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}

export function BookmarksPage() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [sort, setSort] = useState<BookmarkSort>("createdAt");
  const [addOpen, setAddOpen] = useState(false);

  const tagsQuery = useQuery({
    queryKey: queryKeys.tags,
    queryFn: () => api.tags.list(),
  });
  const tags = tagsQuery.data ?? [];
  const suggestions = useMemo(() => tags.map((tag) => tag.name), [tags]);

  const filters = useMemo(
    () => ({
      q: debouncedSearch.trim() || undefined,
      tag: selectedTags.length > 0 ? selectedTags : undefined,
      sort,
      limit: PAGE_SIZE,
    }),
    [debouncedSearch, selectedTags, sort],
  );

  const bookmarksQuery = useInfiniteQuery({
    queryKey: queryKeys.bookmarks(filters),
    queryFn: ({ pageParam }) => api.bookmarks.list({ ...filters, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const bookmarks = useMemo(
    () => bookmarksQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [bookmarksQuery.data],
  );

  const hasFilters = Boolean(filters.q) || selectedTags.length > 0;

  function toggleTag(name: string) {
    setSelectedTags((current) =>
      current.includes(name) ? current.filter((tag) => tag !== name) : [...current, name],
    );
  }

  return (
    <div>
      <PageHeader
        title="Favoritos"
        description={
          bookmarks.length > 0
            ? `${bookmarks.length} ${bookmarks.length === 1 ? "favorito" : "favoritos"}`
            : "Sua coleção de links salvos."
        }
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <BookmarkPlus aria-hidden="true" />
            Adicionar
          </Button>
        }
      />

      <div className="lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-8">
        <aside className="mb-4 lg:sticky lg:top-20 lg:mb-0 lg:self-start">
          <h2 className="mb-2 hidden text-xs font-medium uppercase tracking-wide text-muted-foreground lg:block">
            Tags
          </h2>
          <div className="flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0">
            <button
              type="button"
              aria-pressed={selectedTags.length === 0}
              onClick={() => setSelectedTags([])}
              className={cn(
                "inline-flex shrink-0 items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-sm",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                selectedTags.length === 0
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              Todas
            </button>
            {tags.map((tag) => {
              const active = selectedTags.includes(tag.name);
              return (
                <button
                  key={tag.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleTag(tag.name)}
                  className={cn(
                    "inline-flex shrink-0 items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-sm",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <span className="truncate">{tag.name}</span>
                  {typeof tag.bookmarkCount === "number" ? (
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {tag.bookmarkCount}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </aside>

        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative min-w-48 flex-1">
              <label htmlFor="bookmarks-search" className="sr-only">
                Buscar favoritos
              </label>
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="bookmarks-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por título, texto ou URL"
                className="pl-8"
              />
            </div>
            <div>
              <label htmlFor="bookmarks-sort" className="sr-only">
                Ordenar por
              </label>
              <Select
                id="bookmarks-sort"
                value={sort}
                onChange={(event) => setSort(event.target.value as BookmarkSort)}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {bookmarksQuery.isLoading ? (
            <div className="space-y-2" aria-busy="true" aria-live="polite">
              <span className="sr-only">Carregando favoritos…</span>
              {Array.from({ length: 5 }).map((_, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders
                <BookmarkSkeleton key={index} />
              ))}
            </div>
          ) : bookmarksQuery.isError ? (
            <ErrorState
              error={bookmarksQuery.error}
              onRetry={() => void bookmarksQuery.refetch()}
            />
          ) : bookmarks.length === 0 ? (
            <EmptyState
              icon={<BookmarkPlus aria-hidden="true" />}
              title={hasFilters ? "Nenhum resultado" : "Nenhum favorito ainda"}
              description={
                hasFilters
                  ? "Ajuste a busca ou remova os filtros de tag para ver mais resultados."
                  : "Salve seu primeiro link para começar a organizar sua coleção."
              }
              action={
                hasFilters ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearch("");
                      setSelectedTags([]);
                    }}
                  >
                    Limpar filtros
                  </Button>
                ) : (
                  <Button onClick={() => setAddOpen(true)}>
                    <BookmarkPlus aria-hidden="true" />
                    Adicionar favorito
                  </Button>
                )
              }
            />
          ) : (
            <div className="space-y-2">
              {bookmarks.map((bookmark) => (
                <BookmarkCard key={bookmark.id} bookmark={bookmark} suggestions={suggestions} />
              ))}

              {bookmarksQuery.hasNextPage ? (
                <div className="flex justify-center pt-2">
                  <Button
                    variant="outline"
                    onClick={() => void bookmarksQuery.fetchNextPage()}
                    disabled={bookmarksQuery.isFetchingNextPage}
                  >
                    {bookmarksQuery.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <BookmarkFormDialog open={addOpen} onOpenChange={setAddOpen} suggestions={suggestions} />
    </div>
  );
}
