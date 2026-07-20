"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { LayoutDashboard, Building2, Landmark, FileSignature, Wallet, ReceiptText, Wrench, Users, LogOut, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { has, type Permission, type UserProfile } from "@/lib/permissions";
import { VariakaMark } from "./Logo";

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard; perm: Permission };

const NAV: NavItem[] = [
  { href: "/",                label: "Dashboard",       icon: LayoutDashboard, perm: "view_dashboard" },
  { href: "/compounds",       label: "Compounds",       icon: Landmark,        perm: "view_compounds" },
  { href: "/properties",      label: "Properties",      icon: Building2,       perm: "view_properties" },
  { href: "/leases",          label: "Leases",          icon: FileSignature,   perm: "view_leases" },
  { href: "/rent",            label: "Rent Collection", icon: Wallet,          perm: "view_rent" },
  { href: "/costs",           label: "Costs",           icon: ReceiptText,     perm: "view_costs" },
  { href: "/service-charges", label: "Service Charges", icon: Wrench,          perm: "view_service_charges" },
  { href: "/users",           label: "Users",           icon: Users,           perm: "manage_users" },
];

export function Sidebar({
  profile,
  onNavigate,
  mobileClose,
}: {
  profile: UserProfile;
  onNavigate?: () => void;
  mobileClose?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const visible = NAV.filter((n) => has(profile, n.perm));

  return (
    <aside className="w-60 h-full border-r border-border bg-surface flex flex-col">
      <div className="p-4 border-b border-border flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold flex items-center gap-2 tracking-tight">
            <VariakaMark size={22} />
            <span>Variaka</span>
          </div>
          <div className="text-xs text-muted-fg truncate mt-1">{profile.email}</div>
        </div>
        {mobileClose && (
          <button onClick={mobileClose} className="lg:hidden p-1 rounded-md hover:bg-muted shrink-0" aria-label="Close menu">
            <X size={16} />
          </button>
        )}
      </div>
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {visible.map((n) => {
          const Icon = n.icon;
          const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              onClick={onNavigate}
              prefetch
              className={cn("nav-link", active ? "nav-link-active" : "nav-link-inactive")}
            >
              <Icon size={16} />
              <span>{n.label}</span>
            </Link>
          );
        })}
      </nav>
      <button onClick={signOut} className="m-2 btn-ghost text-sm">
        <LogOut size={14} /> Sign out
      </button>
    </aside>
  );
}
