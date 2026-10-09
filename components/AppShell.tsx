"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Sidebar } from "./Sidebar";
import type { UserProfile } from "@/lib/permissions";
import { Wordmark } from "./Logo";

/**
 * Signed-in layout: the sidebar rail on the sunken ground, and the page on a
 * raised panel with a rounded top-left corner. The panel scrolls, not the window.
 *   - lg+: rail always visible.
 *   - <lg: a top bar with a menu button; the rail slides in as a drawer.
 */
export function AppShell({ profile, children }: { profile: UserProfile; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer on navigation and on Escape.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="flex h-dvh overflow-hidden bg-sunken">
      <aside className="hidden h-full w-[216px] shrink-0 lg:block">
        <Sidebar profile={profile} />
      </aside>

      {open && (
        <div className="fixed inset-0 z-[80] lg:hidden">
          <button
            type="button"
            className="absolute inset-0 animate-[fade-in_0.2s_ease-out_both]"
            style={{ background: "var(--overlay)" }}
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          />
          <div className="absolute inset-y-0 left-0 w-[85vw] max-w-[300px] shadow-token-lg">
            <Sidebar profile={profile} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col lg:pt-2">
        <header className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-3 py-2 lg:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="btn-ghost !p-1.5"
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
          <Wordmark />
        </header>

        <main
          id="main-scroll"
          className="min-h-0 flex-1 overflow-y-auto bg-surface px-4 pb-12 shadow-token-sm sm:px-5 md:px-8 lg:rounded-tl-2xl lg:border-l lg:border-t lg:border-border"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
