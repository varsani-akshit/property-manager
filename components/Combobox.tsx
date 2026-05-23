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
}: {
  name: string;
  options: string[];
  initial?: string;
  placeholder?: string;
  required?: boolean;
  className?: string;
}) {
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
          onChange={(e) => { setValue(e.target.value.toLowerCase()); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="input rounded-r-none flex-1"
          autoComplete="off"
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setOpen((o) => !o)}
          className="px-2 border border-l-0 border-border rounded-r-md bg-bg hover:bg-muted"
          aria-label="Toggle dropdown"
        >
          <ChevronDown size={14} className={cn("transition-transform", open && "rotate-180")} />
        </button>
      </div>
      {open && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-bg border border-border rounded-md shadow-lg max-h-60 overflow-auto">
          {filtered.length === 0 && value.trim() && (
            <button
              type="button"
              onClick={() => { setValue(value.trim().toLowerCase()); setOpen(false); }}
              className="block w-full text-left px-3 py-2 text-sm hover:bg-muted"
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
                "block w-full text-left px-3 py-2 text-sm hover:bg-muted",
                value === o && "bg-muted/60 font-medium"
              )}
            >
              {o}
            </button>
          ))}
          {!filtered.length && !value.trim() && (
            <div className="px-3 py-2 text-xs text-muted-fg">No categories yet — type to create one.</div>
          )}
          {value.trim() && !exactMatch && filtered.length > 0 && (
            <button
              type="button"
              onClick={() => { setValue(value.trim().toLowerCase()); setOpen(false); }}
              className="block w-full text-left px-3 py-2 text-sm border-t border-border hover:bg-muted"
            >
              + Use new: <span className="font-medium">{value.trim()}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
