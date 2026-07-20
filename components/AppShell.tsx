"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { cn } from "@/lib/cn";
import type { UserProfile } from "@/lib/permissions";
import { VariakaMark } from "./Logo";

/**
 * Responsive shell:
 *   - lg+: classic two-pane layout, sidebar always visible.
 *   - <lg: hamburger top bar; sidebar slides in as a drawer with backdrop.
 *
 * Closes the drawer automatically on navigation.
 */
export function AppShell({ profile, children }: { profile: UserProfile; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Auto-close drawer on route change
  useEffect(() => { setOpen(false); }, [pathname]);

  // Lock body scroll while drawer is open
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <div className="flex min-h-screen">
      {/* Mobile backdrop */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      {/* Sidebar — drawer on mobile, sticky on desktop so it stays in view while scrolling */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 w-60 z-50 transform transition-transform duration-200 ease-out",
          "lg:sticky lg:top-0 lg:h-screen lg:self-start lg:translate-x-0 lg:z-auto",
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        <Sidebar profile={profile} onNavigate={() => setOpen(false)} mobileClose={() => setOpen(false)} />
      </div>

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile top bar (visible only <lg) */}
        <header className="lg:hidden sticky top-0 z-30 flex items-center gap-3 px-3 py-2 border-b border-border bg-bg">
          <button
            onClick={() => setOpen(true)}
            className="p-2 rounded-md hover:bg-muted"
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2 font-semibold tracking-tight">
            <VariakaMark size={20} />
            <span>Variaka</span>
          </div>
        </header>

        <main className="flex-1 min-w-0 p-3 sm:p-4 md:p-6 bg-muted/30">
          {children}
        </main>
      </div>
    </div>
  );
}

export function CloseDrawerButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="lg:hidden p-1 rounded-md hover:bg-muted" aria-label="Close menu">
      <X size={16} />
    </button>
  );
}
