import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "hsl(30 25% 97%)",             // warm cream page background
        surface: "hsl(0 0% 100%)",          // white for tables/inputs
        fg: "hsl(24 15% 18%)",
        "fg-soft": "hsl(24 10% 35%)",
        muted: "hsl(28 25% 94%)",
        "muted-fg": "hsl(24 10% 50%)",
        border: "hsl(28 20% 87%)",
        primary: "hsl(22 92% 52%)",
        "primary-hover": "hsl(22 92% 46%)",
        "primary-soft": "hsl(22 92% 95%)",
        "primary-fg": "hsl(0 0% 100%)",
        accent: "hsl(22 92% 52%)",
        success: "hsl(142 65% 38%)",
        "success-soft": "hsl(142 50% 93%)",
        warning: "hsl(38 92% 48%)",
        "warning-soft": "hsl(38 92% 93%)",
        danger: "hsl(0 72% 48%)",
        "danger-soft": "hsl(0 70% 95%)",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Inter", "Roboto", "sans-serif"],
      },
      borderRadius: {
        DEFAULT: "0.25rem",
        sm: "0.125rem",
        md: "0.25rem",
        lg: "0.375rem",
      },
    },
  },
} satisfies Config;
