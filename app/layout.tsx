import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rental Manager",
  description: "Property and rental management",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning silences harmless mismatches from browser extensions
    // (Grammarly, Dark Reader, password managers, etc.) that inject attrs into body.
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
