"use client";
import { useState } from "react";
import Link from "next/link";
import { money } from "@/lib/format";

export function LeaseEditForm({ lease, action }: { lease: any; action: (fd: FormData) => Promise<void> }) {
  const sc = Number(lease.properties?.service_charge_monthly || 0);
  const [gross, setGross] = useState<number>(Number(lease.gross_rent_monthly));
  const [lesseePaysSC, setLesseePaysSC] = useState(Boolean(lease.lessee_pays_service_charge));
  const net = lesseePaysSC ? gross - sc : gross;

  return (
    <form action={action} className="card space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Lessee name</label>
          <input name="lessee_name" required className="input" defaultValue={lease.lessee_name} />
        </div>
        <div>
          <label className="label">Contact</label>
          <input name="lessee_contact" className="input" defaultValue={lease.lessee_contact ?? ""} placeholder="Optional" />
        </div>
        <div>
          <label className="label">Start date</label>
          <input name="start_date" type="date" required className="input" defaultValue={lease.start_date} />
        </div>
        <div>
          <label className="label">End date</label>
          <input name="end_date" type="date" required className="input" defaultValue={lease.end_date} />
        </div>
        <div>
          <label className="label">Gross rent / month (KES)</label>
          <input
            name="gross_rent_monthly"
            type="number"
            step="0.01"
            min="0"
            required
            className="input"
            value={gross || ""}
            onChange={(e) => setGross(Number(e.target.value))}
          />
        </div>
        <div>
          <label className="label">Lessee document URL</label>
          <input name="lessee_doc_url" type="url" className="input" defaultValue={lease.lessee_doc_url ?? ""} />
        </div>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="lessee_pays_service_charge"
          checked={lesseePaysSC}
          onChange={(e) => setLesseePaysSC(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          <span className="font-medium">Lessee pays the service charge</span>
          <span className="block text-muted-fg text-xs">
            Net rent we receive each month is reduced by {money(sc)}.
          </span>
        </span>
      </label>

      <div className="rounded-md bg-muted p-3 text-sm space-y-1">
        <div className="flex justify-between"><span>Service charge / mo</span><span>{money(sc)}</span></div>
        <div className="flex justify-between"><span>Gross rent / mo</span><span>{money(gross)}</span></div>
        <div className="flex justify-between font-medium border-t border-border pt-1">
          <span>Net rent we receive</span>
          <span>{money(net)}</span>
        </div>
      </div>

      <p className="text-xs text-muted-fg">
        Changes apply going forward. Rent already marked &quot;collected&quot; for past months keeps its original amount.
      </p>

      <div className="flex gap-2">
        <button className="btn-primary">Save changes</button>
        <Link href={`/properties/${lease.property_id}`} className="btn-secondary">Cancel</Link>
      </div>
    </form>
  );
}
