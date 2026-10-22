"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AdminLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(data?.error?.message ?? "Could not sign in.");
      }
      router.replace("/admin");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign in.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-sm items-center px-4">
      <form
        onSubmit={(event) => void submit(event)}
        className="w-full rounded-2xl border border-line bg-surface p-6 shadow-card"
      >
        <span className="mb-4 grid size-11 place-items-center rounded-xl bg-accent-50 text-accent-600">
          <Lock className="size-5" />
        </span>
        <h1 className="text-[19px] font-bold tracking-[-0.01em] text-ink">Admin sign in</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
          Enter the password from <code className="font-mono text-[12px]">ADMIN_PASSWORD</code> to
          open the crawl dashboard.
        </p>

        <label className="mt-5 block text-[12px] font-medium text-ink-muted" htmlFor="password">
          Password
        </label>
        <div className="relative mt-1.5">
          <KeyRound className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint" />
          <input
            id="password"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="h-10 w-full rounded-xl border border-line-strong bg-surface pr-3 pl-9 text-sm text-ink outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
            required
          />
        </div>

        {error ? <p className="mt-3 text-[12px] text-danger-600">{error}</p> : null}

        <Button
          type="submit"
          variant="primary"
          size="md"
          className="mt-5 w-full"
          loading={loading}
          disabled={loading || password.length === 0}
        >
          Sign in
        </Button>
      </form>
    </div>
  );
}
