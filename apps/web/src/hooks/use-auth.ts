import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SessionUser } from "../lib/api";
import { api } from "../lib/api";
import { meQueryOptions, queryKeys } from "../lib/query";

export interface AuthState {
  user: SessionUser | null;
  counts: { bookmarks: number; tags: number } | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

/** Current session, sourced from the authenticated `/api/me` endpoint. */
export function useAuth(): AuthState {
  const query = useQuery(meQueryOptions);
  return {
    user: query.data?.user ?? null,
    counts: query.data?.counts ?? null,
    isLoading: query.isLoading,
    isAuthenticated: Boolean(query.data),
  };
}

/** Sign out of Better Auth and clear all cached user data. */
export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.auth.signOut(),
    onSettled: () => {
      queryClient.clear();
    },
  });
}

export { queryKeys };
