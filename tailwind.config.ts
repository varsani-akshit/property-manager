import type { Config } from "tailwindcss";

// Every colour is a CSS variable (light + dark sets in app/globals.css), exposed
// as RGB channels so Tailwind's opacity modifiers (`bg-muted/50`) keep working.
const rgb = (v: string) => `rgb(var(--${v}) / <alpha-value>)`;

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: rgb("c-sunken"),            // page ground / sidebar rail
        surface: rgb("c-surface"),      // main panel, tables, inputs
        raised: rgb("c-raised"),        // popovers, dialogs, cards
        sunken: rgb("c-sunken"),
        fg: rgb("c-ink"),
        "fg-soft": rgb("c-ink-secondary"),
        muted: rgb("c-hover"),
        "muted-fg": rgb("c-ink-muted"),
        disabled: rgb("c-ink-disabled"),
        border: rgb("c-line"),
        "line-subtle": rgb("c-line-subtle"),
        "line-strong": rgb("c-line-strong"),
        primary: rgb("c-brand"),
        "primary-hover": rgb("c-brand-hover"),
        "primary-soft": rgb("c-brand-soft"),
        "primary-fg": "#ffffff",
        accent: rgb("c-brand"),
        success: rgb("c-success"),
        "success-soft": rgb("c-success-bg"),
        warning: rgb("c-warning"),
        "warning-soft": rgb("c-warning-bg"),
        danger: rgb("c-danger"),
        "danger-soft": rgb("c-danger-bg"),
        info: rgb("c-info"),
        "info-soft": rgb("c-info-bg"),
      },
      fontFamily: {
        sans: ["Geist", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["Geist Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontWeight: {
        book: "450",
      },
      borderRadius: {
        sm: "5px",
        DEFAULT: "7px",
        md: "7px",
        lg: "10px",
        xl: "12px",
        "2xl": "16px",
        "3xl": "20px",
      },
      boxShadow: {
        "token-sm": "var(--shadow-sm)",
        "token-md": "var(--shadow-md)",
        "token-lg": "var(--shadow-lg)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.35s ease-out both",
      },
    },
  },
} satisfies Config;
