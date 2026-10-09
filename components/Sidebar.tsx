"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import {
  LayoutDashboard, Building2, Landmark, FileSignature, Wallet, ReceiptText, Wrench, Users,
  LogOut, X, ChevronUp, Banknote, BellRing, History, KeyRound,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { has, type Permission, type UserProfile } from "@/lib/permissions";
import { Wordmark } from "./Logo";
import { Loader } from "./Loader";

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard; perm: Permission };

const NAV: NavItem[] = [
  { href: "/",                label: "Dashboard",       icon: LayoutDashboard, perm: "view_dashboard" },
  { href: "/compounds",       label: "Compounds",       icon: Landmark,        perm: "view_compounds" },
  { href: "/properties",      label: "Properties",      icon: Building2,       perm: "view_properties" },
  { href: "/leases",          label: "Leases",          icon: FileSignature,   perm: "view_leases" },
  { href: "/rent",            label: "Rent Collection", icon: Wallet,          perm: "view_rent" },
  { href: "/payments",        label: "Payments",        icon: Banknote,        perm: "view_rent" },
  { href: "/reminders",       label: "Reminders",       icon: BellRing,        perm: "view_rent" },
  { href: "/costs",           label: "Costs",           icon: ReceiptText,     perm: "view_costs" },
  { href: "/service-charges", label: "Service Charges", icon: Wrench,          perm: "view_service_charges" },
];

const ADMIN_NAV: NavItem[] = [
  { href: "/users",          label: "Team",            icon: Users,    perm: "manage_users" },
  { href: "/audit",          label: "Audit trail",     icon: History,  perm: "manage_users" },
  { href: "/admin/api-keys", label: "API keys & MCP",  icon: KeyRound, perm: "manage_users" },
];

const ITEM = "group mx-2 flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13.5px] leading-5 transition-colors duration-150";

/** "Akshit Varsani" → "AV"; an email falls back to the first two letters of its name part. */
function initials(fullName: string | null, email: string) {
  const words = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length) return words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  return email.split("@")[0]!.replace(/[^a-z]/gi, "").slice(0, 2).toUpperCase() || "?";
}

export function Sidebar({ profile, onNavigate }: { profile: UserProfile; onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  async function signOut() {
    setSigningOut(true);
    await supabaseBrowser().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const main = NAV.filter((n) => has(profile, n.perm));
  const admin = ADMIN_NAV.filter((n) => has(profile, n.perm));
  const name = profile.full_name || profile.email;

  const link = (n: NavItem) => {
    const Icon = n.icon;
    const active = isActive(n.href);
    return (
      <Link
        key={n.href}
        href={n.href}
        onClick={onNavigate}
        prefetch
        aria-current={active ? "page" : undefined}
        className={cn(
          ITEM,
          active
            ? "bg-raised text-fg shadow-token-sm ring-1 ring-line-subtle"
            : "text-fg-soft hover:bg-muted hover:text-fg"
        )}
      >
        <Icon size={17} strokeWidth={1.6} className={cn("shrink-0", active ? "text-primary" : "opacity-80")} />
        <span className="flex-1 truncate">{n.label}</span>
      </Link>
    );
  };

  return (
    <div className="flex h-full flex-col bg-sunken">
      <div className="flex items-center justify-between px-4 pb-4 pt-5">
        <Link href="/" onClick={onNavigate} aria-label="Variaka home">
          <Wordmark />
        </Link>
        {onNavigate && (
          <button
            type="button"
            onClick={onNavigate}
            className="rounded-md p-1.5 text-muted-fg hover:bg-muted lg:hidden"
            aria-label="Close menu"
          >
            <X size={16} />
          </button>
        )}
      </div>

      <nav className="mt-2 flex flex-1 flex-col space-y-px overflow-y-auto">
        {main.map(link)}
        {admin.length > 0 && (
          <>
            <div className="eyebrow mx-4 mb-1 mt-5 !text-[10px]">Admin</div>
            {admin.map(link)}
          </>
        )}
      </nav>

      <div className="mt-auto border-t border-line-subtle p-2">
        <div ref={menuRef} className="relative">
          {menuOpen && (
            <div className="absolute bottom-[calc(100%+6px)] left-0 z-50 w-[256px] max-w-[calc(100vw-24px)] animate-fade-in overflow-hidden rounded-xl border border-border bg-raised shadow-token-lg">
              <div className="flex items-center justify-between gap-2 border-b border-line-subtle px-3 py-2.5">
                <div className="min-w-0 truncate text-[12px] text-muted-fg">{profile.email}</div>
                <button
                  type="button"
                  onClick={signOut}
                  disabled={signingOut}
                  className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-primary hover:opacity-80 disabled:opacity-60"
                >
                  {signingOut ? <Loader size="xs" /> : <LogOut size={12} />} Log out
                </button>
              </div>
              <div className="px-3 py-2.5">
                <div className="eyebrow !text-[10px]">Signed in as</div>
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <span className="truncate text-[13.5px] font-semibold text-fg">{name}</span>
                  <span className="shrink-0 text-[11px] text-muted-fg">{profile.is_admin ? "Admin" : "Member"}</span>
                </div>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-muted"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
              {initials(profile.full_name, profile.email)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-book leading-[19.5px] text-fg">{name}</span>
              <span className="block truncate text-[11px] text-muted-fg">{profile.is_admin ? "Admin" : "Member"}</span>
            </span>
            <ChevronUp size={14} className={cn("text-muted-fg transition-transform", !menuOpen && "rotate-180")} />
          </button>
        </div>
      </div>
    </div>
  );
}
