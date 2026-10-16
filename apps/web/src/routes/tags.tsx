import type { Tag } from "@bookmarks/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CornerDownRight, Loader2, Plus, Tags as TagsIcon, Trash2 } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { ConfirmDialog } from "../components/confirm-dialog";
import { EmptyState } from "../components/empty-state";
import { ErrorState } from "../components/error-state";
import { PageHeader } from "../components/page-header";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select } from "../components/ui/select";
import { Skeleton } from "../components/ui/skeleton";
import { useToast } from "../components/ui/toast";
import { ApiError, api } from "../lib/api";
import { queryKeys } from "../lib/query";
import { cn } from "../lib/utils";

function TagRow({ tag }: { tag: Tag }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(tag.name);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.tags });
    void queryClient.invalidateQueries({ queryKey: ["bookmarks"] });
  }

  const rename = useMutation({
    mutationFn: (name: string) => api.tags.update(tag.id, { name }),
    onSuccess: () => {
      invalidate();
      setEditing(false);
    },
    onError: (error) =>
      toast({
        title: error instanceof ApiError ? error.message : "Não foi possível renomear.",
        variant: "destructive",
      }),
  });

  const recolor = useMutation({
    mutationFn: (color: string) => api.tags.update(tag.id, { color }),
    onSuccess: invalidate,
    onError: () => toast({ title: "Não foi possível alterar a cor.", variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: () => api.tags.remove(tag.id),
    onSuccess: () => {
      invalidate();
      toast({ title: "Tag removida", variant: "success" });
      setConfirmOpen(false);
    },
    onError: () => toast({ title: "Não foi possível remover a tag.", variant: "destructive" }),
  });

  function commitRename() {
    const next = draftName.trim();
    if (next.length === 0 || next === tag.name) {
      setEditing(false);
      setDraftName(tag.name);
      return;
    }
    rename.mutate(next);
  }

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <label
        className="relative inline-flex shrink-0 cursor-pointer items-center"
        title="Alterar cor"
      >
        <span className="sr-only">Alterar cor da tag {tag.name}</span>
        <input
          type="color"
          value={tag.color ?? "#7c3aed"}
          onChange={(event) => recolor.mutate(event.target.value)}
          className="sr-only"
        />
        <span
          aria-hidden="true"
          className="size-5 rounded-full border border-border outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
          style={{ backgroundColor: tag.color ?? "var(--muted)" }}
        />
      </label>

      <div className="min-w-0 flex-1">
        {editing ? (
          <Input
            value={draftName}
            autoFocus
            maxLength={100}
            aria-label={`Novo nome para a tag ${tag.name}`}
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitRename();
              if (event.key === "Escape") {
                setEditing(false);
                setDraftName(tag.name);
              }
            }}
            onBlur={commitRename}
            className="h-8"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="max-w-full truncate rounded-sm text-left text-sm font-medium hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {tag.name}
          </button>
        )}
      </div>

      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {tag.bookmarkCount ?? 0} {tag.bookmarkCount === 1 ? "favorito" : "favoritos"}
      </span>

      <div className="flex shrink-0 items-center gap-0.5">
        {editing ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Salvar nome"
            onClick={commitRename}
            disabled={rename.isPending}
          >
            <Check aria-hidden="true" />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Excluir tag ${tag.name}`}
          onClick={() => setConfirmOpen(true)}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        destructive
        title="Excluir tag?"
        description={
          <>
            A tag <span className="font-medium text-foreground">{tag.name}</span> será removida de
            todos os favoritos. Os favoritos em si são mantidos.
          </>
        }
        confirmLabel="Excluir"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </li>
  );
}

function CreateTagForm() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#7c3aed");

  const create = useMutation({
    mutationFn: () => api.tags.create({ name: name.trim(), color }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tags });
      setName("");
      toast({ title: "Tag criada", variant: "success" });
    },
    onError: (error) =>
      toast({
        title: error instanceof ApiError ? error.message : "Não foi possível criar a tag.",
        variant: "destructive",
      }),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (name.trim().length === 0) return;
    create.mutate();
  }

  return (
    <form className="flex flex-wrap items-end gap-3" onSubmit={handleSubmit}>
      <div className="min-w-40 flex-1 space-y-2">
        <Label htmlFor="new-tag-name">Nova tag</Label>
        <Input
          id="new-tag-name"
          value={name}
          maxLength={100}
          placeholder="ex.: dev/react"
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="new-tag-color">Cor</Label>
        <input
          id="new-tag-color"
          type="color"
          value={color}
          onChange={(event) => setColor(event.target.value)}
          className="h-9 w-12 cursor-pointer rounded-md border border-input bg-card p-1 shadow-[var(--shadow-border)]"
        />
      </div>
      <Button type="submit" disabled={create.isPending || name.trim().length === 0}>
        {create.isPending ? (
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
        ) : (
          <Plus aria-hidden="true" />
        )}
        Criar
      </Button>
    </form>
  );
}

function MergeTagsForm({ tags }: { tags: Tag[] }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [targetId, setTargetId] = useState("");

  const merge = useMutation({
    mutationFn: () => api.tags.merge({ sourceTagIds: sourceIds, targetTagId: targetId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tags });
      void queryClient.invalidateQueries({ queryKey: ["bookmarks"] });
      setSourceIds([]);
      setTargetId("");
      toast({ title: "Tags mescladas", variant: "success" });
    },
    onError: (error) =>
      toast({
        title: error instanceof ApiError ? error.message : "Não foi possível mesclar.",
        variant: "destructive",
      }),
  });

  const canMerge = sourceIds.length > 0 && targetId.length > 0 && !sourceIds.includes(targetId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mesclar tags</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Tags de origem</legend>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => {
              const selected = sourceIds.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() =>
                    setSourceIds((current) =>
                      selected ? current.filter((id) => id !== tag.id) : [...current, tag.id],
                    )
                  }
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    selected
                      ? "border-primary bg-primary/12 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tag.name}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="merge-target">Tag de destino</Label>
            <Select
              id="merge-target"
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
              className="min-w-44"
            >
              <option value="">Selecione…</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </Select>
          </div>
          <Button
            onClick={() => merge.mutate()}
            disabled={!canMerge || merge.isPending}
            variant="outline"
          >
            {merge.isPending ? (
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
            ) : (
              <CornerDownRight aria-hidden="true" />
            )}
            Mesclar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function TagsPage() {
  const tagsQuery = useQuery({
    queryKey: queryKeys.tags,
    queryFn: () => api.tags.list(),
  });

  const tags = useMemo(() => tagsQuery.data ?? [], [tagsQuery.data]);

  return (
    <div className="space-y-6">
      <PageHeader title="Tags" description="Renomeie, recolora, mescle ou remova suas tags." />

      <Card>
        <CardHeader>
          <CardTitle>Criar tag</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateTagForm />
        </CardContent>
      </Card>

      {tagsQuery.isLoading ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : tagsQuery.isError ? (
        <ErrorState error={tagsQuery.error} onRetry={() => void tagsQuery.refetch()} />
      ) : tags.length === 0 ? (
        <EmptyState
          icon={<TagsIcon aria-hidden="true" />}
          title="Nenhuma tag ainda"
          description="Crie uma tag acima ou adicione tags ao editar um favorito."
        />
      ) : (
        <>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {tags.map((tag) => (
              <TagRow key={tag.id} tag={tag} />
            ))}
          </ul>
          {tags.length > 1 ? <MergeTagsForm tags={tags} /> : null}
        </>
      )}
    </div>
  );
}
