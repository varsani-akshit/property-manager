/**
 * The Variaka mark: a "V" whose right arm is a tower — stepped roof, lit
 * windows — and whose left arm is a lighter wing. Drawn in the brand colour.
 * Static copies: public/brand/variaka-mark.svg (bare) and variaka-tile.svg
 * (white on indigo, also app/icon.svg and app/apple-icon.svg).
 */
const WING = "M6 8 L19.5 8 L38.5 56 L25.5 56 Z";
const TOWER = "M44.5 13 L48.5 13 L48.5 8 L58 8 L38.5 56 L25.5 56 Z";
const WINDOWS: [number, number][] = [
  [44.17, 17], [48.83, 17],
  [41.15, 24], [45.92, 24],
  [38.13, 31], [43.0, 31],
];

export function VariakaMark({ size = 20, className }: { size?: number; className?: string }) {
  const brand = "rgb(var(--c-brand))";
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      style={{ flexShrink: 0 }}
      aria-hidden
    >
      <path d={WING} style={{ fill: brand, fillOpacity: 0.5 }} />
      <path d={TOWER} style={{ fill: brand }} />
      {/* windows are lost below ~24px, so the small mark is just the V */}
      {size >= 24 && WINDOWS.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="2.8" height="3" rx="0.45" fill="#fff" />)}
    </svg>
  );
}

/** The mark and the wordmark in caps at 0.16em tracking, then the product after a hairline. */
export function Wordmark({ product = "Properties" }: { product?: string | null }) {
  return (
    <span className="inline-flex items-center gap-[9px] text-fg">
      <VariakaMark size={22} />
      <span className="pt-px text-[13px] font-medium leading-none tracking-[0.16em]">VARIAKA</span>
      {product && (
        <>
          <span className="h-3.5 w-px bg-line-strong" aria-hidden />
          <span className="text-[13px] leading-none text-muted-fg">{product}</span>
        </>
      )}
    </span>
  );
}
