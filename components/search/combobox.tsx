"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ComboboxOption {
  value: string;
  label: string;
  hint?: string;
}

/**
 * Text input with a typeahead list. Used for the business type (local
 * suggestions) and the location (suggestions fetched from the geocoder).
 */
export function Combobox({
  value,
  onChange,
  onSelect,
  options,
  placeholder,
  ariaLabel,
  icon,
  loading = false,
  maxLength,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (option: ComboboxOption) => void;
  options: ComboboxOption[];
  placeholder?: string;
  ariaLabel: string;
  icon?: ReactNode;
  loading?: boolean;
  maxLength?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const activeIndex = options.length > 0 ? Math.min(active, options.length - 1) : 0;
  const showList = open && options.length > 0;

  const choose = (option: ComboboxOption) => {
    onChange(option.value);
    onSelect?.(option);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {icon ? (
        <span
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint"
          aria-hidden
        >
          {icon}
        </span>
      ) : null}

      <input
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => {
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (!showList) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive(Math.min(activeIndex + 1, options.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive(Math.max(activeIndex - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            choose(options[activeIndex]);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList ? `${listId}-${activeIndex}` : undefined}
        autoComplete="off"
        maxLength={maxLength}
        className={cn(
          "h-10 w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint",
          icon ? "pr-9 pl-9" : "pr-9 pl-3",
        )}
      />

      {loading ? (
        <Loader2
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-ink-faint"
          aria-hidden
        />
      ) : null}

      {showList ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-[calc(100%+6px)] z-50 max-h-64 overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-overlay"
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
            >
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(option)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors",
                  index === activeIndex
                    ? "bg-accent-50 text-accent-700"
                    : "text-ink hover:bg-surface-muted",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{option.label}</span>
                  {option.hint ? (
                    <span className="block truncate text-[11px] text-ink-muted">{option.hint}</span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
