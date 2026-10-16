import { TriangleAlert } from "lucide-react";
import { ApiError } from "../lib/api";
import { Button } from "./ui/button";

interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  actionLabel?: string;
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Ocorreu um erro inesperado.";
}

/** Inline error notice with an optional retry action. */
export function ErrorState({ error, onRetry, actionLabel = "Tentar novamente" }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
      <div className="flex-1 space-y-2">
        <p className="font-medium text-foreground">{messageOf(error)}</p>
        {onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
