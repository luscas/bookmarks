import type { Bookmark } from "@bookmarks/shared";
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
import { Textarea } from "./ui/textarea";

interface BookmarkEditDialogProps {
  bookmark: Bookmark | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suggestions?: readonly string[];
}

export function BookmarkEditDialog({
  bookmark,
  open,
  onOpenChange,
  suggestions,
}: BookmarkEditDialogProps) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (bookmark) {
      setTitle(bookmark.title ?? "");
      setDescription(bookmark.description ?? "");
      setNotes(bookmark.notes ?? "");
      setTags(bookmark.tags.map((tag) => tag.name));
      setError(null);
    }
  }, [bookmark]);

  const save = useMutation({
    mutationFn: async () => {
      if (!bookmark) throw new Error("Nenhum favorito selecionado.");
      await api.bookmarks.update(bookmark.id, {
        title: title.trim() ? title.trim() : null,
        description: description.trim() ? description.trim() : null,
        notes: notes.trim() ? notes.trim() : null,
      });
      await api.bookmarks.setTags(bookmark.id, tags);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["bookmarks"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tags });
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
    save.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar favorito</DialogTitle>
          <DialogDescription className="truncate">{bookmark?.url}</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="edit-title">Título</Label>
            <Input
              id="edit-title"
              value={title}
              maxLength={500}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-description">Descrição</Label>
            <Textarea
              id="edit-description"
              value={description}
              maxLength={2000}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-notes">Notas</Label>
            <Textarea
              id="edit-notes"
              value={notes}
              maxLength={5000}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-tags">Tags</Label>
            <TagInput
              id="edit-tags"
              value={tags}
              onChange={setTags}
              suggestions={suggestions}
              disabled={save.isPending}
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
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? (
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
              ) : null}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
