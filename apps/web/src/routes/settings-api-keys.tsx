import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { ConfirmDialog } from "../components/confirm-dialog";
import { EmptyState } from "../components/empty-state";
import { ErrorState } from "../components/error-state";
import { PageHeader } from "../components/page-header";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Skeleton } from "../components/ui/skeleton";
import { useToast } from "../components/ui/toast";
import { ApiError, type ApiKeySummary, type CreatedApiKey, api } from "../lib/api";
import { formatDate } from "../lib/format";
import { queryKeys } from "../lib/query";

function CreatedKeyDialog({
  created,
  onOpenChange,
}: {
  created: CreatedApiKey | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.key);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Dialog open={Boolean(created)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Chave criada</DialogTitle>
          <DialogDescription>
            Copie agora. Por segurança, esta chave não será exibida novamente.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Input readOnly value={created?.key ?? ""} className="font-mono text-xs" />
          <Button
            variant="outline"
            size="icon"
            aria-label="Copiar chave"
            onClick={() => void copy()}
          >
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Concluir</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApiKeyRow({ apiKey }: { apiKey: ApiKeySummary }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const remove = useMutation({
    mutationFn: () => api.apiKeys.remove(apiKey.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys });
      toast({ title: "Chave revogada", variant: "success" });
      setConfirmOpen(false);
    },
    onError: () => toast({ title: "Não foi possível revogar a chave.", variant: "destructive" }),
  });

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <KeyRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{apiKey.name ?? "Sem nome"}</p>
        <p className="truncate font-mono text-xs text-muted-foreground">
          {apiKey.start ? `${apiKey.start}…` : "••••"}
        </p>
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">
        criada em {formatDate(apiKey.createdAt)}
      </span>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Revogar chave ${apiKey.name ?? ""}`}
        onClick={() => setConfirmOpen(true)}
      >
        <Trash2 aria-hidden="true" />
      </Button>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        destructive
        title="Revogar chave?"
        description="A extensão que usa esta chave deixará de autenticar imediatamente."
        confirmLabel="Revogar"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </li>
  );
}

export function ApiKeysPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [created, setCreated] = useState<CreatedApiKey | null>(null);

  const keysQuery = useQuery({
    queryKey: queryKeys.apiKeys,
    queryFn: () => api.apiKeys.list(),
  });

  const create = useMutation({
    mutationFn: () => api.apiKeys.create(name.trim() || "Extensão do navegador"),
    onSuccess: (key) => {
      setCreated(key);
      setName("");
      void queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys });
    },
    onError: (error) =>
      toast({
        title: error instanceof ApiError ? error.message : "Não foi possível criar a chave.",
        variant: "destructive",
      }),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  const keys = keysQuery.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Chaves de API"
        description="Chaves usadas pela extensão do navegador para acessar a API."
      />

      <Card>
        <CardHeader>
          <CardTitle>Criar chave</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-wrap items-end gap-3" onSubmit={handleSubmit}>
            <div className="min-w-40 flex-1 space-y-2">
              <Label htmlFor="api-key-name">Nome</Label>
              <Input
                id="api-key-name"
                value={name}
                maxLength={100}
                placeholder="ex.: Notebook do trabalho"
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? (
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
              ) : (
                <Plus aria-hidden="true" />
              )}
              Criar chave
            </Button>
          </form>
        </CardContent>
      </Card>

      {keysQuery.isLoading ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : keysQuery.isError ? (
        <ErrorState error={keysQuery.error} onRetry={() => void keysQuery.refetch()} />
      ) : keys.length === 0 ? (
        <EmptyState
          icon={<KeyRound aria-hidden="true" />}
          title="Nenhuma chave ainda"
          description="Crie uma chave para conectar a extensão do navegador à sua conta."
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {keys.map((apiKey) => (
            <ApiKeyRow key={apiKey.id} apiKey={apiKey} />
          ))}
        </ul>
      )}

      <CreatedKeyDialog
        created={created}
        onOpenChange={(open) => {
          if (!open) setCreated(null);
        }}
      />
    </div>
  );
}
