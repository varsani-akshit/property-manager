/**
 * Ground for the sign-in screens: a drafting grid that fades out toward the
 * centre, with a faint floor plan (walls, door swings, dimension lines) drawn
 * across the lower right — like a sheet from the architect's set.
 */
export function PlanGround({ className }: { className?: string }) {
  const ink = "rgb(var(--c-brand))";
  return (
    <div className={className} aria-hidden>
      {/* grid: fine lines every 24px, heavier every 120px */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: [
            "linear-gradient(rgb(var(--c-brand) / 0.07) 1px, transparent 1px)",
            "linear-gradient(90deg, rgb(var(--c-brand) / 0.07) 1px, transparent 1px)",
            "linear-gradient(rgb(var(--c-ink) / 0.035) 1px, transparent 1px)",
            "linear-gradient(90deg, rgb(var(--c-ink) / 0.035) 1px, transparent 1px)",
          ].join(","),
          backgroundSize: "120px 120px, 120px 120px, 24px 24px, 24px 24px",
          maskImage: "radial-gradient(ellipse 70% 65% at 50% 45%, transparent 20%, black 85%)",
          WebkitMaskImage: "radial-gradient(ellipse 70% 65% at 50% 45%, transparent 20%, black 85%)",
        }}
      />

      {/* floor plan, lower right */}
      <svg
        viewBox="0 0 640 480"
        className="absolute -bottom-16 -right-24 w-[min(56vw,640px)]"
        fill="none"
        stroke={ink}
        strokeLinecap="square"
      >
        <g strokeOpacity="0.16" strokeWidth="5">
          {/* outer walls, with gaps for the entrance and windows */}
          <path d="M40 40 H300 M340 40 H600 V250 M600 300 V440 H400 M350 440 H40 V40" />
          {/* interior walls */}
          <path d="M260 40 V150 M260 200 V300 H130 M90 300 H40" />
          <path d="M260 300 V440" />
          <path d="M420 40 V180 H470 M520 180 H600" />
          <path d="M420 300 H600" />
        </g>
        <g strokeOpacity="0.16" strokeWidth="1.5">
          {/* door swings */}
          <path d="M260 150 A50 50 0 0 1 310 200" />
          <path d="M260 150 L310 150" strokeDasharray="2 4" />
          <path d="M130 300 A40 40 0 0 0 90 260" />
          <path d="M470 180 A50 50 0 0 1 520 230" />
          <path d="M350 440 A50 50 0 0 1 400 390" />
          {/* windows */}
          <path d="M300 34 V46 M340 34 V46 M302 40 H338" />
          <path d="M594 250 H606 M594 300 H606 M600 252 V298" />
          {/* kitchen counter and fixtures */}
          <path d="M430 60 H590 V90 H430 Z" />
          <circle cx="470" cy="75" r="9" />
          <path d="M60 330 H120 V420 H60 Z M70 340 H110 V380 H70 Z" />
          <rect x="300" y="330" width="80" height="50" rx="6" />
        </g>
        <g strokeOpacity="0.14" strokeWidth="1">
          {/* dimension lines with ticks */}
          <path d="M40 16 H600 M40 10 V22 M260 10 V22 M600 10 V22" />
          <path d="M624 40 V440 M618 40 H630 M618 300 H630 M618 440 H630" />
        </g>
        <g fill={ink} fillOpacity="0.26" stroke="none" fontFamily="Geist Mono, ui-monospace, monospace" fontSize="10" letterSpacing="1.5">
          <text x="140" y="12">6.80 M</text>
          <text x="420" y="12">9.10 M</text>
          <text x="110" y="180">LIVING</text>
          <text x="310" y="120">BEDROOM</text>
          <text x="470" y="140">KITCHEN</text>
          <text x="140" y="380">BATH</text>
          <text x="470" y="380">STORE</text>
        </g>
      </svg>
    </div>
  );
}
