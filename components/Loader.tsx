import { cn } from "@/lib/cn";

/**
 * Variaka's loader: a little skyline of four blocks that rise and settle in a
 * wave, like floors going up. Sizes: `xs` sits inside buttons and inputs,
 * `sm` next to text, `md` for panels and whole pages.
 */
export function Loader({
  size = "sm",
  className,
  tone = "brand",
}: {
  size?: "xs" | "sm" | "md";
  className?: string;
  /** `current` follows the text colour (e.g. white inside a primary button). */
  tone?: "brand" | "current";
}) {
  const dims = { xs: "h-3 gap-[1.5px]", sm: "h-4 gap-[2px]", md: "h-7 gap-[3px]" }[size];
  const bar = { xs: "w-[2.5px]", sm: "w-[3px]", md: "w-[5px]" }[size];
  return (
    <span role="status" aria-label="Loading" className={cn("vk-loader inline-flex items-end", dims, className)}>
      {[0.55, 0.9, 0.7, 1].map((h, i) => (
        <span
          key={i}
          className={cn("vk-loader-bar rounded-[1px]", bar, tone === "brand" ? "bg-primary" : "bg-current")}
          style={{ height: `${h * 100}%`, animationDelay: `${i * 110}ms`, opacity: tone === "brand" ? 0.55 + i * 0.15 : 1 }}
        />
      ))}
    </span>
  );
}

/** Loader with a caption, centred in its box — for panels and route transitions. */
export function LoaderBlock({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 py-16 text-[12.5px] text-muted-fg", className)}>
      <Loader size="md" />
      <span>{label}</span>
    </div>
  );
}
