import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rental Manager",
  description: "Property and rental management",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
