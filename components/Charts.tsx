// Pure SVG charts. Server-rendered, no JS, no dependencies.
// All chart heights/widths are responsive via viewBox + className.

export function Sparkline({
  data,
  width = 120,
  height = 32,
  color = "currentColor",
  fillOpacity = 0.15,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fillOpacity?: number;
}) {
  if (!data.length) return <div className="text-xs text-muted-fg">—</div>;
  const min = Math.min(...data, 0);
  const max = Math.max(...data, 0);
  const range = max - min || 1;
  const stepX = data.length > 1 ? width / (data.length - 1) : 0;
  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * height;
    return [x, y] as const;
  });
  const pathLine = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const pathArea = pathLine + ` L${width} ${height} L0 ${height} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-8" preserveAspectRatio="none">
      <path d={pathArea} fill={color} fillOpacity={fillOpacity} />
      <path d={pathLine} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BarChart({
  data,
  height = 160,
  color = "currentColor",
  formatValue = (n: number) => n.toLocaleString(),
  formatLabel = (s: string) => s,
}: {
  data: { label: string; value: number }[];
  height?: number;
  color?: string;
  formatValue?: (n: number) => string;
  formatLabel?: (s: string) => string;
}) {
  if (!data.length) return <p className="text-sm text-muted-fg">No data.</p>;
  const max = Math.max(...data.map((d) => d.value), 0);
  const min = Math.min(...data.map((d) => d.value), 0);
  const range = (max - min) || 1;

  return (
    <div className="space-y-1.5">
      {data.map((d) => {
        const positive = d.value >= 0;
        const pct = Math.abs(d.value) / range * 100;
        return (
          <div key={d.label} className="grid grid-cols-[8rem_1fr_auto] items-center gap-2 text-xs">
            <div className="truncate" title={d.label}>{formatLabel(d.label)}</div>
            <div className="h-5 bg-muted rounded relative overflow-hidden">
              <div
                className="h-full rounded"
                style={{
                  width: `${Math.max(pct, 1)}%`,
                  backgroundColor: positive ? color : "hsl(0 72% 51%)",
                  opacity: 0.85,
                }}
              />
            </div>
            <div className={positive ? "" : "text-danger"}>{formatValue(d.value)}</div>
          </div>
        );
      })}
    </div>
  );
}

export function StackedBarTrend({
  data,
  height = 180,
  formatValue = (n: number) => n.toLocaleString(),
}: {
  data: { label: string; collected: number; costs: number }[];
  height?: number;
  formatValue?: (n: number) => string;
}) {
  if (!data.length) return <p className="text-sm text-muted-fg p-4">No data.</p>;
  const max = Math.max(...data.flatMap((d) => [d.collected, d.costs]), 0);
  const w = 800;
  const innerH = height - 30; // leave room for labels
  const barW = Math.min(48, (w / data.length) * 0.4);
  const groupW = w / data.length;

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full" preserveAspectRatio="none" style={{ minWidth: data.length * 60 }}>
        {/* gridlines */}
        {[0.25, 0.5, 0.75, 1].map((t) => (
          <line key={t} x1="0" x2={w} y1={innerH - innerH * t} y2={innerH - innerH * t} stroke="hsl(214 32% 91%)" strokeDasharray="2 3" />
        ))}
        {data.map((d, i) => {
          const cx = i * groupW + groupW / 2;
          const hCol = (d.collected / (max || 1)) * innerH;
          const hCost = (d.costs / (max || 1)) * innerH;
          return (
            <g key={d.label}>
              <rect x={cx - barW} y={innerH - hCol} width={barW * 0.9} height={hCol} fill="hsl(22 92% 52%)" rx="3">
                <title>Collected {formatValue(d.collected)}</title>
              </rect>
              <rect x={cx + barW * 0.05} y={innerH - hCost} width={barW * 0.9} height={hCost} fill="hsl(24 15% 35%)" rx="3">
                <title>Costs {formatValue(d.costs)}</title>
              </rect>
              <text x={cx} y={height - 10} textAnchor="middle" fontSize="10" fill="hsl(215 16% 47%)">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="flex gap-4 text-xs text-muted-fg mt-2">
        <span><span className="inline-block w-3 h-3 rounded-sm align-middle mr-1" style={{ background: "hsl(22 92% 52%)" }} />Collected</span>
        <span><span className="inline-block w-3 h-3 rounded-sm align-middle mr-1" style={{ background: "hsl(24 15% 35%)" }} />Costs</span>
      </div>
    </div>
  );
}

export function DonutChart({
  data,
  size = 140,
  thickness = 28,
  formatValue = (n: number) => n.toLocaleString(),
}: {
  data: { label: string; value: number; color?: string }[];
  size?: number;
  thickness?: number;
  formatValue?: (n: number) => string;
}) {
  const total = data.reduce((s, d) => s + Math.max(0, d.value), 0);
  if (total <= 0) return <p className="text-sm text-muted-fg">No data.</p>;
  const r = size / 2;
  const innerR = r - thickness;
  const palette = ["hsl(22 92% 52%)","hsl(34 92% 56%)","hsl(45 92% 56%)","hsl(12 80% 55%)","hsl(2 75% 55%)","hsl(160 55% 42%)","hsl(220 70% 55%)","hsl(280 55% 55%)"];

  let acc = 0;
  const slices = data
    .filter((d) => d.value > 0)
    .map((d, i) => {
      const start = (acc / total) * 2 * Math.PI;
      acc += d.value;
      const end = (acc / total) * 2 * Math.PI;
      const large = end - start > Math.PI ? 1 : 0;
      const x1 = r + r * Math.sin(start), y1 = r - r * Math.cos(start);
      const x2 = r + r * Math.sin(end),   y2 = r - r * Math.cos(end);
      const xi1 = r + innerR * Math.sin(end), yi1 = r - innerR * Math.cos(end);
      const xi2 = r + innerR * Math.sin(start), yi2 = r - innerR * Math.cos(start);
      const path = `M${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2} L${xi1} ${yi1} A${innerR} ${innerR} 0 ${large} 0 ${xi2} ${yi2} Z`;
      return { path, color: d.color ?? palette[i % palette.length], label: d.label, value: d.value };
    });

  return (
    <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-32 h-32 shrink-0">
        {slices.map((s, i) => (
          <path key={i} d={s.path} fill={s.color}>
            <title>{s.label}: {formatValue(s.value)}</title>
          </path>
        ))}
      </svg>
      <ul className="space-y-1 text-xs flex-1 min-w-0">
        {slices.map((s, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-sm shrink-0" style={{ background: s.color }} />
            <span className="flex-1 truncate">{s.label}</span>
            <span className="font-medium tabular-nums">{formatValue(s.value)}</span>
            <span className="text-muted-fg tabular-nums">{((s.value / total) * 100).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
