import { createBookmarkSchema, normalizeUrl } from "@bookmarks/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { ApiError, api } from "../lib/api";
import { queryKeys } from "../lib/query";
import { TagInput } from "./tag-input";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { useToast } from "./ui/toast";

interface BookmarkFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suggestions?: readonly string[];
}

export function BookmarkFormDialog({ open, onOpenChange, suggestions }: BookmarkFormDialogProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setUrl("");
      setTitle("");
      setTags([]);
      setError(null);
    }
  }, [open]);

  const createBookmark = useMutation({
    mutationFn: api.bookmarks.create,
    onSuccess: ({ created }) => {
      void queryClient.invalidateQueries({ queryKey: ["bookmarks"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tags });
      if (created) {
        toast({ title: "Favorito adicionado", variant: "success" });
      } else {
        toast({
          title: "Este favorito já está salvo",
          description: "A URL já existia na sua coleção.",
        });
      }
      onOpenChange(false);
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof ApiError ? mutationError.message : "Não foi possível salvar.",
      );
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = createBookmarkSchema.safeParse({
      url,
      ...(title.trim() ? { title: title.trim() } : {}),
      ...(tags.length > 0 ? { tags } : {}),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Verifique os campos.");
      return;
    }

    try {
      normalizeUrl(parsed.data.url);
    } catch {
      setError("Informe uma URL válida, como exemplo.com/pagina.");
      return;
    }

    createBookmark.mutate(parsed.data);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar favorito</DialogTitle>
          <DialogDescription>
            Cole um link e, se quiser, dê um título e tags para encontrá-lo depois.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          <div className="space-y-2">
            <Label htmlFor="bookmark-url">URL</Label>
            <Input
              id="bookmark-url"
              name="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://exemplo.com/artigo"
              inputMode="url"
              autoFocus
              aria-invalid={Boolean(error) || undefined}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="bookmark-title">Título (opcional)</Label>
            <Input
              id="bookmark-title"
              name="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={500}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="bookmark-tags">Tags (opcional)</Label>
            <TagInput
              id="bookmark-tags"
              value={tags}
              onChange={setTags}
              suggestions={suggestions}
              disabled={createBookmark.isPending}
            />
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={createBookmark.isPending}>
              {createBookmark.isPending ? (
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
              ) : null}
              Adicionar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
