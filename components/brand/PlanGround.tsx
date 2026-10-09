/**
 * Ground for the sign-in screens: a drafting grid that fades out toward the
 * centre, dressed like a sheet from the architect's set — a floor plan across
 * the lower right, structural grid bubbles down the left edge, a north arrow
 * and scale bar top right, and the sheet's title block bottom left. Phones get
 * the plan and the north arrow only.
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

      {/* structural grid bubbles, left edge */}
      <svg viewBox="0 0 220 420" className="absolute left-0 top-[18%] hidden w-[220px] sm:block" fill="none" stroke={ink}>
        <defs>
          <linearGradient id="pg-fade" x1="0" x2="1">
            <stop offset="0.15" stopColor="white" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </linearGradient>
          <mask id="pg-fade-mask"><rect width="220" height="420" fill="url(#pg-fade)" /></mask>
        </defs>
        <g mask="url(#pg-fade-mask)" strokeOpacity="0.16" strokeWidth="1" strokeDasharray="10 4 2 4">
          {[30, 150, 270, 390].map((y) => <path key={y} d={`M46 ${y} H220`} />)}
        </g>
        <g strokeOpacity="0.2" strokeWidth="1.2">
          {[30, 150, 270, 390].map((y) => <circle key={y} cx="28" cy={y} r="13" />)}
        </g>
        <g fill={ink} fillOpacity="0.32" stroke="none" fontFamily="Geist Mono, ui-monospace, monospace" fontSize="11" textAnchor="middle">
          {["A", "B", "C", "D"].map((t, i) => <text key={t} x="28" y={30 + i * 120 + 4}>{t}</text>)}
        </g>
      </svg>

      {/* north arrow and scale bar, upper right */}
      <svg viewBox="0 0 230 150" className="absolute right-1 top-14 w-[150px] opacity-80 sm:right-8 sm:top-6 sm:w-[230px] sm:opacity-100" fill="none" stroke={ink}>
        <g strokeOpacity="0.2" strokeWidth="1.2">
          <circle cx="186" cy="52" r="26" />
          <path d="M186 20 V84 M154 52 H218" strokeOpacity="0.6" strokeDasharray="2 3" />
        </g>
        <path d="M186 28 L196 64 L186 57 L176 64 Z" fill={ink} fillOpacity="0.2" stroke="none" />
        <g strokeOpacity="0.22" strokeWidth="1">
          <rect x="20" y="118" width="160" height="6" />
          <path d="M60 118 V124 M100 118 V124 M140 118 V124" />
        </g>
        <path d="M20 118 H60 V124 H20 Z M100 118 H140 V124 H100 Z" fill={ink} fillOpacity="0.14" stroke="none" />
        <g fill={ink} fillOpacity="0.32" stroke="none" fontFamily="Geist Mono, ui-monospace, monospace" fontSize="9" letterSpacing="1">
          <text x="182" y="12">N</text>
          <text x="17" y="140">0</text>
          <text x="57" y="140">2</text>
          <text x="97" y="140">4</text>
          <text x="137" y="140">6</text>
          <text x="166" y="140">8 M</text>
        </g>
      </svg>

      {/* title block, lower left */}
      <svg viewBox="0 0 280 112" className="absolute bottom-6 left-8 hidden w-[280px] md:block" fill="none" stroke={ink}>
        <g strokeOpacity="0.2" strokeWidth="1">
          <rect x="0.5" y="0.5" width="279" height="111" />
          <path d="M0 38 H280 M0 75 H280 M140 38 V112" />
        </g>
        <g fill={ink} stroke="none" fontFamily="Geist Mono, ui-monospace, monospace" letterSpacing="1.2">
          <g fillOpacity="0.26" fontSize="7.5">
            <text x="10" y="13">PROJECT</text>
            <text x="10" y="50">SHEET</text>
            <text x="150" y="50">SCALE</text>
            <text x="10" y="87">DRAWING</text>
            <text x="150" y="87">STATUS</text>
          </g>
          <g fillOpacity="0.38" fontSize="10.5">
            <text x="10" y="29">VARIAKA · PROPERTIES</text>
            <text x="10" y="66">A-101</text>
            <text x="150" y="66">1 : 100</text>
            <text x="10" y="103">GROUND FLOOR</text>
            <text x="150" y="103">ISSUED</text>
          </g>
        </g>
      </svg>

      {/* floor plan, lower right */}
      <svg
        viewBox="0 0 640 480"
        className="absolute -bottom-10 -right-[25%] w-[120vw] max-w-[640px] sm:-bottom-16 sm:-right-24 sm:w-[min(56vw,640px)]"
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
