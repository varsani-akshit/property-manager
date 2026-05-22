"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { Home, Building2, FileText, Banknote, Receipt, Users, LogOut } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

const NAV = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/compounds", label: "Compounds", icon: Building2 },
  { href: "/properties", label: "Properties", icon: Building2 },
  { href: "/leases", label: "Leases", icon: FileText },
  { href: "/rent", label: "Rent Collection", icon: Banknote },
  { href: "/costs", label: "Costs", icon: Receipt },
  { href: "/users", label: "Users", icon: Users, adminOnly: true },
];

export function Sidebar({ isAdmin, userEmail }: { isAdmin: boolean; userEmail: string }) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="w-60 border-r border-border bg-bg flex flex-col h-screen sticky top-0">
      <div className="p-4 border-b border-border">
        <div className="font-semibold">Rental Manager</div>
        <div className="text-xs text-muted-fg truncate">{userEmail}</div>
      </div>
      <nav className="flex-1 p-2 space-y-0.5">
        {NAV.filter((n) => !n.adminOnly || isAdmin).map((n) => {
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
