import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { guardView } from "@/lib/guard";
import { resolvePeriod } from "@/lib/period";
import { fetchAll } from "@/lib/fetch-all";
import { methodLabel } from "@/lib/payment-methods";
import { buildStatement } from "@/lib/statement";
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

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export async function GET(req: NextRequest, { params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  // Money-in exports follow Rent Collection access; the rest follow the dashboard.
  await guardView(["payments", "statement", "outstanding", "collected"].includes(type) ? "view_rent" : "view_dashboard");
  const url = new URL(req.url);
  const sb = await supabaseServer();
  const today = new Date().toISOString().slice(0, 10);
  const period = resolvePeriod({
    range: url.searchParams.get("range") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  });

  if (type === "outstanding") {
    // Every overdue rent row with money still owed (unpaid and part-paid).
    const data = await fetchAll<any>((f, t) => sb
      .from("rent_collections")
      .select("due_date, net_amount, collected_amount, properties(name, compounds(name)), leases(lessee_name, lessee_contact)")
      .in("status", ["due", "partial", "overdue"])
      .lte("due_date", today)
      .order("due_date")
      .range(f, t));
    const rows: (string | number | null | undefined)[][] = [
      ["Due date", "Days overdue", "Compound", "Property", "Lessee", "Contact", "Rent", "Paid", "Outstanding"],
    ];
    const t0 = new Date(today + "T00:00:00Z").getTime();
    for (const r of data) {
      const rem = Math.max(0, Number(r.net_amount) - Number(r.collected_amount || 0));
      if (rem <= 0) continue;
      const p = one<any>(r.properties);
      const l = one<any>(r.leases);
      rows.push([
        r.due_date,
        Math.round((t0 - new Date(r.due_date + "T00:00:00Z").getTime()) / 86400000),
        one<any>(p?.compounds)?.name ?? "", p?.name ?? "", l?.lessee_name ?? "", l?.lessee_contact ?? "",
        Number(r.net_amount), Number(r.collected_amount || 0), rem,
      ]);
    }
    return asAttachment(csv(rows), `outstanding-${today}.csv`);
  }

  if (type === "collected" || type === "payments") {
    // Money received in the period, from the payment log (part-payments included).
    const q = url.searchParams.get("q")?.trim() ?? "";
    const method = url.searchParams.get("method") ?? "";
    const kind = type === "collected" ? "" : url.searchParams.get("kind") ?? "";
    let leaseIds: string[] = [];
    if (q) {
      const like = `%${q}%`;
      const [{ data: a }, { data: b }] = await Promise.all([
        sb.from("leases").select("id").ilike("lessee_name", like),
        sb.from("leases").select("id, properties!inner(name)").ilike("properties.name", like),
      ]);
      leaseIds = [...new Set([...(a ?? []), ...(b ?? [])].map((l: any) => l.id as string))];
    }
    const data = await fetchAll<any>((f, t) => {
      let qb = sb.from("payments")
        .select("paid_on, kind, amount, method, reference, notes, leases(lessee_name), properties(name, compounds(name)), rent_collections(due_month), costs(description)")
        .gte("paid_on", period.from).lte("paid_on", period.to);
      if (type === "collected") qb = qb.neq("kind", "deposit");
      if (method) qb = qb.eq("method", method);
      if (kind) qb = qb.eq("kind", kind);
      if (q) qb = qb.or(`${leaseIds.length ? `lease_id.in.(${leaseIds.join(",")}),` : ""}reference.ilike.%${q.replace(/[,()]/g, " ")}%`);
      return qb.order("paid_on", { ascending: false }).range(f, t);
    });
    const rows: (string | number | null | undefined)[][] = [
      ["Received on", "Type", "For", "Compound", "Property", "Lessee", "Method", "Reference", "Amount", "Notes"],
    ];
    for (const p of data) {
      const prop = one<any>(p.properties);
      rows.push([
        p.paid_on,
        p.kind,
        p.kind === "rent" ? `Rent ${String(one<any>(p.rent_collections)?.due_month ?? "").slice(0, 7)}` : p.kind === "cost" ? one<any>(p.costs)?.description ?? "" : "Deposit",
        one<any>(prop?.compounds)?.name ?? "", prop?.name ?? "", one<any>(p.leases)?.lessee_name ?? "",
        methodLabel(p.method), p.reference ?? "", Number(p.amount), p.notes ?? "",
      ]);
    }
    return asAttachment(csv(rows), `${type}-${period.from}-to-${period.to}.csv`);
  }

  if (type === "statement") {
    const lease = url.searchParams.get("lease");
    const lessee = url.searchParams.get("lessee");
    if (!lease && !lessee) return NextResponse.json({ error: "lease or lessee is required" }, { status: 400 });
    const st = await buildStatement(sb, lease ? { leaseId: lease } : { lessee: lessee! }, {
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
    });
    if (!st) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const rows: (string | number | null | undefined)[][] = [
      ["Statement", st.lessee],
      ["Period", st.from, st.to],
      ["Properties", st.leases.map((l) => l.property).join("; ")],
      [],
      ["Date", "Description", "Property", "Reference", "Charge", "Payment", "Balance"],
      [st.from, "Balance brought forward", "", "", "", "", st.opening],
      ...st.lines.map((l) => [l.date, l.description, l.property, l.reference ?? "", l.charge || "", l.payment || "", l.balance]),
      [],
      ["", "Total charges", "", "", st.charges, "", ""],
      ["", "Total payments", "", "", "", st.payments, ""],
      ["", "Balance due", "", "", "", "", st.closing],
      [],
      ["Deposit charged", st.deposit.charged],
      ["Deposit received", st.deposit.received],
      ["Deposit shortfall", st.deposit.shortfall],
    ];
    const slug = st.lessee.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return asAttachment(csv(rows), `statement-${slug}-${st.to}.csv`);
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
