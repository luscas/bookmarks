import { Loader2 } from "lucide-react";
import { cn } from "../../lib/utils";

/** Inline spinner always paired with a text label so motion is never the only cue. */
export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2
        aria-hidden="true"
        className={cn("size-4 animate-spin motion-reduce:animate-none", className)}
      />
      {label ? <span>{label}</span> : null}
    </span>
  );
}
