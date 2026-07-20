"use client";
import { useMemo, useState } from "react";
import { Combobox } from "./Combobox";

/**
 * Compound picker with app-styled combobox instead of the browser default
 * <select>. Submits the selected compound_id via a hidden input under `name`.
 */
export function CompoundPicker({
  compounds,
  name = "compound_id",
  initial,
  required = true,
}: {
  compounds: { id: string; name: string }[];
  name?: string;
  initial?: string;
  required?: boolean;
}) {
  const labels = useMemo(() => compounds.map((c) => c.name).sort((a, b) => a.localeCompare(b)), [compounds]);
  const idByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of compounds) m.set(c.name, c.id);
    return m;
  }, [compounds]);
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of compounds) m.set(c.id, c.name);
    return m;
  }, [compounds]);

  const [label, setLabel] = useState<string>(initial ? nameById.get(initial) ?? "" : "");
  const resolvedId = idByName.get(label.trim()) ?? "";

  return (
    <>
      <input type="hidden" name={name} value={resolvedId} required={required} />
      {/* Track selection via a controlled Combobox — we mirror its value into `label`. */}
      <ControlledCombobox
        options={labels}
        initial={label}
        placeholder="Pick a compound"
        required={required}
        onChange={setLabel}
      />
    </>
  );
}

// Small wrapper that surfaces the current text of a Combobox via onChange.
// We wrap Combobox rather than mutating it to keep its internals encapsulated.
function ControlledCombobox({
  options,
  initial,
  placeholder,
  required,
  onChange,
}: {
  options: string[];
  initial: string;
  placeholder?: string;
  required?: boolean;
  onChange: (v: string) => void;
}) {
  // Use an onBlur bridge: read the hidden input written by Combobox.
  return (
    <div
      onBlur={(e) => {
        const wrap = e.currentTarget;
        const input = wrap.querySelector('input[type="hidden"]') as HTMLInputElement | null;
        if (input) onChange(input.value);
      }}
      onClick={(e) => {
        // Also sync on any click inside (dropdown option pick fires here after state updates).
        const wrap = e.currentTarget;
        requestAnimationFrame(() => {
          const input = wrap.querySelector('input[type="hidden"]') as HTMLInputElement | null;
          if (input) onChange(input.value);
        });
      }}
    >
      <Combobox
        name="__compound_label"
        options={options}
        initial={initial}
        placeholder={placeholder}
        required={required}
        emptyHint="No compounds yet."
      />
    </div>
  );
}
