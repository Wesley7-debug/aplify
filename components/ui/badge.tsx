import { cn } from "@/lib/utils";

export type BadgeTone =
  | "neutral"
  | "accent"
  | "positive"
  | "caution"
  | "danger"
  | "info"
  | "outline";
export type BadgeSize = "xs" | "sm" | "md";

const TONES: Record<BadgeTone, string> = {
  neutral: "border-line bg-surface-sunken text-ink-soft",
  accent: "border-accent-200 bg-accent-50 text-accent-700",
  positive: "border-positive-100 bg-positive-50 text-positive-700",
  caution: "border-caution-100 bg-caution-50 text-caution-700",
  danger: "border-danger-100 bg-danger-50 text-danger-700",
  info: "border-info-50 bg-info-50 text-info-700",
  outline: "border-line-strong bg-transparent text-ink-soft",
};

const SIZES: Record<BadgeSize, string> = {
  xs: "h-5 gap-1 rounded-md px-1.5 text-[10.5px] font-medium tracking-wide",
  sm: "h-6 gap-1.5 rounded-md px-2 text-[11px] font-medium",
  md: "h-7 gap-1.5 rounded-lg px-2.5 text-xs font-medium",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  size?: BadgeSize;
  icon?: React.ReactNode;
  dot?: boolean;
}

export function Badge({
  tone = "neutral",
  size = "sm",
  icon,
  dot = false,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center border whitespace-nowrap",
        TONES[tone],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {dot ? <span className="size-1.5 rounded-full bg-current opacity-70" aria-hidden /> : null}
      {icon}
      {children}
    </span>
  );
}
