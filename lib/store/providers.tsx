"use client";

import type { ReactNode } from "react";
import { AuthGate } from "@/components/auth/auth-gate";
import { DiscoveryProvider } from "@/lib/store/discovery";
import { ToastProvider } from "@/lib/store/toast";

/** Single composition point so provider order stays explicit. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <DiscoveryProvider>
        <AuthGate>{children}</AuthGate>
      </DiscoveryProvider>
    </ToastProvider>
  );
}
