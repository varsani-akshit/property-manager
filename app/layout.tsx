import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { NavProgress } from "@/components/NavProgress";
import "./globals.css";

export const metadata: Metadata = {
  title: "Variaka",
  description: "Variaka — property portfolio management",
};

export const viewport: Viewport = {
  themeColor: "#f5f5f5",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning silences harmless mismatches from browser extensions
    // (Grammarly, password managers) that inject attributes into body.
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preload" href="/fonts/geist.woff2" as="font" type="font/woff2" crossOrigin="" />
      </head>
      <body suppressHydrationWarning>
        <Suspense fallback={null}>
          <NavProgress />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
