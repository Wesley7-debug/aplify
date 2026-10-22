"use client";

import { useCallback } from "react";
import { useToast } from "@/lib/store/toast";
import { copyText } from "@/lib/utils";

/** Clipboard helpers wired to the toast system. */
export function useClipboard() {
  const { toast } = useToast();

  const copy = useCallback(
    async (
      value: string,
      options?: { title?: string; description?: string; successTone?: "success" | "info" },
    ) => {
      const ok = await copyText(value);
      if (ok) {
        toast({
          title: options?.title ?? "Copied to clipboard",
          description: options?.description ?? value,
          tone: options?.successTone ?? "success",
          duration: 2600,
        });
        return true;
      }
      toast({
        title: "Could not copy",
        description: "Your browser blocked clipboard access. Select the text and copy manually.",
        tone: "error",
      });
      return false;
    },
    [toast],
  );

  const copyMany = useCallback(
    async (values: readonly string[], options?: { noun?: string; onEmpty?: string }) => {
      const unique = Array.from(new Set(values.filter(Boolean)));
      if (unique.length === 0) {
        toast({
          title: options?.onEmpty ?? "Nothing to copy",
          description: "Select at least one lead first.",
          tone: "warning",
        });
        return false;
      }
      return copy(unique.join("\n"), {
        title: `Copied ${unique.length} ${options?.noun ?? "email addresses"}`,
        description: unique.length > 3 ? `${unique.slice(0, 3).join(", ")} +${unique.length - 3} more` : unique.join(", "),
      });
    },
    [copy, toast],
  );

  return { copy, copyMany };
}
