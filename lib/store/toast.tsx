"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastTone = "success" | "error" | "info" | "warning";

export interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Milliseconds before auto-dismiss. 0 keeps it until dismissed. */
  duration?: number;
}

interface ToastRecord extends Required<Omit<ToastInput, "description">> {
  id: string;
  description?: string;
}

interface ToastContextValue {
  toast: (input: ToastInput) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_STYLES: Record<ToastTone, { icon: typeof Info; className: string; iconClass: string }> = {
  success: {
    icon: CheckCircle2,
    className: "border-positive-100 bg-positive-50",
    iconClass: "text-positive-600",
  },
  error: {
    icon: XCircle,
    className: "border-danger-100 bg-danger-50",
    iconClass: "text-danger-600",
  },
  warning: {
    icon: AlertTriangle,
    className: "border-caution-100 bg-caution-50",
    iconClass: "text-caution-600",
  },
  info: {
    icon: Info,
    className: "border-line bg-surface",
    iconClass: "text-accent-600",
  },
};

let toastCounter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((previous) => previous.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      toastCounter += 1;
      const id = `toast-${toastCounter}`;
      const record: ToastRecord = {
        id,
        title: input.title,
        description: input.description,
        tone: input.tone ?? "info",
        duration: input.duration ?? 4200,
      };
      setToasts((previous) => [...previous.slice(-3), record]);
      if (record.duration > 0) {
        window.setTimeout(() => dismiss(id), record.duration);
      }
    },
    [dismiss],
  );

  const clear = useCallback(() => setToasts([]), []);

  const value = useMemo(() => ({ toast, dismiss, clear }), [toast, dismiss, clear]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6"
      >
        {toasts.map((item) => {
          const tone = TONE_STYLES[item.tone];
          const Icon = tone.icon;
          return (
            <div
              key={item.id}
              className={cn(
                "animate-rise pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border p-3.5 shadow-raised",
                tone.className,
              )}
            >
              <Icon className={cn("mt-0.5 size-4 shrink-0", tone.iconClass)} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{item.title}</p>
                {item.description ? (
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{item.description}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                className="rounded-md p-1 text-ink-faint transition-colors hover:bg-surface/70 hover:text-ink"
                aria-label="Dismiss notification"
              >
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return context;
}
