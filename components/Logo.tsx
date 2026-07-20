/**
 * Variaka mark — bold "V" chevron with an inset property notch.
 * Reused in the sidebar and the login screen.
 */
export function VariakaMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      aria-hidden
    >
      <rect width="32" height="32" rx="7" fill="hsl(22 92% 52%)" />
      <path d="M6.5 7.5 L16 25.5 L25.5 7.5 L21.2 7.5 L16 18.2 L10.8 7.5 Z" fill="white" />
      <rect x="14.5" y="13" width="3" height="3" fill="hsl(22 92% 52%)" />
    </svg>
  );
}
