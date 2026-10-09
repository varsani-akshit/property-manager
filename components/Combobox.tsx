"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Click-to-open combobox. Always shows the full options list when focused,
 * filters as the user types, and lets them submit a brand-new value
 * (creating a new category on save).
 *
 * The value is held in a hidden input under `name` so it submits with the
 * surrounding <form action={...}> server action.
 */
export function Combobox({
  name,
  options,
  initial = "",
  placeholder = "Select or type…",
  required,
  className,
  lowercase = false,
  emptyHint = "No matches yet — type to create one.",
}: {
  name: string;
  options: string[];
  initial?: string;
  placeholder?: string;
  required?: boolean;
  className?: string;
  /** Force values to lowercase (used for e.g. cost categories). Default: preserve case (e.g. lessee names). */
  lowercase?: boolean;
  emptyHint?: string;
}) {
  const norm = (s: string) => (lowercase ? s.toLowerCase() : s);
  const [value, setValue] = useState(initial);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const filtered = options.filter((o) =>
    !value.trim() ? true : o.toLowerCase().includes(value.toLowerCase().trim())
  );
  const exactMatch = options.some((o) => o.toLowerCase() === value.trim().toLowerCase());

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <input type="hidden" name={name} value={value} />
      <div className="flex">
        <input
          type="text"
          required={required}
          value={value}
          onChange={(e) => { setValue(norm(e.target.value)); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="input rounded-r-none flex-1"
          autoComplete="off"
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setOpen((o) => !o)}
          className="rounded-r-md border border-l-0 border-border bg-surface px-2 text-muted-fg transition-colors hover:bg-muted hover:text-fg"
          aria-label="Toggle dropdown"
        >
          <ChevronDown size={14} className={cn("transition-transform", open && "rotate-180")} />
        </button>
      </div>
      {open && (
        <div className="popover absolute left-0 right-0 mt-1 max-h-60 overflow-auto">
          {filtered.length === 0 && value.trim() && (
            <button
              type="button"
              onClick={() => { setValue(norm(value.trim())); setOpen(false); }}
              className="popover-item"
            >
              Create new: <span className="font-medium">{value.trim()}</span>
            </button>
          )}
          {filtered.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => { setValue(o); setOpen(false); }}
              className={cn(
                "popover-item",
                value === o && "font-medium text-primary"
              )}
            >
              {o}
            </button>
          ))}
          {!filtered.length && !value.trim() && (
            <div className="px-3 py-2 text-[12px] text-muted-fg">{emptyHint}</div>
          )}
          {value.trim() && !exactMatch && filtered.length > 0 && (
            <button
              type="button"
              onClick={() => { setValue(norm(value.trim())); setOpen(false); }}
              className="popover-item border-t border-line-subtle"
            >
              + Use new: <span className="font-medium">{value.trim()}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
