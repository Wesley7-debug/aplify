"use client";

import { useState } from "react";
import { deviceHeaders } from "@/lib/device-client";

/** Clears the signed email cookie so the gate asks for another address. */
export function ChangeEmailButton() {
  const [busy, setBusy] = useState(false);

  async function change() {
    setBusy(true);
    try {
      await fetch("/api/auth", { method: "DELETE", headers: deviceHeaders() });
    } finally {
      window.location.reload();
    }
  }

  return (
    <button
      type="button"
      onClick={() => void change()}
      disabled={busy}
      className="underline underline-offset-2 hover:text-ink-muted disabled:opacity-60"
    >
      {busy ? "Signing out…" : "Change email"}
    </button>
  );
}
