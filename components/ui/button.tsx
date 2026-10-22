"use client";

import { forwardRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "subtle"
  | "danger"
  | "link";
export type ButtonSize = "sm" | "md" | "lg" | "icon" | "icon-sm";

const VARIANT_STYLES: Record<ButtonVariant, string> = {
  primary:
    "bg-accent-700 text-white shadow-card hover:bg-accent-600 active:bg-accent-800 disabled:bg-accent-300",
  secondary:
    "border border-line-strong bg-surface text-ink shadow-card hover:border-ink-faint hover:bg-surface-muted active:bg-surface-sunken",
  ghost: "text-ink-soft hover:bg-surface-sunken hover:text-ink",
  subtle: "bg-accent-50 text-accent-700 hover:bg-accent-100 active:bg-accent-200",
  danger: "bg-danger-600 text-white hover:bg-danger-700 active:bg-danger-700",
  link: "text-accent-700 underline-offset-4 hover:underline",
};

const SIZE_STYLES: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 rounded-lg px-3 text-xs",
  md: "h-9.5 gap-2 rounded-xl px-4 text-sm",
  lg: "h-11 gap-2 rounded-xl px-5 text-sm",
  icon: "size-9.5 rounded-xl",
  "icon-sm": "size-8 rounded-lg",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    loading = false,
    icon,
    iconRight,
    className,
    children,
    disabled,
    type = "button",
    ...props
  },
  ref,
) {
  const isIconOnly = size === "icon" || size === "icon-sm";
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center font-medium transition-all duration-150",
        "disabled:pointer-events-none disabled:opacity-55",
        VARIANT_STYLES[variant],
        SIZE_STYLES[size],
        isIconOnly && "p-0",
        className,
      )}
      {...props}
    >
      {loading ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : (
        icon
      )}
      {children ? <span className={cn(isIconOnly && "sr-only")}>{children}</span> : null}
      {iconRight}
    </button>
  );
});

/** Button-styled anchor for external evidence links. */
export function LinkButton({
  className,
  variant = "secondary",
  size = "md",
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <a
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 font-medium transition-all duration-150",
        VARIANT_STYLES[variant],
        SIZE_STYLES[size],
        className,
      )}
      {...props}
    />
  );
}
