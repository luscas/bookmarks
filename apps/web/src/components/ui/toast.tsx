import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "../../lib/utils";

export type ToastVariant = "default" | "success" | "destructive";

export interface ToastInput {
  title: string;
  description?: string;
  variant?: ToastVariant;
}

interface ToastItem extends ToastInput {
  id: number;
}

interface ToastContextValue {
  toast: (input: ToastInput) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 6000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback((input: ToastInput) => {
    const id = nextId.current;
    nextId.current += 1;
    setItems((current) => [...current, { ...input, id }]);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
      >
        {items.map((item) => (
          <ToastCard key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [onDismiss]);

  const variant = item.variant ?? "default";
  const Icon =
    variant === "success" ? CheckCircle2 : variant === "destructive" ? TriangleAlert : Info;

  return (
    <div
      role={variant === "destructive" ? "alert" : "status"}
      className={cn(
        "pointer-events-auto flex items-start gap-3 rounded-md border bg-popover p-3 text-popover-foreground",
        "shadow-[var(--shadow-lifted)]",
        variant === "destructive" && "border-destructive/40",
        variant === "success" && "border-success/40",
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "mt-0.5 size-4 shrink-0",
          variant === "success" && "text-success",
          variant === "destructive" && "text-destructive",
          variant === "default" && "text-muted-foreground",
        )}
      />
      <div className="flex-1 space-y-0.5">
        <p className="text-sm font-medium leading-snug">{item.title}</p>
        {item.description ? (
          <p className="text-xs text-muted-foreground">{item.description}</p>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Fechar aviso"
        onClick={onDismiss}
        className="rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
