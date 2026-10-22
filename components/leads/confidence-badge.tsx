"use client";

import { ShieldCheck, ShieldHalf, ShieldQuestion } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { ConfidenceLevel } from "@/lib/types";

const CONFIDENCE_META: Record<
  ConfidenceLevel,
  { label: string; tone: BadgeTone; icon: React.ReactNode }
> = {
  high: {
    label: "High confidence",
    tone: "positive",
    icon: <ShieldCheck className="size-3" />,
  },
  medium: {
    label: "Medium confidence",
    tone: "accent",
    icon: <ShieldHalf className="size-3" />,
  },
  low: {
    label: "Low confidence",
    tone: "caution",
    icon: <ShieldQuestion className="size-3" />,
  },
};

export function ConfidenceBadge({
  level,
  size = "sm",
}: {
  level: ConfidenceLevel;
  size?: "xs" | "sm" | "md";
}) {
  const meta = CONFIDENCE_META[level];
  return (
    <Badge tone={meta.tone} size={size} icon={meta.icon}>
      {meta.label}
    </Badge>
  );
}
