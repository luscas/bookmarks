import { type AiSettingsInput, aiSettingsInputSchema } from "@bookmarks/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles, Wand2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { ErrorState } from "../components/error-state";
import { PageHeader } from "../components/page-header";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select } from "../components/ui/select";
import { Skeleton } from "../components/ui/skeleton";
import { useToast } from "../components/ui/toast";
import { type AiJob, ApiError, api } from "../lib/api";
import { queryKeys } from "../lib/query";

const JOB_STATUS_LABEL: Record<AiJob["status"], string> = {
  queued: "Na fila",
  running: "Em andamento",
  done: "Concluído",
  failed: "Falhou",
};

function JobProgress({ job }: { job: AiJob }) {
  const result = (job.result ?? null) as { tagged?: number } | null;
  return (
    <output
      aria-live="polite"
      className="block space-y-1 rounded-md border border-border bg-muted/40 p-3 text-sm"
    >
      <p className="font-medium">
        Job de organização:{" "}
        <span className="font-normal text-muted-foreground">{JOB_STATUS_LABEL[job.status]}</span>
      </p>
      {job.status === "done" && result?.tagged !== undefined ? (
        <p className="text-muted-foreground">
          A IA atualizou {result.tagged} {result.tagged === 1 ? "favorito" : "favoritos"}.
        </p>
      ) : null}
      {job.status === "failed" && job.error ? (
        <p className="text-destructive">{job.error}</p>
      ) : null}
    </output>
  );
}

function OrganizeTool() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [scope, setScope] = useState<"untagged" | "all">("untagged");
  const [jobId, setJobId] = useState<string | null>(null);

  const start = useMutation({
    mutationFn: () => api.ai.organize(scope),
    onSuccess: (id) => {
      setJobId(id);
      toast({ title: "Organização iniciada", variant: "success" });
    },
    onError: (error) =>
      toast({
        title: error instanceof ApiError ? error.message : "Não foi possível iniciar a IA.",
        variant: "destructive",
      }),
  });

  const jobQuery = useQuery({
    queryKey: jobId ? queryKeys.aiJob(jobId) : (["ai", "job", "none"] as const),
    queryFn: () => api.ai.getJob(jobId as string),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "queued" || status === "running" ? 1500 : false;
    },
  });

  const status = jobQuery.data?.status;
  useEffect(() => {
    if (status === "done") {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tags });
      void queryClient.invalidateQueries({ queryKey: ["bookmarks"] });
    }
  }, [status, queryClient]);

  const busy = start.isPending || status === "queued" || status === "running";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Organizar com IA</CardTitle>
        <CardDescription>
          A IA analisa os favoritos e aplica tags automaticamente. O resumo mostra quantos foram
          atualizados.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="organize-scope">Escopo</Label>
            <Select
              id="organize-scope"
              value={scope}
              onChange={(event) => setScope(event.target.value as "untagged" | "all")}
              disabled={busy}
            >
              <option value="untagged">Apenas sem tags</option>
              <option value="all">Todos os favoritos</option>
            </Select>
          </div>
          <Button onClick={() => start.mutate()} disabled={busy}>
            {busy ? (
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
            ) : (
              <Wand2 aria-hidden="true" />
            )}
            Organizar com IA
          </Button>
        </div>

        {jobQuery.data ? <JobProgress job={jobQuery.data} /> : null}
      </CardContent>
    </Card>
  );
}

export function AiSettingsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const settingsQuery = useQuery({
    queryKey: queryKeys.aiSettings,
    queryFn: () => api.ai.getSettings(),
  });

  const [provider, setProvider] = useState<"openai-compatible">("openai-compatible");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const settings = settingsQuery.data;
    if (settings) {
      setProvider(settings.provider as "openai-compatible");
      setModel(settings.model);
      setBaseUrl(settings.baseUrl ?? "");
    }
  }, [settingsQuery.data]);

  const save = useMutation({
    mutationFn: (input: AiSettingsInput) => api.ai.saveSettings(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.aiSettings });
      setApiKey("");
      setSaved(true);
      toast({ title: "Configurações salvas", variant: "success" });
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof ApiError
          ? mutationError.message
          : "Não foi possível salvar as configurações.",
      );
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);

    const parsed = aiSettingsInputSchema.safeParse({
      provider,
      model: model.trim(),
      ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Verifique os campos.");
      return;
    }
    save.mutate(parsed.data);
  }

  const settings = settingsQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inteligência artificial"
        description="Configure o provedor usado para sugerir e organizar tags."
      />

      {settingsQuery.isLoading ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-40" />
        </div>
      ) : settingsQuery.isError ? (
        <ErrorState error={settingsQuery.error} onRetry={() => void settingsQuery.refetch()} />
      ) : (
        <>
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div className="space-y-1">
                <CardTitle>Provedor</CardTitle>
                <CardDescription>
                  Compatível com OpenAI, OpenRouter, Groq e servidores locais.
                </CardDescription>
              </div>
              <Badge variant={settings?.hasApiKey ? "default" : "outline"}>
                <Sparkles aria-hidden="true" className="size-3" />
                {settings?.hasApiKey ? "Chave configurada" : "Sem chave"}
              </Badge>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleSubmit}>
                <div className="space-y-2">
                  <Label htmlFor="ai-provider">Provedor</Label>
                  <Select
                    id="ai-provider"
                    value={provider}
                    onChange={(event) => setProvider(event.target.value as "openai-compatible")}
                  >
                    <option value="openai-compatible">Compatível com OpenAI</option>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ai-model">Modelo</Label>
                  <Input
                    id="ai-model"
                    value={model}
                    maxLength={200}
                    placeholder="ex.: gpt-4o-mini"
                    onChange={(event) => setModel(event.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ai-base-url">URL base (opcional)</Label>
                  <Input
                    id="ai-base-url"
                    value={baseUrl}
                    inputMode="url"
                    placeholder="https://api.openai.com/v1"
                    onChange={(event) => setBaseUrl(event.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ai-api-key">Chave de API</Label>
                  <Input
                    id="ai-api-key"
                    type="password"
                    value={apiKey}
                    autoComplete="off"
                    placeholder={
                      settings?.hasApiKey ? "Configurada — deixe em branco para manter" : "sk-…"
                    }
                    onChange={(event) => setApiKey(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    A chave é armazenada de forma criptografada e nunca é exibida novamente.
                  </p>
                </div>

                {error ? (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                ) : null}

                <div className="flex items-center gap-3">
                  <Button type="submit" disabled={save.isPending}>
                    {save.isPending ? (
                      <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
                    ) : null}
                    Salvar
                  </Button>
                  {saved ? (
                    <span className="text-sm text-muted-foreground">Configurações salvas.</span>
                  ) : null}
                </div>
              </form>
            </CardContent>
          </Card>

          <OrganizeTool />
        </>
      )}
    </div>
  );
}
