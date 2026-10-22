import { cn } from "@/lib/utils";

export function Logo({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[9px] bg-gradient-to-br from-accent-500 via-accent-600 to-accent-800 text-white shadow-card",
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        width={size * 0.62}
        height={size * 0.62}
        strokeWidth="2.4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4.5 11.5a6.5 6.5 0 1 1 11.2 4.5" opacity="0.55" />
        <path d="m10.5 15.5 3 3 6-7" />
      </svg>
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <Logo />
      <span className="flex flex-col leading-none">
        <span className="text-[15px] font-semibold tracking-tight text-ink">Aplify</span>
        <span className="mt-0.5 text-[10px] font-medium tracking-wide text-ink-faint uppercase">
          Lead intelligence
        </span>
      </span>
    </span>
  );
}
