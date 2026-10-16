import type { Bookmark } from "@bookmarks/shared";
import { hostnameOf } from "@bookmarks/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Globe, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";
import { formatRelative } from "../lib/format";
import { queryKeys } from "../lib/query";
import { cn } from "../lib/utils";
import { BookmarkEditDialog } from "./bookmark-edit-dialog";
import { ConfirmDialog } from "./confirm-dialog";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { useToast } from "./ui/toast";

interface BookmarkCardProps {
  bookmark: Bookmark;
  suggestions?: readonly string[];
}

function Favicon({ url, host }: { url: string | null; host: string }) {
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    return (
      <img
        src={url}
        alt=""
        width={20}
        height={20}
        loading="lazy"
        className="size-5 shrink-0 rounded-sm object-contain outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="grid size-5 shrink-0 place-items-center rounded-sm bg-muted text-[0.625rem] font-semibold uppercase text-muted-foreground"
    >
      {host.charAt(0) || <Globe className="size-3" />}
    </span>
  );
}

export function BookmarkCard({ bookmark, suggestions = [] }: BookmarkCardProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const host = hostnameOf(bookmark.url) || bookmark.normalizedUrl;
  const displayTitle = bookmark.title?.trim() || host;

  const remove = useMutation({
    mutationFn: () => api.bookmarks.remove(bookmark.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["bookmarks"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tags });
      toast({ title: "Favorito removido", variant: "success" });
      setConfirmOpen(false);
    },
    onError: () => {
      toast({ title: "Não foi possível remover o favorito.", variant: "destructive" });
    },
  });

  return (
    <article className="group flex items-start gap-3 rounded-lg border border-border bg-card p-4 shadow-[var(--shadow-border)] transition-shadow hover:shadow-[var(--shadow-lifted)]">
      <Favicon url={bookmark.faviconUrl} host={host} />

      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-baseline gap-2">
          <h3 className="min-w-0 truncate text-sm font-medium">
            <a
              href={bookmark.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex max-w-full items-center gap-1 rounded-sm hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <span className="truncate">{displayTitle}</span>
              <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            </a>
          </h3>
        </div>

        <p className="truncate text-xs text-muted-foreground">{host}</p>

        {bookmark.description ? (
          <p className="line-clamp-2 text-xs text-muted-foreground">{bookmark.description}</p>
        ) : null}

        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {bookmark.tags.map((tag) => (
            <Badge key={tag.id} variant="secondary">
              {tag.color ? (
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full"
                  style={{ backgroundColor: tag.color }}
                />
              ) : null}
              {tag.name}
            </Badge>
          ))}
          <span className="ml-auto text-[0.6875rem] text-muted-foreground">
            {formatRelative(bookmark.createdAt)}
          </span>
        </div>
      </div>

      <div className={cn("flex shrink-0 items-center gap-0.5")}>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Editar ${displayTitle}`}
          onClick={() => setEditOpen(true)}
        >
          <Pencil aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Excluir ${displayTitle}`}
          onClick={() => setConfirmOpen(true)}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>

      <BookmarkEditDialog
        bookmark={bookmark}
        open={editOpen}
        onOpenChange={setEditOpen}
        suggestions={suggestions}
      />
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        destructive
        title="Excluir favorito?"
        description={
          <>
            <span className="font-medium text-foreground">{displayTitle}</span> será removido
            permanentemente.
          </>
        }
        confirmLabel="Excluir"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </article>
  );
}
