import { MAX_IMPORT_HTML_BYTES } from "@bookmarks/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileUp, Loader2, Upload } from "lucide-react";
import { type ChangeEvent, type FormEvent, useState } from "react";
import { EmptyState } from "../components/empty-state";
import { ErrorState } from "../components/error-state";
import { PageHeader } from "../components/page-header";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import { Textarea } from "../components/ui/textarea";
import { useToast } from "../components/ui/toast";
import { ApiError, type ImportSummary, api } from "../lib/api";
import { formatDate } from "../lib/format";
import { queryKeys } from "../lib/query";

const STATUS_LABEL: Record<string, string> = {
  running: "Em andamento",
  done: "Concluída",
  failed: "Falhou",
};

function ImportHistory() {
  const importsQuery = useQuery({
    queryKey: queryKeys.imports,
    queryFn: () => api.imports.list(),
  });

  if (importsQuery.isLoading) {
    return (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (importsQuery.isError) {
    return <ErrorState error={importsQuery.error} onRetry={() => void importsQuery.refetch()} />;
  }

  const imports = importsQuery.data ?? [];
  if (imports.length === 0) {
    return (
      <EmptyState
        icon={<Upload aria-hidden="true" />}
        title="Nenhuma importação ainda"
        description="As importações que você fizer aparecerão aqui com o resumo do que foi adicionado."
      />
    );
  }

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
      {imports.map((item: ImportSummary) => (
        <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
          <Badge variant={item.status === "done" ? "default" : "secondary"}>
            {STATUS_LABEL[item.status] ?? item.status}
          </Badge>
          <span className="text-muted-foreground">
            <span className="font-medium text-foreground tabular-nums">{item.imported}</span>{" "}
            adicionados
          </span>
          <span className="text-muted-foreground">
            <span className="font-medium text-foreground tabular-nums">{item.skipped}</span>{" "}
            ignorados
          </span>
          <span className="ml-auto text-xs text-muted-foreground">
            {formatDate(item.createdAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ImportPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [html, setHtml] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [autoTag, setAutoTag] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runImport = useMutation({
    mutationFn: () => api.imports.create({ source: "html", html, autoTag }),
    onSuccess: (summary) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.imports });
      void queryClient.invalidateQueries({ queryKey: ["bookmarks"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tags });
      toast({
        title: `Importação concluída: ${summary.imported} adicionados`,
        description:
          summary.skipped > 0 ? `${summary.skipped} já existiam e foram ignorados.` : undefined,
        variant: "success",
      });
      setHtml("");
      setFileName(null);
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof ApiError
          ? mutationError.message
          : "Não foi possível concluir a importação.",
      );
    },
  });

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_IMPORT_HTML_BYTES) {
      setError("O arquivo excede o limite de 10 MB.");
      return;
    }
    setError(null);
    const text = await file.text();
    setHtml(text);
    setFileName(file.name);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (html.trim().length === 0) {
      setError("Cole o HTML dos favoritos ou escolha um arquivo exportado.");
      return;
    }
    runImport.mutate();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Importar favoritos"
        description="Traga os favoritos exportados do Chrome ou de qualquer navegador compatível."
      />

      <Card>
        <CardHeader>
          <CardTitle>Arquivo de favoritos</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <label
                htmlFor="import-file"
                className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-card px-3 py-2 text-sm font-medium shadow-[var(--shadow-border)] hover:bg-accent focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background"
              >
                <FileUp className="size-4" aria-hidden="true" />
                Escolher arquivo .html
                <input
                  id="import-file"
                  type="file"
                  accept=".html,text/html"
                  className="sr-only"
                  onChange={(event) => void handleFile(event)}
                />
              </label>
              {fileName ? (
                <p className="text-xs text-muted-foreground">Arquivo selecionado: {fileName}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label htmlFor="import-html" className="text-sm font-medium">
                Ou cole o HTML exportado
              </label>
              <Textarea
                id="import-html"
                value={html}
                onChange={(event) => setHtml(event.target.value)}
                placeholder="<!DOCTYPE NETSCAPE-Bookmark-file-1> …"
                className="min-h-40 font-mono text-xs"
              />
            </div>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoTag}
                onChange={(event) => setAutoTag(event.target.checked)}
                className="mt-0.5 size-4 rounded border-input accent-[var(--primary)] focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span>
                Sugerir tags automaticamente
                <span className="block text-xs text-muted-foreground">
                  Envia os favoritos importados para a IA. Requer a IA configurada.
                </span>
              </span>
            </label>

            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={runImport.isPending}>
                {runImport.isPending ? (
                  <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
                ) : null}
                Importar
              </Button>
              {runImport.isSuccess && runImport.data ? (
                <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                  <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
                  {runImport.data.imported} adicionados, {runImport.data.skipped} ignorados
                </span>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight">Histórico</h2>
        <ImportHistory />
      </section>
    </div>
  );
}
