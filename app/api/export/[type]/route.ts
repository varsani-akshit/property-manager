import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { guardView } from "@/lib/guard";
import { resolvePeriod } from "@/lib/period";

function csv(rows: (string | number | null | undefined)[][]): string {
  const escape = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return rows.map((r) => r.map(escape).join(",")).join("\r\n");
}

function asAttachment(content: string, filename: string) {
  return new NextResponse(content, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ type: string }> }) {
  await guardView("view_dashboard"); // require dashboard access to export
  const { type } = await params;
  const url = new URL(req.url);
  const sb = await supabaseServer();
  const today = new Date().toISOString().slice(0, 10);
  const period = resolvePeriod({
    range: url.searchParams.get("range") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  });

  if (type === "outstanding") {
    const { data } = await sb
      .from("rent_collections")
      .select("due_date, net_amount, gross_amount, properties(name, compounds(name)), leases(lessee_name, lessee_contact)")
      .eq("status", "due")
      .lte("due_date", today)
      .order("due_date");
    const rows: (string | number | null | undefined)[][] = [
      ["Due date", "Compound", "Property", "Lessee", "Contact", "Gross", "Net"],
    ];
    for (const r of data ?? []) {
      const p: any = Array.isArray((r as any).properties) ? (r as any).properties[0] : (r as any).properties;
      const c: any = Array.isArray(p?.compounds) ? p?.compounds[0] : p?.compounds;
      const l: any = Array.isArray((r as any).leases) ? (r as any).leases[0] : (r as any).leases;
      rows.push([
        (r as any).due_date,
        c?.name ?? "",
        p?.name ?? "",
        l?.lessee_name ?? "",
        l?.lessee_contact ?? "",
        Number((r as any).gross_amount),
        Number((r as any).net_amount),
      ]);
    }
    return asAttachment(csv(rows), `outstanding-${today}.csv`);
  }

  if (type === "collected") {
    const { data } = await sb
      .from("rent_collections")
      .select("collected_at, due_date, net_amount, gross_amount, properties(name, compounds(name)), leases(lessee_name)")
      .eq("status", "collected")
      .gte("collected_at", `${period.from}T00:00:00Z`)
      .lte("collected_at", `${period.to}T23:59:59Z`)
      .order("collected_at", { ascending: false });
    const rows: (string | number | null | undefined)[][] = [
      ["Collected at", "Due date", "Compound", "Property", "Lessee", "Gross", "Net"],
    ];
    for (const r of data ?? []) {
      const p: any = Array.isArray((r as any).properties) ? (r as any).properties[0] : (r as any).properties;
      const c: any = Array.isArray(p?.compounds) ? p?.compounds[0] : p?.compounds;
      const l: any = Array.isArray((r as any).leases) ? (r as any).leases[0] : (r as any).leases;
      rows.push([
        (r as any).collected_at,
        (r as any).due_date,
        c?.name ?? "",
        p?.name ?? "",
        l?.lessee_name ?? "",
        Number((r as any).gross_amount),
        Number((r as any).net_amount),
      ]);
    }
    return asAttachment(csv(rows), `collected-${period.from}-to-${period.to}.csv`);
  }

  if (type === "costs") {
    const { data } = await sb
      .from("costs")
      .select("incurred_on, description, category, amount, cost_allocations(allocated_amount, properties(name))")
      .eq("payable_by_lessee", false)
      .gte("incurred_on", period.from)
      .lte("incurred_on", period.to)
      .order("incurred_on", { ascending: false });
    const rows: (string | number | null | undefined)[][] = [
      ["Date", "Description", "Category", "Amount", "Properties (split)"],
    ];
    for (const c of data ?? []) {
      const allocs = ((c as any).cost_allocations ?? []) as any[];
      const propStr = allocs.map((a) => {
        const p = Array.isArray(a.properties) ? a.properties[0] : a.properties;
        return `${p?.name ?? "?"}: ${Number(a.allocated_amount).toFixed(2)}`;
      }).join("; ");
      rows.push([
        (c as any).incurred_on,
        (c as any).description,
        (c as any).category,
        Number((c as any).amount),
        propStr,
      ]);
    }
    return asAttachment(csv(rows), `costs-${period.from}-to-${period.to}.csv`);
  }

  if (type === "properties") {
    const { data } = await sb
      .from("v_property_summary")
      .select("*")
      .eq("archived", false);
    const rows: (string | number | null | undefined)[][] = [
      ["Property", "Area sqft", "Valuation", "SC/mo", "Active leases", "Current gross rent", "Total collected", "Total due", "Total costs"],
    ];
    for (const p of data ?? []) {
      const r: any = p;
      rows.push([
        r.name, Number(r.area_sqft), Number(r.valuation), Number(r.service_charge_monthly),
        Number(r.active_lease_count), Number(r.current_gross_rent || 0),
        Number(r.total_rent_collected), Number(r.total_rent_due), Number(r.total_costs),
      ]);
    }
    return asAttachment(csv(rows), `properties-${today}.csv`);
  }

  return NextResponse.json({ error: "unknown export type" }, { status: 400 });
}
