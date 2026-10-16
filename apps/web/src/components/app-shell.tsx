import { Link, Outlet, useMatchRoute, useNavigate } from "@tanstack/react-router";
import {
  Bookmark as BookmarkIcon,
  KeyRound,
  LogOut,
  Monitor,
  Moon,
  Sparkles,
  Sun,
  Tags,
  Upload,
} from "lucide-react";
import { useState } from "react";
import { useAuth, useSignOut } from "../hooks/use-auth";
import { cn } from "../lib/utils";
import { type Theme, useTheme } from "../providers/theme";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

type AppPath = "/" | "/import" | "/tags" | "/settings/ai" | "/settings/api-keys";

interface NavItem {
  to: AppPath;
  label: string;
  icon: typeof BookmarkIcon;
  exact?: boolean;
}

const PRIMARY_NAV: readonly NavItem[] = [
  { to: "/", label: "Favoritos", icon: BookmarkIcon, exact: true },
  { to: "/import", label: "Importar", icon: Upload },
  { to: "/tags", label: "Tags", icon: Tags },
];

const SETTINGS_NAV: readonly NavItem[] = [
  { to: "/settings/ai", label: "IA", icon: Sparkles },
  { to: "/settings/api-keys", label: "Chaves de API", icon: KeyRound },
];

function NavLink({ to, label, icon: Icon, exact }: NavItem) {
  const matchRoute = useMatchRoute();
  const isActive = Boolean(matchRoute({ to, fuzzy: !exact }));
  return (
    <Link
      to={to}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        isActive
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
      <span>{label}</span>
    </Link>
  );
}

const THEME_OPTIONS: ReadonlyArray<{ value: Theme; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Escuro", icon: Moon },
  { value: "system", label: "Sistema", icon: Monitor },
];

function ThemeMenu() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const Icon = resolvedTheme === "dark" ? Moon : Sun;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Alterar tema">
          <Icon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Tema</DropdownMenuLabel>
        {THEME_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => setTheme(option.value)}
            className={cn(theme === option.value && "bg-accent text-accent-foreground")}
          >
            <option.icon aria-hidden="true" />
            <span>{option.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join("") || "?";
}

function UserMenu() {
  const { user } = useAuth();
  const signOut = useSignOut();
  const navigate = useNavigate();
  const [isSigningOut, setIsSigningOut] = useState(false);

  if (!user) return null;

  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      await signOut.mutateAsync();
      await navigate({ to: "/login" });
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Menu do usuário"
          className={cn(
            "flex items-center gap-2 rounded-md p-0.5 pr-2 text-sm",
            "hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          )}
        >
          <span className="grid size-7 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
            {initialsOf(user.name || user.email)}
          </span>
          <span className="hidden max-w-32 truncate font-medium sm:inline">{user.name}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">{user.name}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void handleSignOut()} disabled={isSigningOut}>
          <LogOut aria-hidden="true" />
          <span>{isSigningOut ? "Saindo…" : "Sair"}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell() {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-popover focus:px-3 focus:py-2 focus:text-sm focus:shadow-[var(--shadow-lifted)]"
      >
        Pular para o conteúdo
      </a>
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-2 px-4 py-2.5">
          <Link
            to="/"
            className="mr-1 flex items-center gap-2 rounded-md font-semibold tracking-tight focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
              <BookmarkIcon className="size-4" aria-hidden="true" />
            </span>
            <span className="hidden sm:inline">Favoritos</span>
          </Link>

          <nav
            aria-label="Navegação principal"
            className="flex items-center gap-0.5 overflow-x-auto"
          >
            {PRIMARY_NAV.map((item) => (
              <NavLink key={item.to} {...item} />
            ))}
            {SETTINGS_NAV.map((item) => (
              <NavLink key={item.to} {...item} />
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            <ThemeMenu />
            <UserMenu />
          </div>
        </div>
      </header>
      <main id="conteudo" className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
