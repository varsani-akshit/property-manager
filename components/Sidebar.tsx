"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { Home, Building2, FileText, Banknote, Receipt, Users, LogOut, Building } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { has, type Permission, type UserProfile } from "@/lib/permissions";

type NavItem = { href: string; label: string; icon: typeof Home; perm: Permission };

const NAV: NavItem[] = [
  { href: "/",            label: "Dashboard",       icon: Home,     perm: "view_dashboard" },
  { href: "/compounds",   label: "Compounds",       icon: Building, perm: "view_compounds" },
  { href: "/properties",  label: "Properties",      icon: Building2,perm: "view_properties" },
  { href: "/leases",      label: "Leases",          icon: FileText, perm: "view_leases" },
  { href: "/rent",        label: "Rent Collection", icon: Banknote, perm: "view_rent" },
  { href: "/costs",       label: "Costs",           icon: Receipt,  perm: "view_costs" },
  { href: "/users",       label: "Users",           icon: Users,    perm: "manage_users" },
];

export function Sidebar({ profile }: { profile: UserProfile }) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const visible = NAV.filter((n) => has(profile, n.perm));

  return (
    <aside className="w-60 border-r border-border bg-bg flex flex-col h-screen sticky top-0">
      <div className="p-4 border-b border-border">
        <div className="font-semibold">Rental Manager</div>
        <div className="text-xs text-muted-fg truncate">{profile.email}</div>
      </div>
      <nav className="flex-1 p-2 space-y-0.5">
        {visible.map((n) => {
          const Icon = n.icon;
          const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-md text-sm",
                active ? "bg-primary text-primary-fg" : "text-fg hover:bg-muted"
              )}
            >
              <Icon size={16} />
              <span>{n.label}</span>
            </Link>
          );
        })}
      </nav>
      <button onClick={signOut} className="m-2 btn-secondary text-sm">
        <LogOut size={14} /> Sign out
      </button>
    </aside>
  );
}
