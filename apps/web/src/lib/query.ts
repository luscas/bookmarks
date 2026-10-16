import { QueryCache, QueryClient, queryOptions } from "@tanstack/react-query";
import { ApiError, type ListBookmarksParams, api } from "./api";

export const queryKeys = {
  me: ["me"] as const,
  bookmarks: (filters: ListBookmarksParams) => ["bookmarks", filters] as const,
  tags: ["tags"] as const,
  imports: ["imports"] as const,
  aiSettings: ["ai", "settings"] as const,
  aiJob: (id: string) => ["ai", "job", id] as const,
  apiKeys: ["api-keys"] as const,
};

/** Identity of the authenticated user plus their collection counts. */
export const meQueryOptions = queryOptions({
  queryKey: queryKeys.me,
  queryFn: () => api.me.get(),
  retry: false,
});

export interface CreateQueryClientOptions {
  /** Called whenever any request fails with a 401, used to bounce to /login. */
  onUnauthorized?: () => void;
}

function isClientError(error: unknown): boolean {
  return error instanceof ApiError && error.status >= 400 && error.status < 500;
}

export function createQueryClient(options: CreateQueryClientOptions = {}): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) => (isClientError(error) ? false : failureCount < 2),
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
    queryCache: new QueryCache({
      onError: (error) => {
        if (error instanceof ApiError && error.isUnauthorized) {
          options.onUnauthorized?.();
        }
      },
    }),
  });
}
