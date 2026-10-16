import { MAX_TAGS_PER_BOOKMARK, normalizeTagName } from "@bookmarks/shared";
import { X } from "lucide-react";
import { type KeyboardEvent, useId, useState } from "react";
import { cn } from "../lib/utils";
import { Input } from "./ui/input";

interface TagInputProps {
  id?: string;
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: readonly string[];
  disabled?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}

/**
 * Chips input for tag names. Tags can be typed and confirmed with Enter or a
 * comma, and existing tags are offered as one-click suggestions. Duplicates and
 * empty values are dropped, and the shared max-tag limit is enforced.
 */
export function TagInput({
  id,
  value,
  onChange,
  suggestions = [],
  disabled,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
}: TagInputProps) {
  const [draft, setDraft] = useState("");
  const listId = useId();

  const atLimit = value.length >= MAX_TAGS_PER_BOOKMARK;

  function commit(raw: string) {
    const candidates = raw
      .split(",")
      .map(normalizeTagName)
      .filter((candidate) => candidate.length > 0);
    if (candidates.length === 0) return;
    const next = [...value];
    for (const candidate of candidates) {
      if (next.length >= MAX_TAGS_PER_BOOKMARK) break;
      if (!next.some((tag) => tag.toLowerCase() === candidate.toLowerCase())) {
        next.push(candidate);
      }
    }
    onChange(next);
    setDraft("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit(draft);
      return;
    }
    if (event.key === "Backspace" && draft.length === 0 && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  const unusedSuggestions = suggestions.filter(
    (suggestion) => !value.some((tag) => tag.toLowerCase() === suggestion.toLowerCase()),
  );

  return (
    <div className="space-y-2">
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Tags selecionadas">
          {value.map((tag) => (
            <li key={tag}>
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs">
                {tag}
                <button
                  type="button"
                  aria-label={`Remover tag ${tag}`}
                  disabled={disabled}
                  onClick={() => onChange(value.filter((entry) => entry !== tag))}
                  className="rounded-full text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <Input
        id={id}
        value={draft}
        list={listId}
        disabled={disabled || atLimit}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        aria-label="Adicionar tag"
        placeholder={
          atLimit ? `Limite de ${MAX_TAGS_PER_BOOKMARK} tags` : "Digite e pressione Enter"
        }
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => commit(draft)}
      />
      <datalist id={listId}>
        {unusedSuggestions.map((suggestion) => (
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>

      {unusedSuggestions.length > 0 && !atLimit ? (
        <div className="flex flex-wrap gap-1.5">
          {unusedSuggestions.slice(0, 8).map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={disabled}
              onClick={() => commit(suggestion)}
              className={cn(
                "rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground",
                "hover:border-ring hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
              )}
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
