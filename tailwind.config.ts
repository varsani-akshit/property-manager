import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "hsl(30 25% 98%)",            // warm cream-white app background
        surface: "hsl(0 0% 100%)",         // pure white for cards
        fg: "hsl(24 15% 18%)",             // warm dark for text
        "fg-soft": "hsl(24 10% 35%)",
        muted: "hsl(28 30% 95%)",          // very light warm tint
        "muted-fg": "hsl(24 10% 50%)",
        border: "hsl(28 25% 90%)",
        primary: "hsl(22 92% 52%)",        // vibrant orange
        "primary-hover": "hsl(22 92% 46%)",
        "primary-soft": "hsl(22 92% 95%)", // for badge backgrounds
        "primary-fg": "hsl(0 0% 100%)",
        accent: "hsl(22 92% 52%)",
        success: "hsl(142 65% 42%)",
        "success-soft": "hsl(142 50% 94%)",
        warning: "hsl(38 92% 50%)",
        "warning-soft": "hsl(38 92% 94%)",
        danger: "hsl(0 72% 51%)",
        "danger-soft": "hsl(0 70% 96%)",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Inter", "Roboto", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(0 0 0 / 0.04), 0 1px 3px 0 rgb(0 0 0 / 0.04)",
        "card-hover": "0 4px 8px -2px rgb(0 0 0 / 0.06), 0 4px 6px -4px rgb(0 0 0 / 0.04)",
        kpi: "0 1px 0 0 rgb(0 0 0 / 0.03), 0 4px 14px -8px rgb(234 88 12 / 0.18)",
      },
      borderRadius: {
        xl: "0.875rem",
      },
    },
  },
} satisfies Config;
