"use client";

import type { ReactNode } from "react";
import { DiscoveryProvider } from "@/lib/store/discovery";
import { ToastProvider } from "@/lib/store/toast";

/** Single composition point so provider order stays explicit. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <DiscoveryProvider>{children}</DiscoveryProvider>
    </ToastProvider>
  );
}
