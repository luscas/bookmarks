import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Bookmark as BookmarkIcon, Loader2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { ApiError, api } from "../lib/api";
import { queryKeys } from "../lib/query";

type Mode = "signin" | "signup";

function friendlyError(error: unknown, mode: Mode): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "E-mail ou senha inválidos.";
    if (error.status === 400) return "Verifique os dados informados.";
    return error.message;
  }
  return mode === "signin" ? "Não foi possível entrar." : "Não foi possível criar a conta.";
}

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      if (mode === "signin") {
        return api.auth.signInEmail({ email: email.trim(), password });
      }
      return api.auth.signUpEmail({
        name: name.trim(),
        username: username.trim(),
        email: email.trim(),
        password,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.me });
      await navigate({ to: "/" });
    },
    onError: (mutationError) => {
      setError(friendlyError(mutationError, mode));
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    submit.mutate();
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <span className="mx-auto grid size-11 place-items-center rounded-lg bg-primary text-primary-foreground">
            <BookmarkIcon className="size-5" aria-hidden="true" />
          </span>
          <h1 className="text-xl font-semibold tracking-tight">
            {mode === "signin" ? "Entrar nos Favoritos" : "Criar sua conta"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {mode === "signin"
              ? "Acesse sua coleção de favoritos."
              : "Leva um instante e mantém tudo sincronizado."}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          noValidate
          className="space-y-4 rounded-lg border border-border bg-card p-5 shadow-[var(--shadow-border)]"
        >
          {mode === "signup" ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="name">Nome</Label>
                <Input
                  id="name"
                  name="name"
                  autoComplete="name"
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="username">Usuário</Label>
                <Input
                  id="username"
                  name="username"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  pattern="[a-zA-Z0-9._-]+"
                  title="Use letras, números, ponto, hífen ou sublinhado."
                />
              </div>
            </>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            {mode === "signup" ? (
              <p className="text-xs text-muted-foreground">Use ao menos 8 caracteres.</p>
            ) : null}
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <Button type="submit" className="w-full" disabled={submit.isPending}>
            {submit.isPending ? (
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
            ) : null}
            {mode === "signin" ? "Entrar" : "Criar conta"}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          {mode === "signin" ? "Ainda não tem conta?" : "Já tem uma conta?"}{" "}
          <button
            type="button"
            onClick={() => switchMode(mode === "signin" ? "signup" : "signin")}
            className="rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {mode === "signin" ? "Criar conta" : "Entrar"}
          </button>
        </p>
      </div>
    </div>
  );
}
