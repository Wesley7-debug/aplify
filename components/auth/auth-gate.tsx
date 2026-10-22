"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ArrowRight, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";

type GateState = "checking" | "authenticated" | "unauthenticated";

/**
 * Blocks the public site until the visitor enters an email address.
 *
 * The email is kept in a signed httpOnly cookie, never localStorage. The admin
 * dashboard has its own password login and is not gated by this modal.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith("/admin") ?? false;
  const [state, setState] = useState<GateState>("checking");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isAdmin) return;
    const controller = new AbortController();
    void fetch("/api/auth", { cache: "no-store", signal: controller.signal })
      .then((response) => setState(response.ok ? "authenticated" : "unauthenticated"))
      .catch(() => {
        if (!controller.signal.aborted) setState("unauthenticated");
      });
    return () => controller.abort();
  }, [isAdmin]);

  if (isAdmin) return children;

  if (state === "checking") {
    return (
      <div className="grid min-h-[60vh] place-items-center px-4">
        <div className="flex items-center gap-2 text-[13px] text-ink-muted">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Checking your session…
        </div>
      </div>
    );
  }

  if (state === "authenticated") return children;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      if (!response.ok) {
        throw new Error(data?.error?.message ?? "Could not save your email.");
      }
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your email.");
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/35 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="email-gate-title"
    >
      <form
        onSubmit={(event) => void submit(event)}
        className="w-full max-w-[400px] rounded-2xl border border-line bg-surface p-6 shadow-overlay"
      >
        <span className="grid size-11 place-items-center rounded-xl bg-accent-50 text-accent-700">
          <Mail className="size-5" aria-hidden />
        </span>
        <h1 id="email-gate-title" className="mt-4 text-[22px] font-bold tracking-[-0.02em] text-ink">
          Enter your email
        </h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
          Your searches and contacts are saved to this address.
        </p>

        <label className="mt-5 block text-[12px] font-medium text-ink-muted" htmlFor="gate-email">
          Email
        </label>
        <input
          id="gate-email"
          type="email"
          required
          autoFocus
          autoComplete="email"
          maxLength={254}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          className="mt-1.5 h-11 w-full rounded-xl border border-line-strong bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink-faint focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
        />

        {error ? <p className="mt-2 text-[12px] text-danger-600">{error}</p> : null}

        <Button
          type="submit"
          variant="primary"
          size="md"
          loading={submitting}
          icon={submitting ? undefined : <ArrowRight className="size-4" />}
          className="mt-4 w-full"
        >
          Continue
        </Button>
      </form>
    </div>
  );
}
