import type { QueryClient } from "@tanstack/react-query";
import {
  Link,
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { AppShell } from "./components/app-shell";
import { buttonVariants } from "./components/ui/button";
import { ApiError } from "./lib/api";
import { meQueryOptions } from "./lib/query";
import { BookmarksPage } from "./routes/bookmarks";
import { ImportPage } from "./routes/import";
import { LoginPage } from "./routes/login";
import { AiSettingsPage } from "./routes/settings-ai";
import { ApiKeysPage } from "./routes/settings-api-keys";
import { TagsPage } from "./routes/tags";

export interface RouterContext {
  queryClient: QueryClient;
}

function NotFoundPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-sm font-medium text-muted-foreground">Erro 404</p>
      <h1 className="text-xl font-semibold tracking-tight">Página não encontrada</h1>
      <Link to="/" className={buttonVariants()}>
        Voltar aos favoritos
      </Link>
    </div>
  );
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: NotFoundPage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  beforeLoad: async ({ context }) => {
    try {
      await context.queryClient.ensureQueryData(meQueryOptions);
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) {
        throw redirect({ to: "/login" });
      }
      throw error;
    }
  },
  component: AppShell,
});

const bookmarksRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  component: BookmarksPage,
});

const importRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/import",
  component: ImportPage,
});

const tagsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/tags",
  component: TagsPage,
});

const aiSettingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings/ai",
  component: AiSettingsPage,
});

const apiKeysRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings/api-keys",
  component: ApiKeysPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([bookmarksRoute, importRoute, tagsRoute, aiSettingsRoute, apiKeysRoute]),
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
